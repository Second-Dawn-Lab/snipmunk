//! Screen recording (Phase 7-B).
//!
//! Technology: `windows-capture` (MIT) wraps Windows.Graphics.Capture (the screen or a window, the cursor left out) and the
//! Media Foundation H.264 encoder of the system (`MediaTranscoder`, hardware where the GPU offers it, software otherwise), which
//! writes the MP4 to disk while recording. This module owns the recording folder, the state of the running recording and the
//! capture card that is made when it stops. The platform-specific part is in `win`, so a macOS recorder (ScreenCaptureKit,
//! Phase 9) can be added next to it.
//!
//! A recording is a "video" capture: its folder `recordings/<id>/` in the session holds `screen.mp4` (the screen without the
//! cursor), the first frame as `first.png` (the card's picture) and `recording.json`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::AppState;
use crate::error::{CmdError, CmdResult};
use crate::geometry::Rect;
use crate::sessions::Session;

/// The areas a recording can have (there is no freeform recording).
pub const MODES: [&str; 3] = ["rectangle", "window", "fullscreen"];

/// The bitrate for a size, frame rate and quality: bits per pixel and frame, at least 2 and at most 80 Mbit/s.
pub fn bitrate_for(width: u32, height: u32, fps: u32, quality: &str) -> u32 {
    // Screen content is mostly still, so little is needed: about 0.02 bits per pixel and frame for Standard (3440x1440 at 30 fps
    // is 3 Mbit/s, about 22 MB a minute at most) and twice that for High.
    let bits_per_pixel = if quality == "high" { 0.04 } else { 0.02 };
    let bits = width as f64 * height as f64 * fps as f64 * bits_per_pixel;
    bits.clamp(1_500_000.0, 60_000_000.0) as u32
}

/// H.264 needs even sizes: a size rounded down to even numbers (at least 2).
pub fn even(n: u32) -> u32 {
    (n - n % 2).max(2)
}

/// What is saved next to the video (`recording.json`); later steps add the effects, the webcam layout and the trim.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordingInfo {
    pub version: u32,
    pub screen_file: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub quality: String,
    pub duration_ms: u64,
    pub frames: u64,
    /// Unix time (ms) when the recording started.
    pub started_at: u64,
    /// "monitor" or "window".
    pub source: String,
}

/// The rows of a BGRA picture in reverse order. A raw buffer given to the Media Foundation encoder is read as a bottom-up bitmap
/// (the first row in the buffer is the bottom row of the picture), while the rows of a captured frame run top to bottom: a
/// cropped frame sent as it is would be saved upside down.
pub fn flip_rows(src: &[u8], width_px: usize, height_px: usize) -> Vec<u8> {
    let stride = width_px * 4;
    let mut out = Vec::with_capacity(src.len());
    for y in (0..height_px).rev() {
        out.extend_from_slice(&src[y * stride..(y + 1) * stride]);
    }
    out
}

/// One BGRA frame (top row first) of the generated test pattern: a red square top left, a blue one bottom right and a white bar
/// that moves with `i` over a slowly shifting gradient. Used to test the pipeline without the screen.
pub fn test_pattern(w: usize, h: usize, i: usize) -> Vec<u8> {
    let mut f = vec![255u8; w * h * 4];
    let sq = (h / 6).max(4);
    let bar_x = (i * 7) % w.max(1);
    for y in 0..h {
        for x in 0..w {
            let at = (y * w + x) * 4;
            // BGRA
            let (b, g, r) = if x < sq && y < sq {
                (0, 0, 255)
            } else if x >= w - sq && y >= h - sq {
                (255, 0, 0)
            } else if x >= bar_x && x < bar_x + 8 {
                (255, 255, 255)
            } else {
                (((x + i) % 200) as u8 + 20, (y % 200) as u8 + 20, 90)
            };
            f[at..at + 4].copy_from_slice(&[b, g, r, 255]);
        }
    }
    f
}

/// What the page is told about the state of the recorder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingState {
    pub recording: bool,
    /// Unix time (ms) when it started.
    pub started_at: u64,
    /// Paused: the timer stands still and no picture is recorded.
    pub paused: bool,
    /// The recorded time so far in ms (pauses not counted), as of the moment this state was made.
    pub elapsed_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The running recording (one at a time).
///
/// Whether a recording runs, and since when, is kept in atomics: the page asks for it from synchronous commands that run on the
/// main thread, and the main thread must never wait for a lock that another thread holds while it waits for the main thread
/// (that was the freeze of every recording: the start held the lock across window calls, and `recording_state` waited for it).
pub struct Recorder {
    active: Mutex<Option<Active>>,
    running: AtomicBool,
    started_at: AtomicU64,
    /// Unix time (ms) when the pause began (0 = not paused) and the time spent paused before it.
    paused_since: AtomicU64,
    paused_total: AtomicU64,
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
            running: AtomicBool::new(false),
            started_at: AtomicU64::new(0),
            paused_since: AtomicU64::new(0),
            paused_total: AtomicU64::new(0),
        }
    }

    /// The state for the page; reads atomics only.
    fn state(&self) -> RecordingState {
        let started = self.started_at.load(Ordering::SeqCst);
        let since = self.paused_since.load(Ordering::SeqCst);
        let total = self.paused_total.load(Ordering::SeqCst);
        let now = now_ms();
        let end = if since > 0 { since } else { now };
        RecordingState {
            recording: self.running.load(Ordering::SeqCst),
            started_at: started,
            paused: since > 0,
            elapsed_ms: if started > 0 {
                end.saturating_sub(started).saturating_sub(total)
            } else {
                0
            },
        }
    }

    /// Claim the recorder for a start; false when a recording runs or is starting.
    fn claim(&self) -> bool {
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn release(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.started_at.store(0, Ordering::SeqCst);
        self.paused_since.store(0, Ordering::SeqCst);
        self.paused_total.store(0, Ordering::SeqCst);
    }

    /// The running recording, taken out (the lock is held only for this).
    fn take(&self) -> Option<Active> {
        let active = self.active.lock().unwrap().take();
        self.release();
        active
    }
}

struct Active {
    #[cfg(windows)]
    handle: win::Handle,
    dir: PathBuf,
    /// The folder relative to the session folder (`recordings/<id>`).
    rel_dir: String,
    info: RecordingInfo,
    started: std::time::Instant,
}

/// Is a recording running?
pub fn is_recording(app: &AppHandle) -> bool {
    app.state::<Recorder>().running.load(Ordering::SeqCst)
}

fn announce(app: &AppHandle, recording: bool, _started_at: u64) {
    crate::tray::set_recording(app, recording);
    let _ = app.emit("recording-state", app.state::<Recorder>().state());
}

