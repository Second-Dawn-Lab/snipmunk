//! Taking a screenshot: the freeze-frame flow.
//!
//! 1. The shortcut, the Add capture button or the tray item calls `trigger`. With a delay, a countdown badge runs first.
//! 2. Every monitor is grabbed FIRST (`dawn-capture`), together with the list of windows, so the overlay can appear
//!    instantly and the capture never contains the overlay or anything that moved after the key press.
//! 3. The pre-created, hidden overlay windows (one per monitor) are placed over their monitors and told to open. Each page
//!    loads its monitor's frozen screenshot (`snipmunk-cap` scheme), and asks to be shown once it is decoded.
//! 4. The page reports the selection in physical pixels of its monitor; `capture_finish` crops the frozen screenshots
//!    (stitching when a window spans monitors), applies the freeform mask, and hands the result to `output`.
//!
//! The watchdog gives up only when an overlay never showed itself; once it is shown, nothing cancels a capture but the user.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use dawn_capture::Screen;
use dawn_hotkeys as hk;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, UriSchemeContext,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::commands::AppState;
use crate::error::{CmdError, CmdResult};
use crate::freeform;
use crate::geometry::{self, Rect};
use crate::winlist::{self, WinInfo};

const OVERLAY_PREFIX: &str = "overlay-";

/// How long the overlays get to show themselves before the capture is given up.
const OVERLAY_TIMEOUT: Duration = Duration::from_secs(6);

struct Run {
    id: u64,
    screens: Vec<Screen>,
    rects: Vec<Rect>,
    windows: Vec<WinInfo>,
    /// The overlay under the pointer: it gets the keyboard focus and the mode bar.
    focus: usize,
    started: Instant,
    /// An overlay has shown its screenshot.
    ready: bool,
}

pub struct Capture {
    run: Mutex<Option<Run>>,
    /// The running selection is for a screen recording, not for a screenshot.
    recording: AtomicBool,
    /// A capture is in progress (countdown, overlays, or saving).
    busy: AtomicBool,
    next_id: AtomicU64,
}

impl Capture {
    pub fn new() -> Self {
        Self {
            run: Mutex::new(None),
            recording: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            next_id: AtomicU64::new(1),
        }
    }
}

/// `SNIPMUNK_TRACE=1` prints the timings of a capture to the console (used to measure how fast the overlay appears).
fn trace(msg: &str) {
    if std::env::var_os("SNIPMUNK_TRACE").is_some() {
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        eprintln!("[capture] t={epoch} {msg}");
    }
}

fn overlay_label(i: usize) -> String {
    format!("{OVERLAY_PREFIX}{i}")
}

fn overlays(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(OVERLAY_PREFIX))
        .map(|(_, w)| w)
        .collect()
}

fn hide_overlays(app: &AppHandle) {
    for w in overlays(app) {
        let _ = w.hide();
    }
}

/// The windows people use Snipmunk in. They are capturable (Snipping Tool, screen sharing, OBS) except while this
/// program grabs the screen, so a Snipmunk capture never contains Snipmunk.
const OWN_WINDOWS: [&str; 2] = ["main", "settings"];

/// Make the main and settings windows capturable again. Safe to call at any time; every end of a capture (done, cancelled,
/// failed, given up) calls it, so the exclusion can never stay on.
fn release_own_windows(app: &AppHandle) {
    for label in OWN_WINDOWS {
        if let Some(w) = app.get_webview_window(label) {
            crate::webview::set_capture_excluded(&w, false);
        }
    }
}

/// Keeps the main and settings windows out of screen captures while it lives. Dropping it (also when the grab panics)
/// puts them back.
struct OwnWindowsHidden {
    app: AppHandle,
}

impl OwnWindowsHidden {
    fn new(app: &AppHandle) -> Self {
        let mut visible = false;
        for label in OWN_WINDOWS {
            if let Some(w) = app.get_webview_window(label) {
                crate::webview::set_capture_excluded(&w, true);
                visible |= w.is_visible().unwrap_or(false);
            }
        }
        if visible {
            // The desktop compositor applies the change with the next frame.
            std::thread::sleep(AFFINITY_SETTLE);
        }
        Self { app: app.clone() }
    }
}

impl Drop for OwnWindowsHidden {
    fn drop(&mut self) {
        release_own_windows(&self.app);
    }
}

