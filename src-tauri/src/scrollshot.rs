#![allow(clippy::chunks_exact_to_as_chunks)]
//! The scrolling screenshot, scrolled BY HAND: the user chooses a window or draws an area, a thin frame marks it and a small pill shows
//! "Scroll now" with the height so far, Done and Cancel. The user scrolls the content themselves (wheel, scroll bar, keys), up or
//! down, at their own pace; Snipmunk watches the area (Windows.Graphics.Capture, the same path as a recording, without the cursor,
//! at most about 15 pictures a second) and puts every picture where it belongs on a growing canvas (`stitch.rs`). Enter or Done
//! finishes (one normal capture), Esc or Cancel throws it away. When the user scrolls too fast to follow, the pill turns orange
//! ("Scroll slower") and nothing is lost: scrolling back to what was captured goes on from there.
//!
//! Nothing is scrolled, clicked or typed by Snipmunk. The frame and the pill are left out of the pictures and never take the focus.
//!
//! The own test instance has development-only test windows (`dev_scroll_test`): a WebView2 page with a sticky header and footer and
//! lazy images, and a native edit control, both with generated content; a script scrolls them the way a user would, and the result
//! is checked against what is known. The pictures of those tests come from that window alone.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::CmdResult;
use crate::geometry::Rect;
use crate::stitch::{Canvas, Picture, Placed};

/// Done was clicked / Cancel was clicked.
static DONE: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
/// A scrolling capture is running.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// The newest thumbnail (PNG) for the pill, and a counter that changes with it.
static THUMB: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static THUMB_N: AtomicU64 = AtomicU64::new(0);

/// The scrolling screenshot is PARKED (it failed real tests and is rebuilt in Phase 8): it is only reachable in a debug build that is
/// started with `SNIPMUNK_EXPERIMENTAL_SCROLL=1`. In a release build this is always false, so the mode is not offered, not accepted
/// and not started.
pub fn experimental() -> bool {
    cfg!(debug_assertions) && std::env::var("SNIPMUNK_EXPERIMENTAL_SCROLL").is_ok_and(|v| v == "1")
}

/// Does the page offer the parked scrolling mode? (Only with the development switch.)
#[tauri::command]
pub fn experimental_scroll() -> bool {
    experimental()
}

/// Is a scrolling capture running? (Quit asks first.)
pub fn running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

/// The pill's picture (served at `snipmunk-cam://…/scroll`).
pub fn thumb_png() -> Option<Vec<u8>> {
    let t = THUMB.lock().unwrap_or_else(|e| e.into_inner());
    (!t.is_empty()).then(|| t.clone())
}

/// The Done button of the pill.
#[tauri::command]
pub fn scroll_done() {
    DONE.store(true, Ordering::SeqCst);
}