/// Pause (`true`) or resume (`false`) the recording: a pause ends the segment being written, the resume starts the next one.
#[tauri::command]
pub async fn pause_recording(
    app: AppHandle,
    recorder: State<'_, Recorder>,
    pause: bool,
) -> CmdResult<RecordingState> {
    if !recorder.running.load(Ordering::SeqCst) {
        return Err(CmdError::new("not_running", "no recording is running"));
    }
    let paused = recorder.paused_since.load(Ordering::SeqCst) > 0;
    if pause != paused {
        {
            let guard = recorder.active.lock().unwrap();
            let Some(active) = guard.as_ref() else {
                return Err(CmdError::new("not_running", "no recording is running"));
            };
            #[cfg(windows)]
            if pause {
                active.handle.pause();
            } else {
                active.handle.resume();
            }
            #[cfg(not(windows))]
            let _ = active;
        }
        let now = now_ms();
        if pause {
            recorder.paused_since.store(now, Ordering::SeqCst);
        } else {
            let since = recorder.paused_since.swap(0, Ordering::SeqCst);
            recorder
                .paused_total
                .fetch_add(now.saturating_sub(since), Ordering::SeqCst);
        }
    }
    let state = recorder.state();
    let _ = app.emit("recording-state", &state);
    Ok(state)
}

/// Start a recording of an area ("rectangle" | "window" | "fullscreen"). In a development build `window` names one of Snipmunk's
/// own windows to record instead (for tests: nothing else on the desktop is recorded).
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    recorder: State<'_, Recorder>,
    state: State<'_, AppState>,
    mode: String,
    window: Option<String>,
) -> CmdResult<()> {
    if !MODES.contains(&mode.as_str()) {
        return Err(CmdError::new(
            "bad_request",
            "this recording area does not exist",
        ));
    }
    if recorder.running.load(Ordering::SeqCst) {
        return Err(CmdError::new("busy", "a recording is already running"));
    }
    let _ = &state;
    if let Some(label) = window.filter(|_| cfg!(debug_assertions)) {
        // For tests: one of Snipmunk's own windows (captured as a window, nothing else on the desktop). There is deliberately no
        // test path for an area: it would capture the monitor behind the window.
        if label == "__synthetic__" {
            // The frame and the bar appear at this place and Snipmunk minimizes, as in a real recording; the video is generated.
            let area = Rect::new(120, 120, 640, 360);
            std::thread::spawn(move || begin_source(&app, area, Source::Synthetic { area }));
            return Ok(());
        }
        return start_now(&app, Source::DevWindow(label), false);
    }
    if mode == "fullscreen" {
        // The monitor under the pointer, after the countdown.
        let area = monitor_under_pointer()
            .ok_or_else(|| CmdError::new("capture", "the monitor could not be found"))?;
        std::thread::spawn(move || begin_area(&app, area, None));
        return Ok(());
    }
    // Rectangle and Window: the selection overlay with the recording modes.
    crate::commands::patch_settings(&app, serde_json::json!({ "recMode": mode }))?;
    crate::capture::trigger_recording(&app);
    Ok(())
}

/// What a recording captures.
enum Source {
    /// One of Snipmunk's own windows (development builds, for tests).
    DevWindow(String),
    /// An area of the desktop (physical pixels), or the window with this handle.
    Area { area: Rect, hwnd: Option<usize> },
    /// Development builds: generated frames (a moving test pattern) instead of the screen, through the same start, windows and
    /// stop as a real recording. Nothing of the screen is captured.
    Synthetic { area: Rect },
}

/// The area is chosen: the countdown (Esc cancels), the red frame, Snipmunk's windows out of the picture, then recording.
pub fn begin_area(app: &AppHandle, area: Rect, hwnd: Option<usize>) {
    begin_source(app, area, Source::Area { area, hwnd });
}

/// The same flow for every source: Snipmunk minimizes at once (a window that was hidden stays hidden), the red frame and the
/// floating bar appear, the bar counts down (the ✕ or Esc cancels), then the recording starts and the bar shows the timer.
fn begin_source(app: &AppHandle, area: Rect, source: Source) {
    let was_shown = app
        .get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false);
    if was_shown {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.minimize();
        }
    }
    prepare_screen(app, area);
    let countdown = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .rec_countdown;
    if countdown > 0 && !bar_countdown(app, countdown) {
        restore_screen(app);
        if was_shown {
            crate::tray::show_main(app);
        }
        return;
    }
    if let Err(e) = start_now(app, source, true) {
        restore_screen(app);
        if was_shown {
            crate::tray::show_main(app);
        }
        let _ = app.emit("capture-error", e.message);
    }
}

/// Set by the ✕ of the bar: the countdown is cancelled.
static COUNTDOWN_CANCELLED: AtomicBool = AtomicBool::new(false);

/// The ✕ of the countdown on the bar.
#[tauri::command]
pub fn cancel_countdown() {
    COUNTDOWN_CANCELLED.store(true, Ordering::SeqCst);
}

/// Count down on the floating bar (`rec-countdown` events with the seconds left). False when it was cancelled (✕ or Esc).
fn bar_countdown(app: &AppHandle, seconds: u32) -> bool {
    COUNTDOWN_CANCELLED.store(false, Ordering::SeqCst);
    // The bar needs a moment to load its page before the first digit can be shown.
    std::thread::sleep(std::time::Duration::from_millis(400));
    for left in (1..=seconds).rev() {
        let _ = app.emit("rec-countdown", left);
        for _ in 0..40 {
            if crate::webview::escape_down() || COUNTDOWN_CANCELLED.load(Ordering::SeqCst) {
                let _ = app.emit("rec-countdown", 0);
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }
    let _ = app.emit("rec-countdown", 0);
    true
}

/// The bar tells its size (CSS pixels) whenever its content changes: the window follows, around the same centre.
#[tauri::command]
pub async fn recbar_fit(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    let Some(w) = app.get_webview_window("recbar") else {
        return Ok(());
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let (nw, nh) = (
        (width * scale).ceil() as u32,
        (height * scale).ceil() as u32,
    );
    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
        let cx = pos.x + size.width as i32 / 2;
        let _ = w.set_size(tauri::PhysicalSize::new(nw, nh));
        let _ = w.set_position(tauri::PhysicalPosition::new(cx - nw as i32 / 2, pos.y));
    }
    Ok(())
}

/// The thin red frame around the recorded area and the exclusion of Snipmunk's own windows from the picture.
fn prepare_screen(app: &AppHandle, area: Rect) {
    for label in ["main", "settings"] {
        if let Some(w) = app.get_webview_window(label) {
            crate::webview::set_capture_excluded(&w, true);
        }
    }
    let margin = 4;
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "recframe",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    .visible(false)
    .build();
    if let Ok(w) = built {
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.set_position(tauri::PhysicalPosition::new(
            area.x - margin,
            area.y - margin,
        ));
        let _ = w.set_size(tauri::PhysicalSize::new(
            area.w + 2 * margin as u32,
            area.h + 2 * margin as u32,
        ));
        crate::webview::exclude_from_capture(&w);
        let _ = w.show();
    }
    show_bar(app, area);
}

/// The floating bar at the top centre of the recorded monitor: timer, stop and discard. It is excluded from the picture.
fn show_bar(app: &AppHandle, area: Rect) {
    let Some(mon) = monitor_rect_at(area.x + area.w as i32 / 2, area.y + area.h as i32 / 2) else {
        return;
    };
    // The size of the bar follows the display scaling of the main window (close enough for a bar of 48 pixels).
    let scale = app
        .get_webview_window("main")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);
    let (w, h) = ((200.0 * scale) as u32, (52.0 * scale) as u32);
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "recbar",
        tauri::WebviewUrl::App("index.html".into()),
    )
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
        let x = mon.x + (mon.w as i32 - w as i32) / 2;
        let y = mon.y + (8.0 * scale) as i32;
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        crate::webview::exclude_from_capture(&win);
        let _ = win.show();
    }
}