/// How long the compositor gets to leave a window out of captures after the change.
const AFFINITY_SETTLE: Duration = Duration::from_millis(60);

fn ensure_overlay(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(label) {
        return Ok(w);
    }
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Snipmunk capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()?;
    crate::webview::exclude_from_capture(&window);
    crate::webview::disable_browser_accelerators(&window);
    Ok(window)
}

/// Create the hidden windows ahead of time (one overlay per monitor, the countdown badge and the toast), so the first
/// capture is as fast as the next. Runs on its own thread: windows must not be built on the main thread.
pub fn precreate(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let monitors = app
            .available_monitors()
            .map(|m| m.len())
            .unwrap_or(1)
            .max(1);
        for i in 0..monitors {
            let _ = ensure_overlay(&app, &overlay_label(i));
        }
        crate::popups::precreate(&app);
    });
}

fn finish_run(app: &AppHandle) {
    release_own_windows(app);
    let capture = app.state::<Capture>();
    capture.recording.store(false, Ordering::SeqCst);
    *capture.run.lock().unwrap() = None;
    capture.busy.store(false, Ordering::SeqCst);
}

/// A capture that could not be taken: say so in the main window.
fn fail(app: &AppHandle, message: &str) {
    eprintln!("capture failed: {message}");
    hide_overlays(app);
    finish_run(app);
    let _ = app.emit("capture-error", message);
    crate::tray::show_main(app);
}

/// Start a capture (from the shortcut, the button or the tray). Does nothing while another capture is running.
pub fn trigger(app: &AppHandle) {
    if app.state::<Capture>().busy.swap(true, Ordering::SeqCst) {
        return;
    }
    run_flow(app);
}

/// Start choosing the area of a screen recording: the same selection overlay, with the recording modes (no freeform) and the
/// recording countdown. Does nothing while another capture is running.
pub fn trigger_recording(app: &AppHandle) {
    let capture = app.state::<Capture>();
    if capture.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    capture.recording.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || begin(&app));
}

/// The delay (when set), then the grab and the overlays. A capture is marked busy already. Runs on its own thread.
fn run_flow(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let delay = app
            .state::<AppState>()
            .settings
            .lock()
            .unwrap()
            .capture_delay;
        if delay > 0 && !crate::popups::countdown(&app, delay) {
            finish_run(&app);
            return;
        }
        begin(&app);
    });
}

fn begin(app: &AppHandle) {
    let started = Instant::now();
    let grab = {
        // Snipmunk's own windows are not in the picture; they are capturable again as soon as the grab is over.
        let _hidden = OwnWindowsHidden::new(app);
        dawn_capture::capture_all()
    };
    let screens = match grab {
        Ok(s) => s,
        Err(err) => return fail(app, &err.to_string()),
    };
    trace(&format!(
        "screens grabbed {} ms after the start ({} monitors)",
        started.elapsed().as_millis(),
        screens.len()
    ));
    let windows = winlist::list_windows();
    let rects: Vec<Rect> = screens
        .iter()
        .map(|s| Rect::new(s.x, s.y, s.width, s.height))
        .collect();
    let cursor = hk::cursor_position().unwrap_or((0, 0));
    let focus = geometry::monitor_at(&rects, cursor).unwrap_or(0);

    let capture = app.state::<Capture>();
    let id = capture.next_id.fetch_add(1, Ordering::SeqCst);
    *capture.run.lock().unwrap() = Some(Run {
        id,
        screens,
        rects: rects.clone(),
        windows,
        focus,
        started,
        ready: false,
    });
    watch_overlays(app, id);

    for (i, r) in rects.iter().enumerate() {
        let label = overlay_label(i);
        let window = match ensure_overlay(app, &label) {
            Ok(w) => w,
            Err(err) => return fail(app, &format!("could not create the capture overlay: {err}")),
        };
        // Cover the monitor exactly. Move first so the window is on the monitor (and its DPI) when it is resized.
        let _ = window.set_position(PhysicalPosition::new(r.x, r.y));
        let _ = window.set_size(PhysicalSize::new(r.w, r.h));
        let _ = window.set_position(PhysicalPosition::new(r.x, r.y));
        // Windows can drop the setting while a window is hidden: set it again every time, before the window is shown.
        crate::webview::exclude_from_capture(&window);
        let _ = app.emit_to(&label, "capture-open", id);
        // Show it at once: the window is transparent until its page has the frozen screenshot, so the screen looks
        // dimmed immediately and the (identical) frozen picture replaces the live one a moment later.
        let _ = window.show();
        if i == focus {
            let _ = window.set_focus();
        }
        trace(&format!(
            "overlay {i} shown {} ms after the start",
            started.elapsed().as_millis()
        ));
    }
    trace(&format!(
        "overlays told to open after {} ms",
        started.elapsed().as_millis()
    ));
}