/// The Cancel button of the pill.
#[tauri::command]
pub fn scroll_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Where the pictures come from.
#[derive(Debug, Clone, Copy)]
pub enum Source {
    /// The screen area (physical pixels of the virtual desktop), cut out of its monitor.
    Screen(Rect),
    /// One window of this program, captured by itself (development tests only: no screen pixels are read).
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    Window(isize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum End {
    Done,
    Cancelled,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub height: usize,
    pub n: u64,
    /// "ok", "slow" (too fast: scroll back / slower) or "max" (the maximum height is reached).
    pub state: &'static str,
}

pub struct Outcome {
    /// RGBA.
    pub rgba: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub end: End,
    pub pictures: usize,
    pub lost: usize,
    pub reached_max: bool,
}

/// A picture of the area: BGRA, width, height.
pub type Shot = (Vec<u8>, usize, usize);

/// Take the pictures from `rx` and put them on the canvas until `ask` says Done or Cancelled. `progress` is told after changes.
pub fn collect(
    rx: &std::sync::mpsc::Receiver<Shot>,
    max_height: usize,
    ask: &dyn Fn() -> Option<End>,
    progress: &dyn Fn(&Canvas, &'static str),
) -> Result<Outcome, String> {
    // The first picture starts the canvas.
    let started = Instant::now();
    let first = loop {
        if let Some(End::Cancelled) = ask() {
            return Ok(empty(End::Cancelled));
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(s) => break s,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                if started.elapsed() < Duration::from_secs(8) => {}
            Err(_) => return Err("no picture came from the screen".into()),
        }
    };
    let (w, h) = (first.1, first.2);
    let mut canvas = Canvas::new(
        &Picture {
            width: w,
            height: h,
            bgra: &first.0,
        },
        max_height,
    );
    let (mut pictures, mut lost) = (1usize, 0usize);
    let mut state = "ok";
    progress(&canvas, state);
    let mut last_progress = Instant::now();
    let end = loop {
        if let Some(e) = ask() {
            break e;
        }
        let shot = match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(s) => s,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break End::Done,
        };
        if shot.1 != w || shot.2 != h {
            continue;
        }
        pictures += 1;
        let placed = canvas.push(&Picture {
            width: w,
            height: h,
            bgra: &shot.0,
        });
        let next_state = match placed {
            Placed::Lost => {
                lost += 1;
                "slow"
            }
            _ if canvas.at_max() => "max",
            Placed::Same => state,
            _ => "ok",
        };
        let changed = next_state != state || matches!(placed, Placed::Added(n) if n > 0);
        state = next_state;
        if changed || last_progress.elapsed() > Duration::from_millis(400) {
            progress(&canvas, state);
            last_progress = Instant::now();
        }
    };
    let reached_max = canvas.at_max();
    let (mut bgra, width, height) = canvas.finish();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }
    Ok(Outcome {
        rgba: bgra,
        width,
        height,
        end,
        pictures,
        lost,
        reached_max,
    })
}

fn empty(end: End) -> Outcome {
    Outcome {
        rgba: Vec::new(),
        width: 0,
        height: 0,
        end,
        pictures: 0,
        lost: 0,
        reached_max: false,
    }
}

/// The settings: the maximum height.
fn max_height(app: &AppHandle) -> usize {
    let s = app
        .state::<crate::commands::AppState>()
        .settings
        .lock()
        .unwrap()
        .clone();
    s.scroll_max_height.clamp(1000, 32_000) as usize
}

/// Tell the pill the height and give it a new thumbnail.
fn publish(app: &AppHandle, canvas: &Canvas, state: &'static str) {
    let (rgba, w, h) = canvas.thumbnail(110, 120);
    if let Some(img) = image::RgbaImage::from_raw(w as u32, h as u32, rgba) {
        if let Ok(png) = crate::thumbs::png_bytes(&img, image::codecs::png::CompressionType::Fast) {
            *THUMB.lock().unwrap_or_else(|e| e.into_inner()) = png;
        }
    }
    let n = THUMB_N.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit_to(
        "scrollpill",
        "scroll-progress",
        Progress {
            height: canvas.height(),
            n,
            state,
        },
    );
}

/// Start a scrolling capture of `area` (`hwnd`: the window it was chosen in). Runs on its own thread; the result is added as a capture.
pub fn begin(app: &AppHandle, area: Rect, hwnd: Option<isize>, title: Option<String>) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    DONE.store(false, Ordering::SeqCst);
    CANCEL.store(false, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let result = session(&app, area, hwnd, title);
        RUNNING.store(false, Ordering::SeqCst);
        if let Err(e) = result {
            let _ = app.emit("capture-error", e);
        }
    });
}

#[cfg(windows)]
fn session(
    app: &AppHandle,
    area: Rect,
    hwnd: Option<isize>,
    title: Option<String>,
) -> Result<(), String> {
    // A window: its client area (no title bar, no frame).
    let area = hwnd
        .and_then(win::client_rect)
        .and_then(|c| c.intersect(&area))
        .unwrap_or(area);
    show_frame(app, area);
    show_pill(app, area);
    // The overlays are gone and the screen has settled.
    std::thread::sleep(Duration::from_millis(250));
    let (tx, rx) = std::sync::mpsc::sync_channel::<Shot>(3);
    let control = win::start_capture(Source::Screen(area), tx);
    let control = match control {
        Ok(c) => c,
        Err(e) => {
            close_pill(app);
            close_frame(app);
            return Err(e);
        }
    };
    // Enter finishes, Esc cancels (read from the keyboard state; nothing is sent). A key that is down already does not count.
    let enter_was_down = std::cell::Cell::new(win::key_down(win::VK_ENTER));
    let esc_was_down = std::cell::Cell::new(crate::webview::escape_down());
    let ask = || {
        let (enter, esc) = (win::key_down(win::VK_ENTER), crate::webview::escape_down());
        let r = if CANCEL.load(Ordering::SeqCst) || (esc && !esc_was_down.get()) {
            Some(End::Cancelled)
        } else if DONE.load(Ordering::SeqCst) || (enter && !enter_was_down.get()) {
            Some(End::Done)
        } else {
            None
        };
        enter_was_down.set(enter);
        esc_was_down.set(esc);
        r
    };
    let outcome = collect(&rx, max_height(app), &ask, &|c, s| publish(app, c, s));
    drop(control);
    close_pill(app);
    close_frame(app);
    let outcome = outcome?;
    if outcome.end == End::Cancelled || outcome.width == 0 {
        return Ok(());
    }
    let frame = dawn_capture::Frame {
        width: outcome.width as u32,
        height: outcome.height as u32,
        rgba: outcome.rgba,
    };
    crate::output::deliver(app, frame, title)
}