#[cfg(windows)]
fn monitor_rect_at(x: i32, y: i32) -> Option<Rect> {
    win::monitor_rect_at(x, y)
}

#[cfg(not(windows))]
fn monitor_rect_at(_: i32, _: i32) -> Option<Rect> {
    None
}

/// Take the red frame away and let Snipmunk's windows be captured again.
fn restore_screen(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("recbar") {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window("recframe") {
        let _ = w.close();
    }
    for label in ["main", "settings"] {
        if let Some(w) = app.get_webview_window(label) {
            crate::webview::set_capture_excluded(&w, false);
        }
    }
}

#[cfg(windows)]
fn monitor_under_pointer() -> Option<Rect> {
    win::monitor_rect_under_pointer()
}

#[cfg(not(windows))]
fn monitor_under_pointer() -> Option<Rect> {
    None
}

fn start_now(app: &AppHandle, source: Source, minimize_main: bool) -> CmdResult<()> {
    let recorder = app.state::<Recorder>();
    let state = app.state::<AppState>();
    if !recorder.claim() {
        return Err(CmdError::new("busy", "a recording is already running"));
    }
    let root = state.sessions.lock().unwrap().root().to_path_buf();
    if let Some(free) = free_bytes(&root) {
        if free < MIN_FREE_TO_START {
            recorder.release();
            let _ = app.emit("recording-notice", "disk-start");
            return Err(CmdError::new(
                "disk",
                "there is not enough free disk space to record",
            ));
        }
    }
    let focus = focus_of(&source);
    let started = prepare_and_start(app, &state, source);
    let active = match started {
        Ok(a) => a,
        Err(e) => {
            recorder.release();
            return Err(e);
        }
    };
    recorder
        .started_at
        .store(active.info.started_at, Ordering::SeqCst);
    let started_at = active.info.started_at;
    // The lock is held only to put the recording in; no window, tray or event call happens under it.
    // The settings of the recording are on disk from the start: a recovery after a crash needs them.
    let _ = write_info(&active.dir, &active.info);
    *recorder.active.lock().unwrap() = Some(active);
    announce(app, true, started_at);
    spawn_monitor(app.clone());
    if cfg!(debug_assertions) {
        spawn_watchdog(app.clone());
    }
    if minimize_main {
        // Snipmunk is out of the way already; the window being recorded gets the keyboard.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            focus_window(focus);
        });
    }
    Ok(())
}

/// The folder, the settings and the capture; nothing here is under a lock that the main thread may ask for.
fn prepare_and_start(
    app: &AppHandle,
    state: &State<'_, AppState>,
    source: Source,
) -> CmdResult<Active> {
    let (fps, quality) = {
        let s = state.settings.lock().unwrap();
        (s.rec_fps, s.rec_quality.clone())
    };
    let session_dir = state.sessions.lock().unwrap().session_dir();
    let id = format!("r{:x}", now_ms());
    let rel_dir = format!("recordings/{id}");
    let dir = session_dir.join(&rel_dir);
    std::fs::create_dir_all(&dir)?;
    start_platform(app, dir, rel_dir, fps, &quality, source)
}

/// Where the keyboard goes when Snipmunk has minimized: the recorded window, else the window in front at the area's centre.
#[derive(Clone, Copy)]
struct Focus {
    hwnd: Option<usize>,
    centre: Option<(i32, i32)>,
}

fn focus_of(source: &Source) -> Focus {
    match source {
        Source::Area { area, hwnd } => Focus {
            hwnd: *hwnd,
            centre: Some(area.center()),
        },
        // A generated recording takes the keyboard from nobody.
        Source::Synthetic { .. } => Focus {
            hwnd: None,
            centre: None,
        },
        _ => Focus {
            hwnd: None,
            centre: None,
        },
    }
}

#[cfg(windows)]
fn focus_window(focus: Focus) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    let target = focus.hwnd.map(|h| h as isize).or_else(|| {
        let (cx, cy) = focus.centre?;
        // The windows in front first, Snipmunk's own left out.
        crate::winlist::list_windows()
            .into_iter()
            .find(|w| {
                cx >= w.rect.x
                    && cx < w.rect.x + w.rect.w as i32
                    && cy >= w.rect.y
                    && cy < w.rect.y + w.rect.h as i32
            })
            .map(|w| w.hwnd)
    });
    if let Some(h) = target {
        let _ = unsafe { SetForegroundWindow(HWND(h as *mut _)) };
    }
}

#[cfg(not(windows))]
fn focus_window(_: Focus) {}

/// Development builds: a thread that asks the main thread for a sign of life every 250 ms while a recording runs and says so when
/// the answer takes more than 500 ms (the freeze of a recording would show up here).
/// Less free space than this and a recording does not start; less than half of it while recording and it is stopped and saved.
pub const MIN_FREE_TO_START: u64 = 300 * 1024 * 1024;

/// Free bytes on the disk that holds `path` (None when it cannot be told).
#[cfg(windows)]
pub fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            return None;
        }
    }
    let wide: Vec<u16> = probe.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0u64;
    // SAFETY: `wide` is NUL-terminated and `free` outlives the call.
    unsafe {
        windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            windows::core::PCWSTR(wide.as_ptr()),
            Some(&mut free),
            None,
            None,
        )
        .ok()?;
    }
    Some(free)
}

#[cfg(not(windows))]
pub fn free_bytes(_path: &Path) -> Option<u64> {
    None
}