/// Give up a capture whose overlays never appeared (the page did not load, the window could not be created). Never
/// cancels a capture that is on screen: that is up to the user.
fn watch_overlays(app: &AppHandle, id: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(OVERLAY_TIMEOUT);
        let stuck = app
            .state::<Capture>()
            .run
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|r| r.id == id && !r.ready);
        if stuck {
            fail(
                &app,
                &format!(
                    "the capture overlay did not appear within {} seconds",
                    OVERLAY_TIMEOUT.as_secs()
                ),
            );
        }
    });
}

/// Throw the screenshots away and close the overlays.
pub fn cancel(app: &AppHandle) {
    hide_overlays(app);
    finish_run(app);
}

// --- the overlay pages -------------------------------------------------------

/// Handler of the `snipmunk-cap` scheme: `/<run>/<monitor>` is that monitor's frozen screenshot as raw RGBA bytes
/// (`OverlayInfo` has the size). No encoding and no decoding: the page puts the bytes straight on a canvas, which is the
/// quickest way to show a 4K monitor.
pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path().trim_matches('/').to_string();
    let mut parts = path.split('/');
    let (run, index) = (
        parts.next().and_then(|s| s.parse::<u64>().ok()),
        parts.next().and_then(|s| s.parse::<usize>().ok()),
    );
    let body = ctx.app_handle().try_state::<Capture>().and_then(|capture| {
        let guard = capture.run.lock().unwrap();
        let run_data = guard.as_ref().filter(|r| Some(r.id) == run)?;
        Some(run_data.screens.get(index?)?.frame.rgba.clone())
    });
    match body {
        Some(bytes) => tauri::http::Response::builder()
            .header("Content-Type", "application/octet-stream")
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store")
            .body(bytes)
            .unwrap_or_default(),
        None => tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap_or_default(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    run: u64,
    index: usize,
    count: usize,
    /// This overlay is on the monitor under the pointer: it has the mode bar and the keyboard focus.
    focus: bool,
    mode: String,
    /// Seconds of delay before a capture: 0, 3, 5 or 10 (the setting the main window's dropdown shows).
    delay: u32,
    magnifier: bool,
    /// "screenshot" or "recording" (the mode bar shows the recording modes and the recording countdown).
    purpose: String,
    /// This monitor on the virtual desktop, physical pixels.
    monitor: Rect,
    scale: f64,
    /// The windows on screen, topmost first, desktop physical pixels.
    windows: Vec<WinInfo>,
    image_url: String,
    /// Size of the screenshot in pixels (equal to the monitor's physical size).
    width: u32,
    height: u32,
}

/// An overlay page asks what to display; `None` when no capture is running (a stale or idle overlay).
#[tauri::command]
pub fn capture_overlay_info(
    capture: State<'_, Capture>,
    state: State<'_, AppState>,
    label: String,
) -> Option<OverlayInfo> {
    let index: usize = label.strip_prefix(OVERLAY_PREFIX)?.parse().ok()?;
    let guard = capture.run.lock().unwrap();
    let run = guard.as_ref().filter(|r| index < r.screens.len())?;
    let settings = state.settings.lock().unwrap();
    let recording = capture.recording.load(Ordering::SeqCst);
    let base = if cfg!(windows) {
        "http://snipmunk-cap.localhost"
    } else {
        "snipmunk-cap://localhost"
    };
    Some(OverlayInfo {
        run: run.id,
        index,
        count: run.screens.len(),
        focus: index == run.focus,
        mode: if recording {
            settings.rec_mode.clone()
        } else {
            settings.capture_mode.clone()
        },
        delay: if recording {
            settings.rec_countdown
        } else {
            settings.capture_delay
        },
        magnifier: settings.show_magnifier,
        purpose: if recording { "recording" } else { "screenshot" }.into(),
        monitor: run.rects[index],
        scale: run.screens[index].scale,
        windows: run.windows.clone(),
        image_url: format!("{base}/{}/{index}", run.id),
        width: run.screens[index].frame.width,
        height: run.screens[index].frame.height,
    })
}

/// The overlay has decoded its screenshot: show it (the one under the pointer takes the focus).
#[tauri::command]
pub fn capture_overlay_ready(app: AppHandle, capture: State<'_, Capture>, label: String) {
    let Some(index) = label
        .strip_prefix(OVERLAY_PREFIX)
        .and_then(|i| i.parse::<usize>().ok())
    else {
        return;
    };
    let (focus, started) = match capture.run.lock().unwrap().as_mut() {
        Some(r) => {
            r.ready = true;
            (r.focus, r.started)
        }
        None => return,
    };
    trace(&format!(
        "overlay {index} has its screenshot {} ms after the start (focus overlay {focus})",
        started.elapsed().as_millis()
    ));
    let _ = &app;
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle) {
    cancel(&app);
}

/// The mode bar of an overlay changed the mode: remember it and tell the other overlays.
#[tauri::command]
pub fn capture_set_mode(app: AppHandle, mode: String) -> CmdResult<()> {
    if !["rectangle", "window", "fullscreen", "freeform", "scrolling"].contains(&mode.as_str()) {
        return Err(CmdError::new("bad_request", "unknown capture mode"));
    }
    if app.state::<Capture>().recording.load(Ordering::SeqCst) {
        // A recording has no freeform and no scrolling mode.
        if mode == "freeform" || mode == "scrolling" {
            return Err(CmdError::new(
                "bad_request",
                "a recording has no freeform area",
            ));
        }
        crate::commands::patch_settings(&app, serde_json::json!({ "recMode": mode }))?;
        let _ = app.emit("capture-mode", &mode);
        return Ok(());
    }
    crate::commands::patch_settings(&app, serde_json::json!({ "captureMode": mode }))?;
    let _ = app.emit("capture-mode", &mode);
    Ok(())
}

/// The delay dropdown of the overlay's mode bar. The choice is remembered (the main window's dropdown follows). A delay
/// above 0 closes the overlay, counts down, then grabs the screen again and reopens the overlay in the same mode: the
/// grab happens after the delay. "No delay" only changes the setting; the overlay stays.
#[tauri::command]
pub fn capture_set_delay(app: AppHandle, delay: u32) -> CmdResult<()> {
    if !is_delay(delay) {
        return Err(CmdError::new("bad_request", "unknown delay"));
    }
    if app.state::<Capture>().recording.load(Ordering::SeqCst) {
        // The recording countdown runs after the area is chosen: only the setting changes.
        crate::commands::patch_settings(&app, serde_json::json!({ "recCountdown": delay }))?;
        return Ok(());
    }
    crate::commands::patch_settings(&app, serde_json::json!({ "captureDelay": delay }))?;
    if delay == 0 {
        return Ok(());
    }
    // The capture stays marked busy: the screenshots of this run are dropped and the flow starts over.
    hide_overlays(&app);
    *app.state::<Capture>().run.lock().unwrap() = None;
    run_flow(&app);
    Ok(())
}

fn is_delay(seconds: u32) -> bool {
    [0, 3, 5, 10].contains(&seconds)
}

/// Start a capture from the page (the Add capture button). Picking a mode in the split menu sets it first.
#[tauri::command]
pub fn start_capture(app: AppHandle, mode: Option<String>) -> CmdResult<()> {
    if let Some(mode) = mode {
        capture_set_mode(app.clone(), mode)?;
    }
    trigger(&app);
    Ok(())
}

/// What the overlay reports when the user is done. Everything is in physical pixels of the overlay's monitor.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishArgs {
    pub label: String,
    pub mode: String,
    /// x, y, width, height of the selection (a window, or the monitor, or the bounding box of the lasso).
    pub rect: [i32; 4],
    /// The lasso, for the freeform mode.
    pub points: Option<Vec<[f64; 2]>>,
    pub window_title: Option<String>,
    /// The window of a window selection (its handle), for a recording of that window.
    pub window_hwnd: Option<i64>,
}