#[cfg(not(windows))]
fn session(_: &AppHandle, _: Rect, _: Option<isize>, _: Option<String>) -> Result<(), String> {
    Err("Scrolling screenshots need Windows.".into())
}

/// A window that never takes the focus, is left out of the pictures and lets the mouse through when `through`.
#[cfg(windows)]
fn overlay_window(
    app: &AppHandle,
    label: &str,
    (x, y): (i32, i32),
    (w, h): (u32, u32),
    through: bool,
) {
    let built =
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
            .title(match label {
                "scrollpill" => "Snipmunk – Scrolling pill",
                _ => "Snipmunk – Scrolling frame",
            })
            .decorations(false)
            .transparent(true)
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .resizable(false)
            .visible(false)
            .build();
    if let Ok(win) = built {
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        if through {
            let _ = win.set_ignore_cursor_events(true);
        }
        crate::webview::exclude_from_capture(&win);
        win::no_activate(&win);
        win::show_no_activate(&win);
    }
}

#[cfg(windows)]
fn show_frame(app: &AppHandle, area: Rect) {
    let margin = 4;
    overlay_window(
        app,
        "scrollframe",
        (area.x - margin, area.y - margin),
        (area.w + 2 * margin as u32, area.h + 2 * margin as u32),
        true,
    );
}

#[cfg(windows)]
fn show_pill(app: &AppHandle, area: Rect) {
    THUMB.lock().unwrap_or_else(|e| e.into_inner()).clear();
    let mon = win::monitor_rect_at(area.center().0, area.center().1).unwrap_or(area);
    let scale = win::scale_at(area.center().0, area.center().1);
    let (w, h) = ((340.0 * scale) as u32, (104.0 * scale) as u32);
    let x = mon.x + (mon.w as i32 - w as i32) / 2;
    let y = mon.y + (12.0 * scale) as i32;
    overlay_window(app, "scrollpill", (x, y), (w, h), false);
}

fn close_pill(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("scrollpill") {
        let _ = w.close();
    }
}

fn close_frame(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("scrollframe") {
        let _ = w.close();
    }
}

// --- development-only test windows ---------------------------------------------------------------------------------------------

/// Development only: make a test window with generated content ("web": a WebView2 page with a sticky header and footer and lazy
/// images; "edit": a native multi-line edit control), scroll it the way a user would (steady down, back up, down again, one jump that
/// is too fast and the way back), finish, and check the result against the known content. Returns the numbers.
#[cfg(all(windows, debug_assertions))]
#[tauri::command]
pub async fn dev_scroll_test(
    app: AppHandle,
    kind: String,
    items: Option<u32>,
) -> CmdResult<serde_json::Value> {
    devtest::run(app, kind, items.unwrap_or(300))
        .await
        .map_err(|e| crate::error::CmdError::new("capture", e))
}

#[cfg(not(all(windows, debug_assertions)))]
#[tauri::command]
pub fn dev_scroll_test() -> CmdResult<()> {
    Err(crate::error::CmdError::new(
        "unavailable",
        "the test windows exist in development builds only",
    ))
}