/// While a recording runs: the disk filling up or the recorded monitor/window going away stops the recording and saves what there
/// is (a notice tells the user why). Reads atomics and the flag only; the stop runs on this thread like the tray's stop does.
fn spawn_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ticks = 0u32;
        while is_recording(&app) {
            std::thread::sleep(std::time::Duration::from_millis(500));
            ticks += 1;
            let mut reason = None;
            let dir = {
                let r = app.state::<Recorder>();
                let Ok(guard) = r.active.try_lock() else {
                    continue;
                };
                let Some(a) = guard.as_ref() else { continue };
                #[cfg(windows)]
                if a.handle.closed() {
                    reason = Some("source-gone");
                }
                a.dir.clone()
            };
            if reason.is_none() && ticks.is_multiple_of(4) {
                if let Some(free) = free_bytes(&dir) {
                    if free < MIN_FREE_TO_START / 2 {
                        reason = Some("disk-full");
                    }
                }
            }
            if let Some(kind) = reason {
                let _ = app.emit("recording-notice", kind);
                let _ = stop_now(&app);
                break;
            }
        }
    });
}

fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        while is_recording(&app) {
            let asked = std::time::Instant::now();
            let (tx, rx) = std::sync::mpsc::channel();
            if app
                .run_on_main_thread(move || {
                    let _ = tx.send(());
                })
                .is_err()
            {
                break;
            }
            if rx
                .recv_timeout(std::time::Duration::from_millis(500))
                .is_err()
            {
                eprintln!("[recording] the main thread has not answered for 500 ms");
                let _ = rx.recv_timeout(std::time::Duration::from_secs(30));
                eprintln!(
                    "[recording] the main thread answered after {} ms",
                    asked.elapsed().as_millis()
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    });
}

#[cfg(not(windows))]
fn start_platform(
    _app: &AppHandle,
    _dir: PathBuf,
    _rel_dir: String,
    _fps: u32,
    _quality: &str,
    _source: Source,
) -> CmdResult<Active> {
    Err(CmdError::new(
        "unsupported",
        "Screen recording needs Windows in this version.",
    ))
}

#[cfg(windows)]
fn start_platform(
    app: &AppHandle,
    dir: PathBuf,
    rel_dir: String,
    fps: u32,
    quality: &str,
    source: Source,
) -> CmdResult<Active> {
    let target = match source {
        Source::Area {
            hwnd: Some(hwnd),
            area,
            ..
        } => win::Target::Window {
            hwnd,
            width: area.w,
            height: area.h,
        },
        Source::Area { area, hwnd: None } => win::Target::Area {
            x: area.x,
            y: area.y,
            w: area.w,
            h: area.h,
        },
        Source::Synthetic { area } => {
            // Short segments in the test, so a recording of a few seconds has several.
            let handle = win::start_synthetic(
                &dir,
                fps,
                quality,
                even(area.w),
                even(area.h),
                std::time::Duration::from_secs(3),
            )
            .map_err(|e| CmdError::new("capture", e))?;
            return Ok(active_of(handle, dir, rel_dir, fps, quality));
        }
        Source::DevWindow(label) => {
            let w = app
                .get_webview_window(&label)
                .ok_or_else(|| CmdError::new("not_found", "this window does not exist"))?;
            let hwnd = w.hwnd().map_err(|e| CmdError::new("io", e.to_string()))?.0;
            let size = w
                .outer_size()
                .map_err(|e| CmdError::new("io", e.to_string()))?;
            win::Target::Window {
                hwnd: hwnd as usize,
                width: size.width,
                height: size.height,
            }
        }
    };
    let handle = win::start(&dir, fps, quality, target).map_err(|e| CmdError::new("capture", e))?;
    Ok(active_of(handle, dir, rel_dir, fps, quality))
}

#[cfg(windows)]
fn active_of(
    handle: win::Handle,
    dir: PathBuf,
    rel_dir: String,
    fps: u32,
    quality: &str,
) -> Active {
    let info = RecordingInfo {
        version: 1,
        screen_file: format!("{rel_dir}/screen.mp4"),
        width: handle.width,
        height: handle.height,
        fps,
        quality: quality.to_string(),
        started_at: now_ms(),
        source: handle.source.to_string(),
        ..Default::default()
    };
    Active {
        handle,
        dir,
        rel_dir,
        info,
        started: std::time::Instant::now(),
    }
}

/// Stop the recording (also from the tray and the floating bar): the file is finished and the capture card is made.
pub fn stop_now(app: &AppHandle) -> CmdResult<Session> {
    let recorder = app.state::<Recorder>();
    let state = app.state::<AppState>();
    let active = recorder
        .take()
        .ok_or_else(|| CmdError::new("not_running", "no recording is running"))?;
    announce(app, false, 0);
    finish(app, &state, active)
}

/// Stop the recording: the file is finished, the capture card is made in the active group. Returns the new session.
#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    recorder: State<'_, Recorder>,
    state: State<'_, AppState>,
) -> CmdResult<Session> {
    let active = recorder
        .take()
        .ok_or_else(|| CmdError::new("not_running", "no recording is running"))?;
    announce(&app, false, 0);
    finish(&app, &state, active)
}

/// Throw the recording away: the capture stops and its folder is deleted; no card is made.
#[tauri::command]
pub async fn discard_recording(app: AppHandle, recorder: State<'_, Recorder>) -> CmdResult<()> {
    let active = recorder
        .take()
        .ok_or_else(|| CmdError::new("not_running", "no recording is running"))?;
    announce(&app, false, 0);
    restore_screen(&app);
    #[cfg(windows)]
    {
        let _ = active.handle.stop();
    }
    let _ = std::fs::remove_dir_all(&active.dir);
    crate::tray::show_main(&app);
    Ok(())
}

#[cfg(windows)]
fn finish(app: &AppHandle, state: &State<'_, AppState>, active: Active) -> CmdResult<Session> {
    let Active {
        handle,
        dir,
        rel_dir,
        mut info,
        started,
    } = active;
    restore_screen(app);
    let stats = handle.stop().map_err(|e| CmdError::new("capture", e))?;
    info.frames = stats.frames;
    info.duration_ms = if stats.last_ms > 0 {
        stats.last_ms
    } else {
        started.elapsed().as_millis() as u64
    };
    // The segments become one video, without re-encoding; the segment files are deleted when that worked.
    let segments = crate::mp4join::readable(&stats.segments);
    if segments.is_empty() {
        return Err(CmdError::new(
            "capture",
            "nothing was recorded (no video was written)",
        ));
    }
    let joined = crate::mp4join::join(&segments, &dir.join("screen.mp4"))
        .map_err(|e| CmdError::new("capture", e))?;
    if joined.duration_ms > 0 {
        info.duration_ms = joined.duration_ms;
    }
    for s in &stats.segments {
        let _ = std::fs::remove_file(s);
    }
    write_info(&dir, &info)?;
    let _ = &rel_dir;
    let session = register(app, state, &dir, &info)?;
    // The recording is done: Snipmunk comes back to the front with the new recording selected (the page does the selecting).
    crate::tray::show_main(app);
    Ok(session)
}