/// The area of a finished selection on the virtual desktop (physical pixels) for a recording: the window (what is visible of
/// it), the monitor, or the dragged rectangle. `None` when it is too small.
pub fn recording_area(rects: &[Rect], index: usize, args: &FinishArgs) -> Option<Rect> {
    let monitor = *rects.get(index)?;
    let [rx, ry, rw, rh] = args.rect;
    let wanted = Rect::new(
        monitor.x + rx,
        monitor.y + ry,
        rw.max(0) as u32,
        rh.max(0) as u32,
    );
    let area = match args.mode.as_str() {
        "window" => geometry::visible_part(wanted, rects)?,
        "fullscreen" => monitor,
        _ => wanted.intersect(&monitor)?,
    };
    (area.w >= geometry::MIN_SELECTION && area.h >= geometry::MIN_SELECTION).then_some(area)
}

/// The area of a scrolling capture on the virtual desktop: the visible part of the chosen window or rectangle.
fn recording_area_scrolling(rects: &[Rect], index: usize, args: &FinishArgs) -> Option<Rect> {
    let monitor = *rects.get(index)?;
    let [rx, ry, rw, rh] = args.rect;
    let wanted = Rect::new(
        monitor.x + rx,
        monitor.y + ry,
        rw.max(0) as u32,
        rh.max(0) as u32,
    );
    let area = geometry::visible_part(wanted, rects)?;
    (area.w >= geometry::MIN_SELECTION && area.h >= geometry::MIN_SELECTION).then_some(area)
}