#[cfg(windows)]
pub(crate) mod win {
    use super::{Rect, Shot, Source};
    use std::sync::mpsc::SyncSender;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_RETURN};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongPtrW, SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE,
        SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    pub const VK_ENTER: i32 = VK_RETURN.0 as i32;

    /// Is a key down right now? (Read from the keyboard state; nothing is sent.)
    pub fn key_down(vk: i32) -> bool {
        // SAFETY: a plain query of the keyboard state.
        unsafe { GetAsyncKeyState(vk) as u16 & 0x8000 != 0 }
    }

    /// The client area of a window on the desktop (physical pixels).
    pub fn client_rect(hwnd: isize) -> Option<Rect> {
        let h = HWND(hwnd as *mut _);
        let mut r = RECT::default();
        let mut p = POINT { x: 0, y: 0 };
        // SAFETY: a window handle and valid out pointers.
        unsafe {
            GetClientRect(h, &mut r).ok()?;
            if !ClientToScreen(h, &mut p).as_bool() {
                return None;
            }
        }
        let (w, hh) = (
            (r.right - r.left).max(0) as u32,
            (r.bottom - r.top).max(0) as u32,
        );
        (w > 0 && hh > 0).then(|| Rect::new(p.x, p.y, w, hh))
    }

    /// Every monitor of the desktop: its place (physical pixels) and its scale.
    pub fn monitors() -> Vec<(Rect, f64)> {
        use windows::core::BOOL;
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
        unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            // SAFETY: `data` is the vector passed below, alive for the whole call.
            let v = unsafe { &mut *(data.0 as *mut Vec<(Rect, f64)>) };
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            // SAFETY: a valid monitor handle and out pointer.
            if unsafe { GetMonitorInfoW(m, &mut info) }.as_bool() {
                let r = info.rcMonitor;
                let c = ((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                v.push((
                    Rect::new(
                        r.left,
                        r.top,
                        (r.right - r.left) as u32,
                        (r.bottom - r.top) as u32,
                    ),
                    scale_at(c.0, c.1),
                ));
            }
            BOOL(1)
        }
        let mut v: Vec<(Rect, f64)> = Vec::new();
        // SAFETY: the callback only uses the vector behind the pointer.
        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut v as *mut _ as isize));
        }
        v
    }

    /// The place of a window on the desktop.
    pub fn window_rect(hwnd: isize) -> Rect {
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
        let mut r = RECT::default();
        // SAFETY: a window handle and a valid out pointer.
        unsafe {
            let _ = GetWindowRect(HWND(hwnd as *mut _), &mut r);
        }
        Rect::new(
            r.left,
            r.top,
            (r.right - r.left).max(1) as u32,
            (r.bottom - r.top).max(1) as u32,
        )
    }

    pub fn monitor_rect_at(x: i32, y: i32) -> Option<Rect> {
        monitor_at(x, y).map(|m| m.1)
    }

    fn monitor_at(x: i32, y: i32) -> Option<(usize, Rect)> {
        // SAFETY: plain queries with valid out pointers.
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(m, &mut info).as_bool().then(|| {
                (
                    m.0 as usize,
                    Rect::new(
                        info.rcMonitor.left,
                        info.rcMonitor.top,
                        (info.rcMonitor.right - info.rcMonitor.left) as u32,
                        (info.rcMonitor.bottom - info.rcMonitor.top) as u32,
                    ),
                )
            })
        }
    }

    pub fn scale_at(x: i32, y: i32) -> f64 {
        use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
        // SAFETY: plain queries with valid out pointers.
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let (mut dx, mut dy) = (96u32, 96u32);
            let _ = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            dx as f64 / 96.0
        }
    }

    /// Not activated by a click, not in Alt+Tab.
    pub fn no_activate(win: &tauri::WebviewWindow) {
        if let Ok(h) = win.hwnd() {
            let hwnd = HWND(h.0);
            // SAFETY: a valid window handle of this process.
            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
                );
            }
        }
    }

    /// Shown without taking the focus.
    pub fn show_no_activate(win: &tauri::WebviewWindow) {
        if let Ok(h) = win.hwnd() {
            // SAFETY: a valid window handle of this process.
            unsafe {
                let _ = ShowWindow(HWND(h.0), SW_SHOWNOACTIVATE);
            }
        }
    }

    /// What the capture callback needs.
    pub struct Feed {
        tx: SyncSender<Shot>,
        /// Cut this out of the picture (x, y, w, h), for an area of a monitor.
        crop: Option<(u32, u32, u32, u32)>,
        last: Mutex<Instant>,
    }

    pub struct Handler {
        feed: Arc<Feed>,
    }

    type Error = Box<dyn std::error::Error + Send + Sync>;

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Arc<Feed>;
        type Error = Error;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self { feed: ctx.flags })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            _control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            // About 15 pictures a second at most (the settings ask for it too; this is the safety net).
            {
                let mut last = self.feed.last.lock().unwrap_or_else(|e| e.into_inner());
                if last.elapsed() < Duration::from_millis(55) {
                    return Ok(());
                }
                *last = Instant::now();
            }
            let (x, y, w, h) = self
                .feed
                .crop
                .unwrap_or((0, 0, frame.width(), frame.height()));
            let buffer = frame.buffer_crop(x, y, x + w, y + h)?;
            let mut scratch = Vec::new();
            let rows = buffer.as_nopadding_buffer(&mut scratch);
            // A full channel means the canvas is busy: this picture is dropped (a newer one follows).
            let _ = self
                .feed
                .tx
                .try_send((rows.to_vec(), w as usize, h as usize));
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    pub struct Capture(Option<CaptureControl<Handler, Error>>);

    impl Drop for Capture {
        fn drop(&mut self) {
            if let Some(c) = self.0.take() {
                let _ = c.stop();
            }
        }
    }

    /// Start taking pictures of the source (no cursor in them); they arrive on the channel.
    pub fn start_capture(src: Source, tx: SyncSender<Shot>) -> Result<Capture, String> {
        macro_rules! settings {
            ($item:expr, $feed:expr) => {
                Settings::new(
                    $item,
                    CursorCaptureSettings::WithoutCursor,
                    DrawBorderSettings::WithoutBorder,
                    SecondaryWindowSettings::Default,
                    MinimumUpdateIntervalSettings::Custom(Duration::from_millis(60)),
                    DirtyRegionSettings::Default,
                    ColorFormat::Bgra8,
                    $feed,
                )
            };
        }
        let control = match src {
            Source::Screen(area) => {
                let (hmon, mon) =
                    monitor_at(area.x + area.w as i32 / 2, area.y + area.h as i32 / 2)
                        .ok_or("the monitor could not be found")?;
                let crop = (
                    (area.x - mon.x).max(0) as u32,
                    (area.y - mon.y).max(0) as u32,
                    area.w.min(mon.w),
                    area.h.min(mon.h),
                );
                let feed = Arc::new(Feed {
                    tx,
                    crop: Some(crop),
                    last: Mutex::new(Instant::now() - Duration::from_secs(1)),
                });
                Handler::start_free_threaded(settings!(
                    Monitor::from_raw_hmonitor(hmon as *mut _),
                    feed
                ))
            }
            Source::Window(hwnd) => {
                let feed = Arc::new(Feed {
                    tx,
                    crop: None,
                    last: Mutex::new(Instant::now() - Duration::from_secs(1)),
                });
                Handler::start_free_threaded(settings!(Window::from_raw_hwnd(hwnd as *mut _), feed))
            }
        }
        .map_err(|e| e.to_string())?;
        Ok(Capture(Some(control)))
    }
}