/// Make the capture card of a finished recording folder (`first.png` is the picture of the card).
fn register(
    app: &AppHandle,
    state: &State<'_, AppState>,
    dir: &Path,
    info: &RecordingInfo,
) -> CmdResult<Session> {
    let png = std::fs::read(dir.join("first.png")).map_err(|_| {
        CmdError::new(
            "capture",
            "nothing was recorded (no picture arrived from the screen)",
        )
    })?;
    let image = image::load_from_memory(&png).map_err(|e| CmdError::new("io", e.to_string()))?;
    let thumb =
        crate::thumbs::thumbnail_png(&image.to_rgba8()).map_err(|m| CmdError::new("io", m))?;
    let name = recording_name();
    let wanted = state.active_group.lock().unwrap().clone();
    let (capture, group_id, session) = {
        let mut store = state.sessions.lock().unwrap();
        // A recording goes into the active group of recordings (the first one, made if needed).
        let group = match store
            .session()
            .groups
            .iter()
            .find(|g| Some(&g.id) == wanted.as_ref() && g.is_recording())
        {
            Some(g) => g.id.clone(),
            None => store.ensure_recording_group().map_err(CmdError::from)?,
        };
        let capture = store
            .add_capture(
                &group,
                Some(name),
                &png,
                Some(&thumb),
                info.width,
                info.height,
                None,
            )
            .map_err(CmdError::from)?;
        store
            .set_video(&capture.id, &info.screen_file, info.duration_ms)
            .map_err(CmdError::from)?;
        (capture, group, store.session().clone())
    };
    let _ = app.emit("session-changed", &session);
    let _ = app.emit(
        "capture-added",
        serde_json::json!({ "captureId": capture.id, "groupId": group_id }),
    );
    Ok(session)
}

/// Recording folders of the session that were cut off (segments but no joined video): a crash or a power cut. Names only.
pub fn unfinished_in(session_dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(session_dir.join("recordings")) else {
        return Vec::new();
    };
    let mut v: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter(|e| {
            let p = e.path();
            !p.join("screen.mp4").exists() && !crate::mp4join::segments_in(&p).is_empty()
        })
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    v.sort();
    v
}

/// The recordings that a crash left unfinished (the page offers to recover them when it starts).
#[tauri::command]
pub async fn unfinished_recordings(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    let dir = state.sessions.lock().unwrap().session_dir();
    Ok(unfinished_in(&dir))
}