/// The pixels of a finished selection, cut out of the frozen screenshots, and the title to name it by.
pub struct Cut {
    pub frame: dawn_capture::Frame,
    pub title: Option<String>,
}

/// Cut the selection out of the frozen screenshots. Pure apart from the data it is given, so it is unit tested.
pub fn cut(
    screens: &[(Rect, &dawn_capture::Frame)],
    windows: &[WinInfo],
    index: usize,
    args: &FinishArgs,
) -> Option<Cut> {
    let monitor = screens.get(index)?.0;
    let all: Vec<Rect> = screens.iter().map(|s| s.0).collect();
    let [rx, ry, rw, rh] = args.rect;
    let wanted = Rect::new(
        monitor.x + rx,
        monitor.y + ry,
        rw.max(0) as u32,
        rh.max(0) as u32,
    );
    let mut points: Vec<(f64, f64)> = Vec::new();
    let area = match args.mode.as_str() {
        // A window may reach onto another monitor or off the screen: keep what is visible.
        "window" => geometry::visible_part(wanted, &all)?,
        "fullscreen" => monitor,
        "freeform" => {
            points = args
                .points
                .as_ref()?
                .iter()
                .map(|p| (monitor.x as f64 + p[0], monitor.y as f64 + p[1]))
                .collect();
            freeform::bounding_box(&points)?.intersect(&monitor)?
        }
        _ => wanted.intersect(&monitor)?,
    };
    if area.w < geometry::MIN_SELECTION || area.h < geometry::MIN_SELECTION {
        return None;
    }
    let mut frame = geometry::compose(screens, area)?;
    if args.mode == "freeform" {
        freeform::apply(&mut frame, &freeform::mask(&points, area));
    }
    let title = args
        .window_title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .or_else(|| winlist::hit_test(windows, area.center()).map(|w| w.title.clone()));
    Some(Cut { frame, title })
}