#[cfg(all(windows, debug_assertions))]
mod devtest {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    use super::win;

    /// What the page looks like (a bar code of 16 cells per item: 1,0,1,0 and the 12 bits of the item's number).
    const CELL: u32 = 8;
    const MARGIN: u32 = 10;
    const HEADER: u32 = 48;
    const FOOTER: u32 = 36;

    fn page_html(items: u32) -> String {
        // Every 20th item is a tall "image" that is drawn only some time after it comes near the screen (lazy loading).
        let mut body = String::new();
        for i in 0..items {
            let lazy = i % 20 == 19;
            body.push_str(&format!(
                "<div class=\"it{}\" data-id=\"{i}\"></div>",
                if lazy { " lazy" } else { "" }
            ));
        }
        let css = format!(
            "body{{margin:0;background:#fff;overflow-y:scroll}}\
             #h{{position:sticky;top:0;height:{HEADER}px;background:#1e4b78;z-index:5}}\
             #f{{position:sticky;bottom:0;height:{FOOTER}px;background:#784b1e;z-index:5}}\
             .it{{height:24px;display:flex;align-items:center;padding-left:{MARGIN}px}}\
             .lazy{{height:120px;background:#ddd;margin-top:4px;margin-bottom:4px}}\
             .c{{width:{CELL}px;height:16px;flex:none}}"
        );
        let js = "function bars(el){var id=+el.dataset.id,bits=[1,0,1,0];for(var k=11;k>=0;k--)bits.push((id>>k)&1);\
             el.innerHTML=bits.map(function(b){return '<i class=\"c\" style=\"background:'+(b?'#000':'#fff')+'\"></i>'}).join('');el.style.background='';}\
             document.querySelectorAll('.it:not(.lazy)').forEach(bars);\
             var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){io.unobserve(e.target);setTimeout(function(){bars(e.target)},120)}})},{rootMargin:'500px'});\
             document.querySelectorAll('.lazy').forEach(function(el){io.observe(el)});";
        format!(
            "<!doctype html><html><head><meta charset=utf-8><style>{css}</style></head><body><div id=h></div>{body}<div id=f></div><script>{js}</script></body></html>"
        )
    }