/// Recover a cut-off recording: its readable segments are joined (what the crash cut off is lost: the last few seconds), and the
/// recording gets its card. Returns the session.
#[tauri::command]
pub async fn recover_recording(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> CmdResult<Session> {
    if !crate::sessions::is_safe_id(&id) {
        return Err(CmdError::new("invalid", "not a recording"));
    }
    let session_dir = state.sessions.lock().unwrap().session_dir();
    let dir = session_dir.join("recordings").join(&id);
    let all = crate::mp4join::segments_in(&dir);
    let segments = crate::mp4join::readable(&all);
    if segments.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(CmdError::new("capture", "nothing could be recovered"));
    }
    let joined = crate::mp4join::join(&segments, &dir.join("screen.mp4"))
        .map_err(|e| CmdError::new("capture", e))?;
    let mut info: RecordingInfo = std::fs::read(dir.join("recording.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    info.version = 1;
    info.screen_file = format!("recordings/{id}/screen.mp4");
    info.duration_ms = joined.duration_ms;
    info.frames = joined.samples;
    write_info(&dir, &info)?;
    for s in &all {
        let _ = std::fs::remove_file(s);
    }
    register(&app, &state, &dir, &info)
}

/// Throw a cut-off recording away.
#[tauri::command]
pub async fn drop_unfinished_recording(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    if !crate::sessions::is_safe_id(&id) {
        return Err(CmdError::new("invalid", "not a recording"));
    }
    let dir = state
        .sessions
        .lock()
        .unwrap()
        .session_dir()
        .join("recordings")
        .join(&id);
    if unfinished_in(dir.parent().unwrap_or(&dir)).contains(&id) {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}

#[cfg(not(windows))]
fn finish(_: &AppHandle, _: &State<'_, AppState>, _: Active) -> CmdResult<Session> {
    Err(CmdError::new(
        "unsupported",
        "Screen recording needs Windows.",
    ))
}

/// "Recording 2026-11-19 14-05" in local time.
fn recording_name() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let t = unsafe { GetLocalTime() };
        format!(
            "Recording {:04}-{:02}-{:02} {:02}-{:02}",
            t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute
        )
    }
    #[cfg(not(windows))]
    {
        "Recording".to_string()
    }
}

fn write_info(dir: &Path, info: &RecordingInfo) -> CmdResult<()> {
    let tmp = dir.join("recording.json.swap");
    std::fs::write(&tmp, serde_json::to_vec_pretty(info)?)?;
    std::fs::rename(&tmp, dir.join("recording.json"))?;
    Ok(())
}

/// Is a recording running? (The page asks when it starts.) Reads atomics: it never waits for the recorder.
#[tauri::command]
pub fn recording_state(recorder: State<'_, Recorder>) -> RecordingState {
    recorder.state()
}

#[cfg(windows)]
mod win {
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
    use windows_capture::encoder::{
        AudioSettingsBuilder, ContainerSettingsBuilder, ImageFormat, VideoEncoder,
        VideoSettingsBuilder, VideoSettingsSubType,
    };
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    type Error = Box<dyn std::error::Error + Send + Sync>;

    /// The monitor that holds a point and its place on the desktop.
    fn monitor_at(x: i32, y: i32) -> Result<(usize, i32, i32, u32, u32), String> {
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};
        let hmon = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTOPRIMARY) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(hmon, &mut info) }.as_bool() {
            return Err("the monitor could not be measured".into());
        }
        let r = info.rcMonitor;
        Ok((
            hmon.0 as usize,
            r.left,
            r.top,
            (r.right - r.left) as u32,
            (r.bottom - r.top) as u32,
        ))
    }

    /// Generated frames (no capture): a feeder thread sends the test pattern into the encoder at the frame rate, the way the crop
    /// path sends cropped frames (bottom-up), and the first frame is the card's picture.
    pub fn start_synthetic(
        dir: &Path,
        fps: u32,
        quality: &str,
        w: u32,
        h: u32,
        segment_len: std::time::Duration,
    ) -> Result<Handle, String> {
        let shared = Arc::new(Shared {
            segments: Mutex::new(Segments::new(dir, w, h, fps, quality, segment_len)),
            closed: AtomicBool::new(false),
            first_png: dir.join("first.png"),
            first_done: AtomicBool::new(false),
            crop: Mutex::new(None),
            t0: AtomicI64::new(i64::MIN),
            last_ms: AtomicU64::new(0),
            frames: AtomicU64::new(0),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let feeder = {
            let (shared, stop) = (shared.clone(), stop.clone());
            std::thread::spawn(move || {
                let step = std::time::Duration::from_micros(1_000_000 / fps.max(1) as u64);
                let started = std::time::Instant::now();
                let mut i = 0usize;
                while !stop.load(Ordering::Relaxed) {
                    let frame = super::test_pattern(w as usize, h as usize, i);
                    if i == 0 {
                        if let Some(img) = image::RgbaImage::from_raw(w, h, bgra_to_rgba(&frame)) {
                            let _ = img.save(&shared.first_png);
                        }
                    }
                    let ts = (i as i64) * (10_000_000 / fps.max(1) as i64);
                    let sent = shared
                        .segments
                        .lock()
                        .unwrap()
                        .send_buffer(&super::flip_rows(&frame, w as usize, h as usize), ts);
                    if sent.is_err() {
                        break;
                    }
                    shared
                        .last_ms
                        .store((ts / 10_000) as u64, Ordering::Relaxed);
                    shared.frames.fetch_add(1, Ordering::Relaxed);
                    i += 1;
                    let due = step * i as u32;
                    if let Some(wait) = due.checked_sub(started.elapsed()) {
                        std::thread::sleep(wait);
                    }
                }
            })
        };
        Ok(Handle {
            control: None,
            shared,
            feeder: Some((stop, feeder)),
            width: w,
            height: h,
            source: "synthetic",
        })
    }

    fn bgra_to_rgba(bgra: &[u8]) -> Vec<u8> {
        bgra.as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[2], p[1], p[0], p[3]])
            .collect()
    }

    pub fn monitor_rect_at(x: i32, y: i32) -> Option<crate::geometry::Rect> {
        let (_, mx, my, mw, mh) = monitor_at(x, y).ok()?;
        Some(crate::geometry::Rect::new(mx, my, mw, mh))
    }

    pub fn monitor_rect_under_pointer() -> Option<crate::geometry::Rect> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p).ok()? };
        let (_, x, y, w, h) = monitor_at(p.x, p.y).ok()?;
        Some(crate::geometry::Rect::new(x, y, w, h))
    }

    pub enum Target {
        /// An area of the desktop: the monitor that holds it is captured and the frames are cut to the area.
        Area { x: i32, y: i32, w: u32, h: u32 },
        Window {
            hwnd: usize,
            width: u32,
            height: u32,
        },
    }

    /// How long a segment is: a crash loses at most the segment that was being written.
    pub const SEGMENT_SECONDS: u64 = 10;

    /// The video of a recording as a row of short segments (`screen-000.mp4`, `screen-001.mp4`, ...): each is a finished MP4 as soon
    /// as its encoder is finished. A pause ends the segment and the resume starts a new one, so the joined video has no gap.
    pub struct Segments {
        dir: std::path::PathBuf,
        w: u32,
        h: u32,
        fps: u32,
        bitrate: u32,
        encoder: Option<VideoEncoder>,
        started: std::time::Instant,
        index: u32,
        paused: bool,
        segment_len: std::time::Duration,
        finishing: Vec<std::thread::JoinHandle<Result<(), String>>>,
        files: Vec<std::path::PathBuf>,
    }

    impl Segments {
        pub fn new(
            dir: &Path,
            w: u32,
            h: u32,
            fps: u32,
            quality: &str,
            segment_len: std::time::Duration,
        ) -> Self {
            Self {
                dir: dir.to_path_buf(),
                w,
                h,
                fps,
                bitrate: super::bitrate_for(w, h, fps, quality),
                encoder: None,
                started: std::time::Instant::now(),
                index: 0,
                paused: false,
                segment_len,
                finishing: Vec::new(),
                files: Vec::new(),
            }
        }

        fn open(&mut self) -> Result<(), String> {
            let path = self.dir.join(format!("screen-{:03}.mp4", self.index));
            let encoder = VideoEncoder::new(
                VideoSettingsBuilder::new(self.w, self.h)
                    .sub_type(VideoSettingsSubType::H264)
                    .frame_rate(self.fps)
                    .bitrate(self.bitrate),
                AudioSettingsBuilder::default().disabled(true),
                ContainerSettingsBuilder::default(),
                &path,
            )
            .map_err(|e| e.to_string())?;
            self.encoder = Some(encoder);
            self.files.push(path);
            self.index += 1;
            self.started = std::time::Instant::now();
            Ok(())
        }

        /// End the segment that is open: its encoder is finished on another thread (the capture goes on at once).
        fn close(&mut self) {
            if let Some(e) = self.encoder.take() {
                self.finishing.push(std::thread::spawn(move || {
                    e.finish().map_err(|e| e.to_string())
                }));
            }
        }

        /// The encoder for the next frame: a new segment when the open one is old enough or none is open. `None` while paused.
        fn current(&mut self) -> Result<Option<&mut VideoEncoder>, String> {
            if self.paused {
                return Ok(None);
            }
            if self.encoder.is_some() && self.started.elapsed() >= self.segment_len {
                self.close();
            }
            if self.encoder.is_none() {
                self.open()?;
            }
            Ok(self.encoder.as_mut())
        }

        pub fn send_frame(&mut self, frame: &Frame) -> Result<(), Error> {
            if let Some(e) = self.current()? {
                e.send_frame(frame)?;
            }
            Ok(())
        }

        pub fn send_buffer(&mut self, buffer: &[u8], ts: i64) -> Result<(), Error> {
            if let Some(e) = self.current()? {
                e.send_frame_buffer(buffer, ts)?;
            }
            Ok(())
        }

        /// A pause ends the segment; frames are dropped until the resume.
        pub fn pause(&mut self) {
            self.paused = true;
            self.close();
        }

        pub fn resume(&mut self) {
            self.paused = false;
        }

        /// End the last segment and wait for all of them: the finished segment files, in order.
        pub fn finish_all(&mut self) -> Result<Vec<std::path::PathBuf>, String> {
            self.close();
            let mut first_error = None;
            for t in self.finishing.drain(..) {
                if let Err(e) = t
                    .join()
                    .unwrap_or_else(|_| Err("a segment could not be finished".into()))
                {
                    first_error.get_or_insert(e);
                }
            }
            match first_error {
                Some(e) if self.files.is_empty() => Err(e),
                _ => Ok(self.files.clone()),
            }
        }
    }

    /// What the capture thread and the stop command share.
    struct Shared {
        segments: Mutex<Segments>,
        /// The capture item went away (the monitor was unplugged, the window closed).
        closed: AtomicBool,
        first_png: std::path::PathBuf,
        first_done: AtomicBool,
        /// Cut the frames to this part (x, y, width, height) of the monitor.
        crop: Mutex<Option<(u32, u32, u32, u32)>>,
        t0: AtomicI64,
        last_ms: AtomicU64,
        frames: AtomicU64,
    }

    pub struct Stats {
        pub frames: u64,
        pub last_ms: u64,
        /// The segment files, in order.
        pub segments: Vec<std::path::PathBuf>,
    }

    pub struct Handle {
        control: Option<CaptureControl<Handler, Error>>,
        shared: Arc<Shared>,
        /// A generated recording: the stop flag and the thread that feeds the encoder.
        feeder: Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>,
        pub width: u32,
        pub height: u32,
        pub source: &'static str,
    }

    impl Handle {
        /// Stop capturing and finish the file.
        pub fn stop(mut self) -> Result<Stats, String> {
            if let Some(c) = self.control.take() {
                c.stop().map_err(|e| e.to_string())?;
            }
            if let Some((stop, thread)) = self.feeder.take() {
                stop.store(true, Ordering::Relaxed);
                let _ = thread.join();
            }
            let segments = self.shared.segments.lock().unwrap().finish_all()?;
            Ok(Stats {
                frames: self.shared.frames.load(Ordering::Relaxed),
                last_ms: self.shared.last_ms.load(Ordering::Relaxed),
                segments,
            })
        }

        pub fn pause(&self) {
            self.shared.segments.lock().unwrap().pause();
        }

        pub fn resume(&self) {
            self.shared.segments.lock().unwrap().resume();
        }

        /// The recorded monitor or window went away.
        pub fn closed(&self) -> bool {
            self.shared.closed.load(Ordering::Relaxed)
        }
    }

    struct Handler {
        shared: Arc<Shared>,
    }

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Arc<Shared>;
        type Error = Error;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self { shared: ctx.flags })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            _control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            let s = &self.shared;
            let crop = *s.crop.lock().unwrap();
            // The first picture is the card's picture: the recorded area only (never more of the screen than is recorded).
            let first = !s.first_done.swap(true, Ordering::Relaxed);
            if first && crop.is_none() {
                let _ = frame.save_as_image(&s.first_png, ImageFormat::Png);
            }
            let ts = frame.timestamp()?.Duration;
            let t0 = match s
                .t0
                .compare_exchange(i64::MIN, ts, Ordering::Relaxed, Ordering::Relaxed)
            {
                Ok(_) => ts,
                Err(t) => t,
            };
            s.last_ms
                .store(((ts - t0).max(0) / 10_000) as u64, Ordering::Relaxed);
            {
                match crop {
                    Some((x, y, w, h)) => {
                        let mut buffer = frame.buffer_crop(x, y, x + w, y + h)?;
                        if first {
                            let _ = buffer.save_as_image(&s.first_png, ImageFormat::Png);
                        }
                        let mut scratch = Vec::new();
                        let rows = buffer.as_nopadding_buffer(&mut scratch);
                        s.segments
                            .lock()
                            .unwrap()
                            .send_buffer(&super::flip_rows(rows, w as usize, h as usize), ts)?;
                    }
                    None => s.segments.lock().unwrap().send_frame(frame)?,
                }
            }
            s.frames.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            self.shared.closed.store(true, Ordering::Relaxed);
            Ok(())
        }
    }

    pub fn start(dir: &Path, fps: u32, quality: &str, target: Target) -> Result<Handle, String> {
        // The monitor and the crop (relative to the monitor) of an area; the size that is recorded.
        let mut monitor = None;
        let mut crop = None;
        let (width, height, source) = match &target {
            Target::Area { x, y, w, h } => {
                let (hmon, mx, my, mw, mh) = monitor_at(x + (*w as i32) / 2, y + (*h as i32) / 2)?;
                monitor = Some(hmon);
                let (cx, cy) = ((x - mx).max(0) as u32, (y - my).max(0) as u32);
                let (cw, ch) = (
                    super::even((*w).min(mw - cx)),
                    super::even((*h).min(mh - cy)),
                );
                if cw < mw || ch < mh {
                    crop = Some((cx, cy, cw, ch));
                }
                (cw, ch, if crop.is_some() { "region" } else { "monitor" })
            }
            Target::Window { width, height, .. } => (*width, *height, "window"),
        };
        let (w, h) = (super::even(width), super::even(height));
        let shared = Arc::new(Shared {
            segments: Mutex::new(Segments::new(
                dir,
                w,
                h,
                fps,
                quality,
                std::time::Duration::from_secs(SEGMENT_SECONDS),
            )),
            closed: AtomicBool::new(false),
            first_png: dir.join("first.png"),
            first_done: AtomicBool::new(false),
            crop: Mutex::new(crop),
            t0: AtomicI64::new(i64::MIN),
            last_ms: AtomicU64::new(0),
            frames: AtomicU64::new(0),
        });

        macro_rules! settings {
            ($item:expr) => {
                Settings::new(
                    $item,
                    // The cursor is not recorded in the picture: it has its own track and is drawn when playing and rendering.
                    CursorCaptureSettings::WithoutCursor,
                    DrawBorderSettings::WithoutBorder,
                    SecondaryWindowSettings::Default,
                    // At most the chosen frame rate: the screen is not delivered at its own refresh rate (60 Hz and more).
                    MinimumUpdateIntervalSettings::Custom(std::time::Duration::from_micros(1_000_000 / fps.max(1) as u64)),
                    DirtyRegionSettings::Default,
                    ColorFormat::Bgra8,
                    shared.clone(),
                )
            };
        }
        let control = match target {
            Target::Area { .. } => {
                let hmon = monitor.ok_or("no monitor")?;
                Handler::start_free_threaded(settings!(Monitor::from_raw_hmonitor(hmon as *mut _)))
            }
            Target::Window { hwnd, .. } => {
                Handler::start_free_threaded(settings!(Window::from_raw_hwnd(hwnd as *mut _)))
            }
        }
        .map_err(|e| e.to_string())?;
        Ok(Handle {
            control: Some(control),
            shared,
            feeder: None,
            width: w,
            height: h,
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_even_and_the_bitrate_follows_pixels_frame_rate_and_quality() {
        assert_eq!(
            (even(1921), even(1081), even(1), even(0)),
            (1920, 1080, 2, 2)
        );
        let std = bitrate_for(1920, 1080, 30, "standard");
        let high = bitrate_for(1920, 1080, 30, "high");
        assert!(high > std && std >= 1_500_000);
        assert!(bitrate_for(1920, 1080, 60, "standard") > std);
        assert_eq!(bitrate_for(100, 100, 30, "standard"), 1_500_000);
        assert_eq!(bitrate_for(7680, 4320, 60, "high"), 60_000_000);
        // 3440x1440 at 30 fps: Standard is about 3 Mbit/s (at most ~22 MB a minute), High twice that.
        let std = bitrate_for(3440, 1440, 30, "standard") as f64;
        assert!((2_500_000.0..3_500_000.0).contains(&std));
        assert!((std * 2.0 - bitrate_for(3440, 1440, 30, "high") as f64).abs() < 10.0);
        assert!(std / 8.0 * 60.0 / 1e6 < 23.0);
    }

    #[test]
    fn a_cropped_frame_is_sent_bottom_up() {
        // A 2x3 picture: the top row is red, the middle green, the bottom blue (BGRA).
        let (r, g, b) = ([0, 0, 255, 255], [0, 255, 0, 255], [255, 0, 0, 255]);
        let top_down: Vec<u8> = [r, r, g, g, b, b].concat();
        let sent = flip_rows(&top_down, 2, 3);
        // The encoder reads the first row of the buffer as the bottom row of the picture: that must be the blue one.
        assert_eq!(&sent[0..4], &b);
        assert_eq!(&sent[8..12], &g);
        assert_eq!(&sent[16..20], &r);
        // Flipping twice gives the picture back; one row and an empty picture are unchanged.
        assert_eq!(flip_rows(&sent, 2, 3), top_down);
        assert_eq!(flip_rows(&r, 1, 1), r);
        assert!(flip_rows(&[], 4, 0).is_empty());
    }

    #[test]
    fn the_test_pattern_has_a_red_square_top_left_and_a_blue_one_bottom_right() {
        let (w, h) = (64usize, 36usize);
        let f = test_pattern(w, h, 0);
        let at = |x: usize, y: usize| &f[(y * w + x) * 4..(y * w + x) * 4 + 4];
        assert_eq!(at(1, 1), &[0, 0, 255, 255]);
        assert_eq!(at(w - 2, h - 2), &[255, 0, 0, 255]);
        // Sent bottom-up (as the crop path sends), the first row of the buffer is the bottom row of the picture.
        let sent = flip_rows(&f, w, h);
        assert_eq!(&sent[(w - 2) * 4..(w - 2) * 4 + 4], &[255, 0, 0, 255]);
    }

    /// How long the per-frame work of the crop path takes for a 3440x1440 frame (copy of the area, row reversal, copy for the
    /// encoder). Run with `--nocapture` to see it; the limit is generous (a debug build).
    #[test]
    fn the_crop_and_flip_of_an_ultrawide_frame_are_fast() {
        let (w, h) = (3440usize, 1440usize);
        let frame = vec![7u8; w * h * 4];
        let t0 = std::time::Instant::now();
        let n = 10;
        for _ in 0..n {
            let flipped = flip_rows(&frame, w, h);
            let copy = flipped.to_vec();
            assert_eq!(copy.len(), frame.len());
        }
        let ms = t0.elapsed().as_secs_f64() * 1000.0 / n as f64;
        println!("[timing] flip + copy of a 3440x1440 frame: {ms:.1} ms");
        assert!(ms < 150.0, "{ms} ms per frame is too slow for 30 fps");
    }

    #[test]
    fn the_recording_info_is_written_whole_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let info = RecordingInfo {
            version: 1,
            screen_file: "recordings/r1/screen.mp4".into(),
            width: 1920,
            height: 1080,
            fps: 30,
            quality: "standard".into(),
            duration_ms: 1500,
            frames: 45,
            started_at: 7,
            source: "monitor".into(),
        };
        write_info(dir.path(), &info).unwrap();
        let back: RecordingInfo =
            serde_json::from_slice(&std::fs::read(dir.path().join("recording.json")).unwrap())
                .unwrap();
        assert_eq!(back, info);
        assert!(!dir.path().join("recording.json.swap").exists());
    }

    #[test]
    fn an_unknown_area_is_refused_before_anything_starts() {
        assert!(MODES.contains(&"fullscreen") && !MODES.contains(&"freeform"));
    }
}

#[cfg(all(test, windows))]
mod segment_tests {
    use super::*;
    use crate::mp4join;
    use std::time::Duration;

    /// Generated frames (no screen) are written as several segments, the segments are joined without re-encoding, and the joined
    /// file has all the pictures and the sum of the lengths. Also measures the join.
    #[test]
    fn segments_of_generated_frames_join_into_one_video_with_all_the_pictures() {
        let dir =
            tempfile::tempdir_in(std::env::var("SNIPMUNK_TEST_DIR").unwrap_or_else(|_| ".".into()))
                .unwrap();
        let (w, h, fps) = (320u32, 180u32, 30u32);
        let mut seg = win::Segments::new(
            dir.path(),
            w,
            h,
            fps,
            "standard",
            Duration::from_millis(1000),
        );
        let total = 150usize; // 5 s at 30 fps, realtime-paced: 1 s segments
        let started = std::time::Instant::now();
        for i in 0..total {
            let f = flip_rows(
                &test_pattern(w as usize, h as usize, i),
                w as usize,
                h as usize,
            );
            seg.send_buffer(&f, i as i64 * (10_000_000 / fps as i64))
                .unwrap();
            if i == 60 {
                seg.pause();
                std::thread::sleep(Duration::from_millis(300));
                seg.resume();
            }
            let due = Duration::from_micros(33_333) * (i as u32 + 1);
            if let Some(wait) = due.checked_sub(started.elapsed()) {
                std::thread::sleep(wait);
            }
        }
        let files = seg.finish_all().unwrap();
        assert!(files.len() >= 3, "{} segments", files.len());
        assert_eq!(mp4join::readable(&files).len(), files.len());
        let out = dir.path().join("screen.mp4");
        let t = std::time::Instant::now();
        let joined = mp4join::join(&files, &out).unwrap();
        let took = t.elapsed();
        eprintln!(
            "join of {} segments: {} samples, {} ms of video, {:?}",
            joined.segments, joined.samples, joined.duration_ms, took
        );
        assert_eq!(joined.samples as usize, total);
        assert!(
            (4_800..=5_400).contains(&joined.duration_ms),
            "{}",
            joined.duration_ms
        );
        assert_eq!(mp4join::readable(&[out]).len(), 1);
    }

    #[test]
    fn a_segment_cut_off_by_a_crash_is_left_out_and_the_rest_is_recovered() {
        let dir =
            tempfile::tempdir_in(std::env::var("SNIPMUNK_TEST_DIR").unwrap_or_else(|_| ".".into()))
                .unwrap();
        let (w, h, fps) = (320u32, 180u32, 30u32);
        let mut seg = win::Segments::new(
            dir.path(),
            w,
            h,
            fps,
            "standard",
            Duration::from_millis(500),
        );
        for i in 0..45 {
            let f = flip_rows(
                &test_pattern(w as usize, h as usize, i),
                w as usize,
                h as usize,
            );
            seg.send_buffer(&f, i as i64 * (10_000_000 / fps as i64))
                .unwrap();
            std::thread::sleep(Duration::from_millis(33));
        }
        let files = seg.finish_all().unwrap();
        // The last segment is cut in half, as a crash would leave it.
        let last = files.last().unwrap();
        let bytes = std::fs::read(last).unwrap();
        std::fs::write(last, &bytes[..bytes.len() / 3]).unwrap();
        let all = mp4join::segments_in(dir.path());
        assert_eq!(all.len(), files.len());
        let good = mp4join::readable(&all);
        assert_eq!(good.len(), files.len() - 1);
        let joined = mp4join::join(&good, &dir.path().join("screen.mp4")).unwrap();
        assert!(joined.samples > 20);
    }
}