/// The user finished selecting.
#[tauri::command]
pub fn capture_finish(app: AppHandle, args: FinishArgs) -> CmdResult<()> {
    let index: usize = args
        .label
        .strip_prefix(OVERLAY_PREFIX)
        .and_then(|i| i.parse().ok())
        .ok_or_else(|| CmdError::new("bad_request", "unknown overlay"))?;
    hide_overlays(&app);
    let capture = app.state::<Capture>();
    let Some(run) = capture.run.lock().unwrap().take() else {
        capture.busy.store(false, Ordering::SeqCst);
        return Ok(());
    };
    if capture.recording.swap(false, Ordering::SeqCst) {
        // A recording: the area is what was chosen; the screenshots of the overlay are not needed.
        let area = recording_area(&run.rects, index, &args);
        drop(run);
        let Some(area) = area else {
            capture.busy.store(false, Ordering::SeqCst);
            return Ok(());
        };
        let hwnd = args
            .window_hwnd
            .filter(|_| args.mode == "window")
            .map(|h| h as usize);
        std::thread::spawn(move || {
            crate::recording::begin_area(&app, area, hwnd);
            app.state::<Capture>().busy.store(false, Ordering::SeqCst);
        });
        return Ok(());
    }
    if args.mode == "scrolling" {
        // Pictures are taken fresh after every scroll step; the frozen screenshots are not needed.
        let area = recording_area_scrolling(&run.rects, index, &args);
        let title = args
            .window_title
            .clone()
            .filter(|t| !t.trim().is_empty())
            .or_else(|| {
                area.and_then(|a| {
                    winlist::hit_test(&run.windows, a.center()).map(|w| w.title.clone())
                })
            });
        let hwnd = args.window_hwnd.map(|h| h as isize).or_else(|| {
            area.and_then(|a| winlist::hit_test(&run.windows, a.center()).map(|w| w.hwnd))
        });
        drop(run);
        if let Some(area) = area {
            // The overlays are gone before the first picture is taken.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(150));
                crate::scrollshot::begin(&app, area, hwnd, title);
                app.state::<Capture>().busy.store(false, Ordering::SeqCst);
            });
        } else {
            capture.busy.store(false, Ordering::SeqCst);
        }
        return Ok(());
    }
    trace(&format!(
        "selection finished {} ms after the start",
        run.started.elapsed().as_millis()
    ));
    let pairs: Vec<(Rect, &dawn_capture::Frame)> = run
        .rects
        .iter()
        .copied()
        .zip(run.screens.iter().map(|s| &s.frame))
        .collect();
    let result = cut(&pairs, &run.windows, index, &args);
    drop(pairs);
    drop(run); // the full screenshots are no longer needed
    let Some(cut) = result else {
        capture.busy.store(false, Ordering::SeqCst);
        return Ok(());
    };
    // Encoding and saving take a moment: not on the thread that answers the page.
    std::thread::spawn(move || {
        if let Err(err) = crate::output::deliver(&app, cut.frame, cut.title) {
            let _ = app.emit("capture-error", err);
        }
        app.state::<Capture>().busy.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use dawn_capture::Frame;

    fn solid(w: u32, h: u32, rgba: [u8; 4]) -> Frame {
        Frame {
            width: w,
            height: h,
            rgba: rgba
                .iter()
                .copied()
                .cycle()
                .take((w * h * 4) as usize)
                .collect(),
        }
    }

    fn args(mode: &str, rect: [i32; 4]) -> FinishArgs {
        FinishArgs {
            label: "overlay-0".into(),
            mode: mode.into(),
            rect,
            points: None,
            window_title: None,
            window_hwnd: None,
        }
    }

    #[test]
    fn a_recording_area_is_the_rectangle_the_window_or_the_monitor() {
        let rects = [Rect::new(0, 0, 1920, 1080), Rect::new(1920, 0, 2560, 1440)];
        // A dragged rectangle on the second monitor is in desktop coordinates; it is kept inside its monitor.
        assert_eq!(
            recording_area(&rects, 1, &args("rectangle", [100, 50, 800, 600])),
            Some(Rect::new(2020, 50, 800, 600))
        );
        assert_eq!(
            recording_area(&rects, 1, &args("rectangle", [2000, 1000, 800, 800])),
            Some(Rect::new(3920, 1000, 560, 440))
        );
        // The whole monitor.
        assert_eq!(
            recording_area(&rects, 0, &args("fullscreen", [0, 0, 10, 10])),
            Some(rects[0])
        );
        // A window that reaches off the screen: what is visible.
        assert_eq!(
            recording_area(&rects[..1], 0, &args("window", [1500, 800, 800, 600])),
            Some(Rect::new(1500, 800, 420, 280))
        );
        // Too small, or not on any monitor.
        assert_eq!(
            recording_area(&rects, 0, &args("rectangle", [10, 10, 2, 2])),
            None
        );
        assert_eq!(
            recording_area(&rects, 5, &args("rectangle", [10, 10, 200, 200])),
            None
        );
    }

    #[test]
    fn a_rectangle_is_cut_from_its_monitor() {
        let left = solid(100, 50, [255, 0, 0, 255]);
        let right = solid(200, 100, [0, 0, 255, 255]);
        let screens = [
            (Rect::new(0, 0, 100, 50), &left),
            (Rect::new(100, -20, 200, 100), &right),
        ];
        let out = cut(&screens, &[], 1, &args("rectangle", [10, 10, 40, 30])).unwrap();
        assert_eq!((out.frame.width, out.frame.height), (40, 30));
        assert_eq!(&out.frame.rgba[0..4], &[0, 0, 255, 255]);
    }

    #[test]
    fn a_rectangle_is_kept_on_its_monitor_and_tiny_ones_are_dropped() {
        let f = solid(100, 50, [1, 1, 1, 255]);
        let screens = [(Rect::new(0, 0, 100, 50), &f)];
        let out = cut(&screens, &[], 0, &args("rectangle", [80, 30, 100, 100])).unwrap();
        assert_eq!((out.frame.width, out.frame.height), (20, 20));
        assert!(cut(&screens, &[], 0, &args("rectangle", [10, 10, 2, 2])).is_none());
        assert!(cut(&screens, &[], 5, &args("rectangle", [10, 10, 20, 20])).is_none());
    }

    #[test]
    fn full_screen_takes_the_whole_monitor() {
        let f = solid(100, 50, [1, 1, 1, 255]);
        let screens = [(Rect::new(0, 0, 100, 50), &f)];
        let out = cut(&screens, &[], 0, &args("fullscreen", [0, 0, 1, 1])).unwrap();
        assert_eq!((out.frame.width, out.frame.height), (100, 50));
    }

    #[test]
    fn a_window_across_two_monitors_is_stitched_and_named_by_its_title() {
        let left = solid(100, 50, [255, 0, 0, 255]);
        let right = solid(100, 50, [0, 0, 255, 255]);
        let screens = [
            (Rect::new(0, 0, 100, 50), &left),
            (Rect::new(100, 0, 100, 50), &right),
        ];
        let mut a = args("window", [80, 10, 40, 30]);
        a.window_title = Some("Notes - Notepad".into());
        let out = cut(&screens, &[], 0, &a).unwrap();
        assert_eq!((out.frame.width, out.frame.height), (40, 30));
        assert_eq!(&out.frame.rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&out.frame.rgba[(39) * 4..(39) * 4 + 4], &[0, 0, 255, 255]);
        assert_eq!(out.title.as_deref(), Some("Notes - Notepad"));
    }

    #[test]
    fn a_window_hanging_off_the_screen_is_cut_to_the_visible_part() {
        let f = solid(100, 50, [9, 9, 9, 255]);
        let screens = [(Rect::new(0, 0, 100, 50), &f)];
        let out = cut(&screens, &[], 0, &args("window", [-8, -8, 60, 40])).unwrap();
        assert_eq!((out.frame.width, out.frame.height), (52, 32));
    }

    #[test]
    fn freeform_is_the_bounding_box_with_transparent_corners() {
        let f = solid(100, 50, [7, 7, 7, 255]);
        let screens = [(Rect::new(0, 0, 100, 50), &f)];
        let mut a = args("freeform", [0, 0, 0, 0]);
        a.points = Some(vec![[10.0, 10.0], [30.0, 10.0], [10.0, 30.0]]);
        let out = cut(&screens, &[], 0, &a).unwrap();
        assert_eq!((out.frame.width, out.frame.height), (20, 20));
        let alpha = |x: usize, y: usize| out.frame.rgba[(y * 20 + x) * 4 + 3];
        assert_eq!(alpha(1, 1), 255, "inside the triangle");
        assert_eq!(alpha(18, 18), 0, "the corner beyond the long edge");
        a.points = Some(vec![[10.0, 10.0], [11.0, 11.0]]);
        assert!(
            cut(&screens, &[], 0, &a).is_none(),
            "a scribble is no shape"
        );
    }

    #[test]
    fn the_window_under_the_selection_names_the_capture() {
        let f = solid(100, 50, [7, 7, 7, 255]);
        let screens = [(Rect::new(0, 0, 100, 50), &f)];
        let windows = vec![WinInfo {
            hwnd: 1,
            title: "Inbox - Chrome".into(),
            rect: Rect::new(0, 0, 60, 50),
        }];
        let out = cut(&screens, &windows, 0, &args("rectangle", [10, 10, 20, 20])).unwrap();
        assert_eq!(out.title.as_deref(), Some("Inbox - Chrome"));
        let out = cut(&screens, &windows, 0, &args("rectangle", [70, 10, 20, 20])).unwrap();
        assert_eq!(out.title, None);
    }

    #[test]
    fn only_the_known_delays_are_accepted() {
        for d in [0, 3, 5, 10] {
            assert!(is_delay(d), "{d}");
        }
        for d in [1, 2, 4, 7, 60, u32::MAX] {
            assert!(!is_delay(d), "{d}");
        }
    }
}