    /// The bar codes in a picture (BGRA): the rows they start at and the numbers of the items, from the top to the bottom.
    pub fn read_codes(bgra: &[u8], w: usize, h: usize, dpr: f64) -> Vec<(usize, u32)> {
        let px = |x: usize, y: usize| -> bool {
            let i = (y * w + x) * 4;
            (bgra[i] as u32 + bgra[i + 1] as u32 + bgra[i + 2] as u32) / 3 < 100
        };
        let cx = |k: usize| (((MARGIN + CELL * k as u32 + CELL / 2) as f64) * dpr) as usize;
        if cx(15) >= w {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut run_start: Option<usize> = None;
        for y in 0..=h {
            let on = y < h && px(cx(0), y);
            match (on, run_start) {
                (true, None) => run_start = Some(y),
                (false, Some(s)) => {
                    let mid = (s + y) / 2;
                    // A run of 16 css px; a smaller one is a cut (a code is whole in the picture or not seen).
                    let want = (16.0 * dpr) as usize;
                    if y - s + 2 >= want {
                        let bits: Vec<bool> = (0..16).map(|k| px(cx(k), mid)).collect();
                        if bits[..4] == [true, false, true, false] {
                            let id = bits[4..].iter().fold(0u32, |a, &b| a * 2 + b as u32);
                            out.push((s, id));
                        }
                    }
                    run_start = None;
                }
                _ => {}
            }
        }
        out
    }

    pub async fn run(
        app: AppHandle,
        kind: String,
        items: u32,
    ) -> Result<serde_json::Value, String> {
        match kind.as_str() {
            "web" => run_web(app, items).await,
            "edit" => run_edit(items).await,
            _ => Err("kind is web or edit".into()),
        }
    }

    /// The common part: capture the window while `script` scrolls it, then Done.
    fn capture_while(
        hwnd: isize,
        max: usize,
        script: impl FnOnce() + Send + 'static,
    ) -> Result<Outcome, String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Shot>(3);
        let control = win::start_capture(Source::Window(hwnd), tx)?;
        let finished = Arc::new(AtomicBool::new(false));
        let f2 = finished.clone();
        let driver = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            script();
            std::thread::sleep(Duration::from_millis(500));
            f2.store(true, Ordering::SeqCst);
        });
        let ask = || finished.load(Ordering::SeqCst).then_some(End::Done);
        let out = collect(&rx, max, &ask, &|_, _| {});
        drop(control);
        let _ = driver.join();
        out
    }

    async fn pause(ms: u64) {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(Duration::from_millis(ms))
        })
        .await;
    }

    fn bgra_of(out: &Outcome) -> Vec<u8> {
        let mut v = out.rgba.clone();
        for px in v.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        v
    }

    async fn run_web(app: AppHandle, items: u32) -> Result<serde_json::Value, String> {
        let html = page_html(items);
        // The page is a file in the temp folder (data: addresses need an extra feature of the window library).
        let file = std::env::temp_dir().join("snipmunk-scroll-test.html");
        std::fs::write(&file, &html).map_err(|e| e.to_string())?;
        let url = format!(
            "file:///{}",
            file.to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/")
        )
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
        let win =
            tauri::WebviewWindowBuilder::new(&app, "scrolltest", tauri::WebviewUrl::External(url))
                .title("Snipmunk scroll test")
                .inner_size(640.0, 480.0)
                .position(60.0, 60.0)
                .always_on_top(true)
                .focused(false)
                .decorations(false)
                .visible(true)
                .build()
                .map_err(|e| e.to_string())?;
        let dpr = win.scale_factor().unwrap_or(1.0);
        let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
        pause(1500).await;
        let w2 = win.clone();
        let started = Instant::now();
        let out = tauri::async_runtime::spawn_blocking(move || {
            capture_while(hwnd, 40_000, move || {
                let go = |y: i64| {
                    let _ = w2.eval(format!("window.scrollTo(0,{y})"));
                };
                let wait = |ms: u64| std::thread::sleep(Duration::from_millis(ms));
                // Steady scrolling down.
                let mut y: i64 = 0;
                for _ in 0..40 {
                    y += 36;
                    go(y);
                    wait(70);
                }
                // Up a bit and down again.
                for _ in 0..10 {
                    y -= 30;
                    go(y);
                    wait(70);
                }
                for _ in 0..25 {
                    y += 40;
                    go(y);
                    wait(70);
                }
                // One jump that is too fast, a pause, and back up to what was captured.
                go(y + 2500);
                wait(700);
                go(y + 120);
                wait(500);
                for _ in 0..5 {
                    y += 30;
                    go(y + 120);
                    wait(70);
                }
                y += 120 + 150;
                // On to the end, steadily.
                for _ in 0..400 {
                    y += 36;
                    go(y);
                    wait(70);
                }
            })
        })
        .await
        .map_err(|e| e.to_string())??;
        let _ = win.close();
        let _ = std::fs::remove_file(&file);
        let codes = read_codes(&bgra_of(&out), out.width, out.height, dpr);
        let (mut dup, mut missing) = (0usize, 0usize);
        let mut prev: Option<u32> = None;
        for (_, id) in &codes {
            match prev {
                Some(p) if *id <= p => dup += 1,
                Some(p) if *id > p + 1 => missing += (*id - p - 1) as usize,
                _ => {}
            }
            prev = Some(*id);
        }
        // The header and the footer: coloured rows, once each.
        let px = |x: usize, y: usize| {
            let i = (y * out.width + x) * 4;
            [out.rgba[i], out.rgba[i + 1], out.rgba[i + 2]]
        };
        let header_rows = (0..out.height)
            .filter(|&y| px(3, y) == [0x1e, 0x4b, 0x78])
            .count();
        let footer_rows = (0..out.height)
            .filter(|&y| px(3, y) == [0x78, 0x4b, 0x1e])
            .count();
        Ok(serde_json::json!({
            "kind": "web", "dpr": dpr, "items": items, "width": out.width, "height": out.height,
            "codesSeen": codes.len(), "firstId": codes.first().map(|c| c.1), "lastId": codes.last().map(|c| c.1),
            "duplicated": dup, "missing": missing,
            "headerRows": header_rows, "footerRows": footer_rows,
            "headerWant": (HEADER as f64 * dpr).round(), "footerWant": (FOOTER as f64 * dpr).round(),
            "pictures": out.pictures, "lost": out.lost, "reachedMax": out.reached_max,
            "seconds": started.elapsed().as_secs_f32(),
        }))
    }

    async fn run_edit(lines: u32) -> Result<serde_json::Value, String> {
        let started = Instant::now();
        let (hwnd, edit, line_h) = edit_win::make(lines)?;
        pause(800).await;
        let out = tauri::async_runtime::spawn_blocking(move || {
            capture_while(hwnd, 40_000, move || {
                let wait = |ms: u64| std::thread::sleep(Duration::from_millis(ms));
                let scroll = |n: i32| edit_win::scroll_lines(edit, n);
                for _ in 0..40 {
                    scroll(1);
                    wait(70);
                }
                for _ in 0..8 {
                    scroll(-1);
                    wait(70);
                }
                for _ in 0..30 {
                    scroll(1);
                    wait(70);
                }
                // A jump of a hundred lines: far more than the window shows.
                scroll(100);
                wait(700);
                scroll(-90);
                wait(500);
                for _ in 0..10 {
                    scroll(-1);
                    wait(70);
                }
                for _ in 0..(lines as usize) {
                    scroll(1);
                    wait(60);
                    if edit_win::at_end(edit) {
                        break;
                    }
                }
            })
        })
        .await
        .map_err(|e| e.to_string())??;
        let (win_h, rect_h) = edit_win::sizes(hwnd, edit);
        edit_win::close(hwnd);
        // Duplicated rows: every line of the text is different, so a run of rows that is there twice is a duplicate.
        let dups = duplicate_runs(&bgra_of(&out), out.width, out.height);
        let want = win_h as i64 + (lines as i64 * line_h as i64 - rect_h as i64);
        Ok(serde_json::json!({
            "kind": "edit", "lines": lines, "lineHeight": line_h, "width": out.width, "height": out.height,
            "expectedHeight": want, "difference": out.height as i64 - want,
            "duplicatedRuns": dups, "pictures": out.pictures, "lost": out.lost,
            "seconds": started.elapsed().as_secs_f32(),
        }))
    }

    /// How many runs of 32 rows (two lines) with text in them are in the picture twice (a repeated part of the page).
    pub fn duplicate_runs(bgra: &[u8], w: usize, h: usize) -> usize {
        let cw = w.saturating_sub(24).max(1);
        let hashes: Vec<(u64, bool)> = (0..h)
            .map(|y| {
                let row = &bgra[y * w * 4..y * w * 4 + cw * 4];
                let mut hsh: u64 = 0xcbf29ce484222325;
                let mut busy = false;
                for px in row.chunks_exact(4) {
                    if px[0] != row[0] || px[1] != row[1] || px[2] != row[2] {
                        busy = true;
                    }
                    for &b in &px[..3] {
                        hsh = (hsh ^ b as u64).wrapping_mul(0x100000001b3);
                    }
                }
                (hsh, busy)
            })
            .collect();
        let mut seen = std::collections::HashMap::<Vec<u64>, usize>::new();
        let mut dups = 0;
        let mut y = 0;
        while y + 32 <= h {
            let win = &hashes[y..y + 32];
            if win.iter().filter(|p| p.1).count() >= 16 {
                let key: Vec<u64> = win.iter().map(|p| p.0).collect();
                if let Some(&at) = seen.get(&key) {
                    if y - at >= 32 {
                        dups += 1;
                    }
                } else {
                    seen.insert(key, y);
                }
            }
            y += 1;
        }
        dups
    }

    mod edit_win {
        use windows::core::w;
        use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
        use windows::Win32::Graphics::Gdi::{
            GetDC, GetTextMetricsW, ReleaseDC, SelectObject, HGDIOBJ, TEXTMETRICW,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            GetWindowRect, PostMessageW, RegisterClassW, SendMessageW, SetWindowTextW,
            TranslateMessage, CS_HREDRAW, CS_VREDRAW, ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY,
            MSG, WINDOW_STYLE, WM_CLOSE, WM_GETFONT, WNDCLASSW, WS_BORDER, WS_CHILD, WS_EX_TOPMOST,
            WS_OVERLAPPEDWINDOW, WS_VISIBLE, WS_VSCROLL,
        };

        const EM_GETRECT: u32 = 0xB2;
        const EM_LINESCROLL: u32 = 0xB6;
        const EM_GETFIRSTVISIBLELINE: u32 = 0xCE;
        const EM_GETLINECOUNT: u32 = 0xBA;

        unsafe extern "system" fn proc(h: HWND, m: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
            // SAFETY: the standard window procedure contract.
            unsafe { DefWindowProcW(h, m, wp, lp) }
        }

        /// (window, edit control, height of a text line in pixels). The window runs its own message loop.
        pub fn make(lines: u32) -> Result<(isize, isize, u32), String> {
            let (tx, rx) = std::sync::mpsc::channel::<Result<(isize, isize, u32), String>>();
            std::thread::spawn(move || {
                // SAFETY: Win32 window creation and a message loop on this thread only.
                unsafe {
                    let hi = windows::Win32::System::LibraryLoader::GetModuleHandleW(None)
                        .unwrap_or_default();
                    let class = w!("SnipmunkScrollTestEdit");
                    let wc = WNDCLASSW {
                        style: CS_HREDRAW | CS_VREDRAW,
                        lpfnWndProc: Some(proc),
                        hInstance: hi.into(),
                        lpszClassName: class,
                        ..Default::default()
                    };
                    RegisterClassW(&wc);
                    let Ok(hwnd) = CreateWindowExW(
                        WS_EX_TOPMOST,
                        class,
                        w!("Snipmunk scroll test (edit)"),
                        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                        60,
                        60,
                        640,
                        480,
                        None,
                        None,
                        Some(hi.into()),
                        None,
                    ) else {
                        let _ = tx.send(Err("the test window could not be created".into()));
                        return;
                    };
                    let mut client = RECT::default();
                    let _ =
                        windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut client);
                    let text: String = (0..lines)
                        .map(|i| {
                            format!(
                                "Line {i:05}  {}\r\n",
                                "#".repeat(((i * 7) % 23 + 3) as usize)
                            )
                        })
                        .collect();
                    let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
                    let edit = CreateWindowExW(
                        Default::default(),
                        w!("EDIT"),
                        None,
                        WINDOW_STYLE(
                            WS_CHILD.0
                                | WS_VISIBLE.0
                                | WS_VSCROLL.0
                                | WS_BORDER.0
                                | (ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY) as u32,
                        ),
                        0,
                        0,
                        client.right,
                        client.bottom,
                        Some(hwnd),
                        None,
                        Some(hi.into()),
                        None,
                    );
                    let Ok(edit) = edit else {
                        let _ = tx.send(Err("the edit control could not be created".into()));
                        return;
                    };
                    let _ = SetWindowTextW(edit, windows::core::PCWSTR(wide.as_ptr()));
                    // The height of a line: the font's metrics.
                    let font = SendMessageW(edit, WM_GETFONT, None, None).0;
                    let dc = GetDC(Some(edit));
                    let old = SelectObject(dc, HGDIOBJ(font as *mut _));
                    let mut tm = TEXTMETRICW::default();
                    let _ = GetTextMetricsW(dc, &mut tm);
                    SelectObject(dc, old);
                    ReleaseDC(Some(edit), dc);
                    let _ = tx.send(Ok((
                        hwnd.0 as isize,
                        edit.0 as isize,
                        tm.tmHeight.max(1) as u32,
                    )));
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }
            });
            rx.recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|e| e.to_string())?
        }

        pub fn scroll_lines(edit: isize, n: i32) {
            // SAFETY: a message to a window of this process.
            unsafe {
                let _ = SendMessageW(
                    HWND(edit as *mut _),
                    EM_LINESCROLL,
                    Some(WPARAM(0)),
                    Some(LPARAM(n as isize)),
                );
            }
        }

        /// Is the last line visible?
        pub fn at_end(edit: isize) -> bool {
            // SAFETY: messages to a window of this process.
            unsafe {
                let h = HWND(edit as *mut _);
                let total = SendMessageW(h, EM_GETLINECOUNT, None, None).0 as i32;
                let first = SendMessageW(h, EM_GETFIRSTVISIBLELINE, None, None).0 as i32;
                let mut r = RECT::default();
                let _ = SendMessageW(h, EM_GETRECT, None, Some(LPARAM(&mut r as *mut _ as isize)));
                first + 2 >= total - (r.bottom - r.top) / 16
            }
        }

        /// (the window's height, the height of the text rectangle of the edit control).
        pub fn sizes(hwnd: isize, edit: isize) -> (u32, u32) {
            // SAFETY: plain queries of windows of this process.
            unsafe {
                let mut w = RECT::default();
                let _ = GetWindowRect(HWND(hwnd as *mut _), &mut w);
                let mut r = RECT::default();
                let _ = SendMessageW(
                    HWND(edit as *mut _),
                    EM_GETRECT,
                    None,
                    Some(LPARAM(&mut r as *mut _ as isize)),
                );
                ((w.bottom - w.top) as u32, (r.bottom - r.top) as u32)
            }
        }

        pub fn close(hwnd: isize) {
            // SAFETY: a window of this process; its own thread's message loop ends with the window.
            unsafe {
                let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
                let _ = DestroyWindow(HWND(hwnd as *mut _));
            }
        }
    }

    #[allow(dead_code)]
    fn unused(_: AtomicUsize) {}
}
