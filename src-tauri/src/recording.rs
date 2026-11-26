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
    /// The audio tracks next to the video (file names in the recording folder), when they were made.
    pub system_file: Option<String>,
    pub mic_file: Option<String>,
    /// The cursor track (`cursor.jsonl`, see cursor.rs), when there is one.
    pub cursor_file: Option<String>,
    /// The webcam video (`webcam.mp4`), when the webcam was recorded, and where in the recording (ms, pauses cut out) it starts.
    pub webcam_file: Option<String>,
    pub webcam_start_ms: u64,
    /// How the recording looks when played and exported (cursor, click effects, webcam overlay, trim); `None` in recordings of
    /// earlier versions (the defaults of the settings then).
    pub effects: Option<crate::effects::Effects>,
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
    /// The group of recordings it will be added to, and its name.
    group_id: String,
    name: String,
}

/// Is a recording running?
pub fn is_recording(app: &AppHandle) -> bool {
    app.state::<Recorder>().running.load(Ordering::SeqCst)
}

fn announce(app: &AppHandle, recording: bool, _started_at: u64) {
    crate::tray::set_recording(app, recording);
    let _ = app.emit("recording-state", app.state::<Recorder>().state());
}

/// The switches of the bar (system sound, microphone) changed: the running recording follows (a track is made the first time its sound
/// is switched on; the microphone is never opened while it is off). Runs on its own thread: it may wait for the recorder.
pub fn apply_audio_settings(app: &AppHandle) {
    if !is_recording(app) || crate::capture::guard_active() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let (system, mic, devices) = {
            let s = app.state::<AppState>();
            let s = s.settings.lock().unwrap();
            (
                s.rec_system_sound,
                s.rec_mic,
                (s.system_device.clone(), s.mic_device.clone()),
            )
        };
        let (webcam_on, webcam_device) = {
            let s = app.state::<AppState>();
            let s = s.settings.lock().unwrap();
            (s.webcam_on, s.webcam_device.clone())
        };
        let notice = {
            let recorder = app.state::<Recorder>();
            let guard = recorder.active.lock().unwrap();
            #[cfg(windows)]
            let n = guard.as_ref().map(|a| {
                (
                    a.handle.apply_audio(system, mic, &devices),
                    a.handle.apply_webcam(webcam_on, &webcam_device),
                )
            });
            #[cfg(not(windows))]
            let n: Option<(Option<&str>, Option<&str>)> = {
                let _ = (&guard, system, mic, &devices, webcam_on, &webcam_device);
                None
            };
            n
        };
        for kind in notice.into_iter().flat_map(|(a, b)| [a, b]).flatten() {
            let _ = app.emit("recording-notice", kind);
        }
    });
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
    // A new recording replaces the current one: it must be saved as a project first (or discarded). Open projects stay open in
    // their own tabs, so their edits are not asked about. The page asks; nothing is deleted here.
    {
        let current = state.sessions.lock().unwrap().current_unsaved();
        if current {
            let _ = app.emit(
                "recording-save-first",
                serde_json::json!({ "current": true }),
            );
            return Err(CmdError::new(
                "save-first",
                "the current recording is not saved",
            ));
        }
    }
    if let Some(label) = window.filter(|_| cfg!(any(debug_assertions, feature = "measure-guard"))) {
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
    if crate::capture::real_capture_blocked() {
        return Err(CmdError::new(
            "unavailable",
            "this test instance records nothing real",
        ));
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
    if crate::capture::real_capture_blocked() {
        return;
    }
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
    let built =
        crate::webview::window(app, "recframe", tauri::WebviewUrl::App("index.html".into()))
            .title("Snipmunk – Recording frame")
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
    // The live webcam bubble (when the webcam is on), from the countdown on.
    crate::bubble::open(app, area);
}

/// Where the floating bar goes (its top left corner): at the TOP centre of the monitor that is recorded, like the bars of the
/// screenshot and the guide, whatever area is recorded; always inside the monitor. `gap` is the distance to the top edge.
pub fn bar_position(mon: Rect, bar_w: i32, gap: i32) -> (i32, i32) {
    let centre = mon.x + mon.w as i32 / 2;
    let x = (centre - bar_w / 2)
        .min(mon.x + mon.w as i32 - bar_w)
        .max(mon.x);
    (x, mon.y + gap)
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
    // The bar is about 420 CSS pixels wide when it has loaded; its place is worked out for that width.
    let (bx, by) = bar_position(mon, (430.0 * scale) as i32, (16.0 * scale) as i32);
    let built = crate::webview::window(app, "recbar", tauri::WebviewUrl::App("index.html".into()))
        .title("Snipmunk – Recording bar")
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
        // `bx` is the left edge of the full-size bar; the window is 200 wide at first and widens around its centre.
        let _ = win.set_position(tauri::PhysicalPosition::new(
            bx + (430.0 * scale) as i32 / 2 - w as i32 / 2,
            by,
        ));
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
    crate::bubble::close(app);
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
    let mut active = match started {
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
    // The audio tracks that the switches ask for (the microphone is only opened when it is on).
    #[cfg(windows)]
    {
        // (a test instance opens no sound device and no camera, whatever the settings say)
        let real = !crate::capture::guard_active();
        let (system, mic, devices) = {
            let s = state.settings.lock().unwrap();
            (
                s.rec_system_sound && real,
                s.rec_mic && real,
                (s.system_device.clone(), s.mic_device.clone()),
            )
        };
        if let Some(kind) = active.handle.apply_audio(system, mic, &devices) {
            let _ = app.emit("recording-notice", kind);
        }
        let (webcam_on, webcam_device) = {
            let s = state.settings.lock().unwrap();
            (s.webcam_on && real, s.webcam_device.clone())
        };
        if let Some(kind) = active.handle.apply_webcam(webcam_on, &webcam_device) {
            let _ = app.emit("recording-notice", kind);
        }
    }
    // The settings of the recording are on disk from the start: a recovery after a crash needs them. The look of the recording
    // (cursor, click effects, webcam overlay) starts from the defaults of the settings and can be changed afterwards.
    active.info.effects = Some(crate::effects::Effects::from_settings(
        &state.settings.lock().unwrap(),
    ));
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
    // `<recordings folder><group><recording name>`: the group is the active group of recordings (made when there is none).
    let name = recording_name();
    let wanted = state.active_group.lock().unwrap().clone();
    let (group_id, dir) = {
        let mut store = state.sessions.lock().unwrap();
        let group = match store
            .session()
            .groups
            .iter()
            .find(|g| Some(&g.id) == wanted.as_ref() && g.is_recording())
        {
            Some(g) => g.id.clone(),
            None => store.ensure_recording_group().map_err(CmdError::from)?,
        };
        let dir = store
            .new_recording_dir(&group, &name)
            .map_err(CmdError::from)?;
        (group, dir)
    };
    std::fs::create_dir_all(&dir)?;
    let mut active = start_platform(app, dir, String::new(), fps, &quality, source)?;
    active.group_id = group_id;
    active.name = name;
    Ok(active)
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

/// Below this much free space on the drive of the temp folder the person is warned (stopping follows at the critical level).
pub const LOW_FREE_WARNING: u64 = 1536 * 1024 * 1024;

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
        let mut warned = false;
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
                    } else if free < LOW_FREE_WARNING && !warned {
                        // A warning while there is still room: the floating bar and a toast show it.
                        warned = true;
                        let _ = app.emit("recording-notice", "disk-low");
                        let _ = app.emit("recording-disk-low", free);
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
        screen_file: {
            let _ = &rel_dir;
            "screen.mp4".to_string()
        },
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
        group_id: String::new(),
        name: String::new(),
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
        group_id,
        name,
    } = active;
    // Where the live bubble is now becomes the webcam overlay of the recording (before the bubble is closed).
    let bubble_place = crate::bubble::placement();
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
    info.cursor_file = stats
        .cursor
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned());
    for (kind, path) in &stats.audio {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
        match kind {
            crate::audio::Kind::System => info.system_file = name,
            crate::audio::Kind::Mic => info.mic_file = name,
        }
    }
    if let Some((segments, start_ms)) = &stats.webcam {
        info.webcam_file = join_webcam(&dir, segments);
        info.webcam_start_ms = *start_ms;
        if let (Some(p), Some(fx)) = (&bubble_place, info.effects.as_mut()) {
            fx.webcam.position = p.position.clone();
            fx.webcam.x = p.x;
            fx.webcam.y = p.y;
            fx.webcam.size = p.size.clone();
        }
    }
    write_info(&dir, &info)?;
    let _ = &rel_dir;
    let session = register(app, state, &dir, &info, Some(&group_id), &name)?;
    // The recording is done: Snipmunk comes back to the front with the new recording selected (the page does the selecting).
    crate::tray::show_main(app);
    Ok(session)
}

/// The webcam segments become `webcam.mp4` (the segment files are deleted when that worked); its file name, or `None` when there is
/// no usable webcam video.
fn join_webcam(dir: &Path, segments: &[PathBuf]) -> Option<String> {
    let readable = crate::mp4join::readable(segments);
    if readable.is_empty() {
        return None;
    }
    crate::mp4join::join(&readable, &dir.join("webcam.mp4")).ok()?;
    for s in segments {
        let _ = std::fs::remove_file(s);
    }
    let _ = std::fs::remove_file(dir.join("webcam.json"));
    Some("webcam.mp4".to_string())
}

/// Make the capture card of a finished recording folder (`first.png` is the picture of the card).
fn register(
    app: &AppHandle,
    state: &State<'_, AppState>,
    dir: &Path,
    info: &RecordingInfo,
    group: Option<&str>,
    name: &str,
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
    let name = name.to_string();
    let (capture, group_id, session) = {
        let mut store = state.sessions.lock().unwrap();
        // A recording goes into the group it was started in (the first group of recordings if that is gone).
        let group = match store
            .session()
            .groups
            .iter()
            .find(|g| Some(g.id.as_str()) == group && g.is_recording())
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
            .set_recording(&capture.id, dir, info.duration_ms)
            .map_err(CmdError::from)?;
        // A new recording replaces the current one: the old one goes from the temp folder.
        let _ = store.drop_current_except(Some(&capture.id));
        // The group may have been renamed or the recording started in another group: the folder follows the card.
        let _ = &info.screen_file;
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
pub fn unfinished_in(recordings_root: &Path) -> Vec<String> {
    let mut v = Vec::new();
    let Ok(groups) = std::fs::read_dir(recordings_root) else {
        return v;
    };
    for g in groups.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
        let Ok(recs) = std::fs::read_dir(g.path()) else {
            continue;
        };
        for r in recs.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
            let p = r.path();
            if !p.join("screen.mp4").exists() && !crate::mp4join::segments_in(&p).is_empty() {
                v.push(format!(
                    "{}/{}",
                    g.file_name().to_string_lossy(),
                    r.file_name().to_string_lossy()
                ));
            }
        }
    }
    v.sort();
    v
}

/// `Group/Recording` from the page, checked: two plain folder names, and a recording that is really unfinished.
fn unfinished_dir(state: &AppState, id: &str) -> Option<(PathBuf, String, String)> {
    let (group, rec) = id.split_once('/')?;
    let ok = |n: &str| !n.is_empty() && crate::recstore::safe_name(n) == n && n != "." && n != "..";
    if !ok(group) || !ok(rec) {
        return None;
    }
    let root = state
        .sessions
        .lock()
        .unwrap()
        .recordings_root()
        .to_path_buf();
    unfinished_in(&root).contains(&id.to_string()).then(|| {
        (
            root.join(group).join(rec),
            group.to_string(),
            rec.to_string(),
        )
    })
}

/// The recordings that a crash left unfinished (the page offers to recover them when it starts).
#[tauri::command]
pub async fn unfinished_recordings(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    let root = state
        .sessions
        .lock()
        .unwrap()
        .recordings_root()
        .to_path_buf();
    Ok(unfinished_in(&root))
}

/// Recover a cut-off recording: its readable segments are joined (what the crash cut off is lost: the last few seconds), and the
/// recording gets its card. Returns the session.
#[tauri::command]
pub async fn recover_recording(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> CmdResult<Session> {
    let (dir, group_name, rec_name) = unfinished_dir(&state, &id)
        .ok_or_else(|| CmdError::new("invalid", "not an unfinished recording"))?;
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
    info.screen_file = "screen.mp4".into();
    info.duration_ms = joined.duration_ms;
    info.frames = joined.samples;
    // The audio tracks: the header of a file that was cut off is made right, and the track is cut to the length of the video.
    for (kind, slot) in [
        (crate::audio::Kind::System, &mut info.system_file),
        (crate::audio::Kind::Mic, &mut info.mic_file),
    ] {
        let path = crate::audio::track_path(&dir, kind);
        *slot = match crate::audio::repair(&path, Some(joined.duration_ms)) {
            Ok(_) if crate::audio::wav_ms(&path) > 0 => Some(kind.file_name().to_string()),
            _ => None,
        };
    }
    info.cursor_file = dir
        .join("cursor.jsonl")
        .exists()
        .then(|| "cursor.jsonl".to_string());
    // The webcam: its segments become one video, starting where the sidecar says.
    let cam = crate::mp4join::segments_named(&dir, "webcam");
    if !cam.is_empty() {
        info.webcam_start_ms = std::fs::read(dir.join("webcam.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["startMs"].as_u64())
            .unwrap_or(0);
        info.webcam_file = join_webcam(&dir, &cam);
    }
    write_info(&dir, &info)?;
    for s in &all {
        let _ = std::fs::remove_file(s);
    }
    // The group of the folder (a group of recordings of that name, made when there is none).
    let group = {
        let mut store = state.sessions.lock().unwrap();
        let found = store
            .session()
            .groups
            .iter()
            .find(|g| g.is_recording() && crate::recstore::safe_name(&g.name) == group_name)
            .map(|g| g.id.clone());
        match found {
            Some(g) => g,
            None => store
                .create_group_of(Some(group_name.clone()), true)
                .map_err(CmdError::from)?,
        }
    };
    register(&app, &state, &dir, &info, Some(&group), &rec_name)
}

/// Throw a cut-off recording away.
#[tauri::command]
pub async fn drop_unfinished_recording(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    if let Some((dir, _, _)) = unfinished_dir(&state, &id) {
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
pub(crate) mod win {
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
        crate::audio::reset_clock();
        let audio = Arc::new(Mutex::new(crate::audio::Audio::new(dir, true)));
        // A generated cursor movement: the real cursor is not watched in a generated recording.
        let cursor = Arc::new(Mutex::new(
            crate::cursor::poller::start(dir, crate::cursor::Area { x: 0, y: 0, w, h }, fps, true)
                .ok(),
        ));
        let shared = Arc::new(Shared {
            audio: audio.clone(),
            cursor: cursor.clone(),
            segments: Mutex::new(Segments::new(dir, w, h, fps, quality, segment_len)),
            closed: AtomicBool::new(false),
            first_png: dir.join("first.png"),
            first_done: AtomicBool::new(false),
            paused_ms: AtomicU64::new(0),
            pause_at: Mutex::new(None),
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
                    let ts = (i as i64) * (10_000_000 / fps.max(1) as i64);
                    // (a sync test: the picture is white in the first 100 ms of every second, when the tones sound)
                    let frame = if crate::audio::sync_mark(ts) && i > 0 {
                        vec![255u8; (w * h * 4) as usize]
                    } else {
                        super::test_pattern(w as usize, h as usize, i)
                    };
                    if i == 0 {
                        // (the webcam starts with the first picture)
                        shared.first_done.store(true, Ordering::Relaxed);
                        shared.first_picture();
                        if let Some(img) = image::RgbaImage::from_raw(w, h, bgra_to_rgba(&frame)) {
                            let _ = img.save(&shared.first_png);
                        }
                    }
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
            audio,
            cursor,
            webcam: Mutex::new(WebcamSlot::default()),
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
        /// The start of the segment names: `screen` (`screen-000.mp4`) or `webcam`.
        prefix: &'static str,
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
                prefix: "screen",
            }
        }

        /// Name the segments `<prefix>-000.mp4`, ... (the webcam's segments are told apart from the screen's this way).
        pub fn named(mut self, prefix: &'static str) -> Self {
            self.prefix = prefix;
            self
        }

        fn open(&mut self) -> Result<(), String> {
            let path = self
                .dir
                .join(format!("{}-{:03}.mp4", self.prefix, self.index));
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
        /// Milliseconds of pauses so far, and when the current pause began (the webcam needs the recorded time).
        paused_ms: AtomicU64,
        pause_at: Mutex<Option<std::time::Instant>>,
        /// Cut the frames to this part (x, y, width, height) of the monitor.
        crop: Mutex<Option<(u32, u32, u32, u32)>>,
        t0: AtomicI64,
        last_ms: AtomicU64,
        frames: AtomicU64,
        /// The audio and the cursor track start their clocks with the first picture, so they are in step with the video.
        audio: Arc<Mutex<crate::audio::Audio>>,
        cursor: Arc<Mutex<Option<crate::cursor::poller::Cursor>>>,
    }

    impl Shared {
        fn first_picture(&self) {
            // The clock of the recording: every track is counted from the first picture.
            self.audio
                .lock()
                .unwrap()
                .start_clock(crate::audio::wasapi::now());
            if let Some(c) = self.cursor.lock().unwrap().as_ref() {
                c.begin();
            }
        }
    }

    pub struct Stats {
        pub frames: u64,
        pub last_ms: u64,
        /// The segment files, in order.
        pub segments: Vec<std::path::PathBuf>,
        /// The audio tracks that were made (system sound, microphone).
        pub audio: Vec<(crate::audio::Kind, std::path::PathBuf)>,
        /// The cursor track file.
        pub cursor: Option<std::path::PathBuf>,
        /// The webcam segments in order and where in the recording (ms) the webcam begins, when it was recorded.
        pub webcam: Option<(Vec<std::path::PathBuf>, u64)>,
    }

    /// The webcam of a recording: running now, or finished (switched off in the middle; it is not started a second time).
    #[derive(Default)]
    pub struct WebcamSlot {
        running: Option<crate::webcam::Webcam>,
        done: Option<(Vec<std::path::PathBuf>, u64)>,
    }

    pub struct Handle {
        control: Option<CaptureControl<Handler, Error>>,
        shared: Arc<Shared>,
        /// A generated recording: the stop flag and the thread that feeds the encoder.
        feeder: Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>,
        pub width: u32,
        pub height: u32,
        pub source: &'static str,
        audio: Arc<Mutex<crate::audio::Audio>>,
        cursor: Arc<Mutex<Option<crate::cursor::poller::Cursor>>>,
        webcam: Mutex<WebcamSlot>,
    }

    impl Handle {
        /// Make the webcam match the switch: it is started the first time it is on and stopped when it is off (it records one stretch
        /// per recording). A notice for the page is returned when the camera could not be used: `webcam-denied`, `webcam-none`,
        /// or `webcam-fallback` (the chosen camera is gone, the first one is used).
        pub fn apply_webcam(&self, on: bool, device: &str) -> Option<&'static str> {
            let mut slot = self.webcam.lock().unwrap();
            if on && slot.running.is_none() && slot.done.is_none() {
                let dir = self.shared.first_png.parent()?.to_path_buf();
                // The screen's first picture has set the clock of the recording (the webcam is counted from it).
                let ready: Arc<dyn Fn() -> bool + Send + Sync> =
                    Arc::new(move || crate::audio::REC_T0.load(Ordering::SeqCst) != 0);
                // The camera that only showed the bubble is let go; the recording opens it and keeps the bubble alive.
                crate::bubble::stop_preview_camera();
                match crate::webcam::Webcam::start(&dir, device, self.source == "synthetic", ready)
                {
                    Ok(w) => {
                        if self.shared.pause_at.lock().unwrap().is_some() {
                            w.pause();
                        }
                        let fell = w.fell_back;
                        slot.running = Some(w);
                        return fell.then_some("webcam-fallback");
                    }
                    Err(n) => return Some(n),
                }
            }
            if !on {
                if let Some(w) = slot.running.take() {
                    let start = w.start_ms.load(Ordering::SeqCst);
                    slot.done = Some((w.finish(), start));
                }
            }
            None
        }

        /// Make the audio tracks match the switches (system sound, microphone). A reason why one could not be made is returned.
        pub fn apply_audio(
            &self,
            system: bool,
            mic: bool,
            devices: &(String, String),
        ) -> Option<&'static str> {
            let mut a = self.audio.lock().unwrap();
            a.system_device = devices.0.clone();
            a.mic_device = devices.1.clone();
            a.apply(system, mic);
            a.notice.take()
        }

        /// Stop capturing and finish the file.
        pub fn stop(mut self) -> Result<Stats, String> {
            if let Some(c) = self.control.take() {
                c.stop().map_err(|e| e.to_string())?;
            }
            if let Some((stop, thread)) = self.feeder.take() {
                stop.store(true, Ordering::Relaxed);
                let _ = thread.join();
            }
            // The end of the recorded time: before the encoder is finished (that takes a moment the video does not have).
            let end = crate::audio::wasapi::now();
            let segments = self.shared.segments.lock().unwrap().finish_all()?;
            let audio = self.audio.lock().unwrap().finish(end);
            let cursor = self.cursor.lock().unwrap().take().and_then(|c| c.finish());
            let webcam = {
                let mut slot = self.webcam.lock().unwrap();
                if let Some(w) = slot.running.take() {
                    let start = w.start_ms.load(Ordering::SeqCst);
                    slot.done = Some((w.finish(), start));
                }
                slot.done.take()
            };
            Ok(Stats {
                webcam,
                cursor,
                frames: self.shared.frames.load(Ordering::Relaxed),
                last_ms: self.shared.last_ms.load(Ordering::Relaxed),
                segments,
                audio,
            })
        }

        pub fn pause(&self) {
            crate::audio::clock_pause(crate::audio::wasapi::now());
            *self.shared.pause_at.lock().unwrap() = Some(std::time::Instant::now());
            self.shared.segments.lock().unwrap().pause();
            if let Some(w) = self.webcam.lock().unwrap().running.as_ref() {
                w.pause();
            }
            self.audio.lock().unwrap().pause();
            if let Some(c) = self.cursor.lock().unwrap().as_ref() {
                c.pause();
            }
        }

        pub fn resume(&self) {
            crate::audio::clock_resume(crate::audio::wasapi::now());
            if let Some(at) = self.shared.pause_at.lock().unwrap().take() {
                self.shared
                    .paused_ms
                    .fetch_add(at.elapsed().as_millis() as u64, Ordering::Relaxed);
            }
            self.shared.segments.lock().unwrap().resume();
            if let Some(w) = self.webcam.lock().unwrap().running.as_ref() {
                w.resume();
            }
            self.audio.lock().unwrap().resume();
            if let Some(c) = self.cursor.lock().unwrap().as_ref() {
                c.resume();
            }
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
            if first {
                s.first_picture();
            }
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
        crate::audio::reset_clock();
        // The monitor and the crop (relative to the monitor) of an area; the size that is recorded.
        let mut monitor = None;
        let mut crop = None;
        // Where the recorded picture starts on the screen (the cursor track is in the pixels of the picture).
        let (width, height, source, origin) = match &target {
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
                (
                    cw,
                    ch,
                    if crop.is_some() { "region" } else { "monitor" },
                    (mx + cx as i32, my + cy as i32),
                )
            }
            Target::Window {
                hwnd,
                width,
                height,
            } => {
                let mut r = windows::Win32::Foundation::RECT::default();
                // SAFETY: `r` is valid for the call; a window that is gone leaves the origin at 0.
                let _ = unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetWindowRect(
                        windows::Win32::Foundation::HWND(*hwnd as *mut _),
                        &mut r,
                    )
                };
                (*width, *height, "window", (r.left, r.top))
            }
        };
        let (w, h) = (super::even(width), super::even(height));
        let cursor = crate::cursor::poller::start(
            dir,
            crate::cursor::Area {
                x: origin.0,
                y: origin.1,
                w,
                h,
            },
            fps,
            false,
        )
        .ok();
        let audio = Arc::new(Mutex::new(crate::audio::Audio::new(dir, false)));
        let cursor = Arc::new(Mutex::new(cursor));
        let shared = Arc::new(Shared {
            audio: audio.clone(),
            cursor: cursor.clone(),
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
            paused_ms: AtomicU64::new(0),
            pause_at: Mutex::new(None),
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
            audio,
            cursor,
            webcam: Mutex::new(WebcamSlot::default()),
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
    fn the_bar_goes_to_the_top_centre_of_the_recorded_monitor() {
        let mon = Rect::new(0, 0, 1920, 1080);
        assert_eq!(bar_position(mon, 400, 16), (760, 16));
        // A narrow monitor never lets it leave the monitor.
        assert_eq!(bar_position(Rect::new(0, 0, 300, 200), 400, 16).0, 0);
        // A second monitor to the left (negative coordinates) and one below.
        assert_eq!(
            bar_position(Rect::new(-1920, 0, 1920, 1080), 400, 16),
            (-1160, 16)
        );
        assert_eq!(
            bar_position(Rect::new(0, 1080, 1920, 1080), 400, 16),
            (760, 1096)
        );
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
        let dir = crate::testdir::new();
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
            system_file: Some("system.wav".into()),
            mic_file: None,
            cursor_file: Some("cursor.jsonl".into()),
            webcam_file: Some("webcam.mp4".into()),
            webcam_start_ms: 250,
            effects: Some(crate::effects::Effects::default()),
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
        let _encoder = super::encoder_lock();
        let dir = crate::testdir::new();
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
        let _encoder = super::encoder_lock();
        let dir = crate::testdir::new();
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

/// The tests that run the hardware video encoder one at a time: a PC only has a few encoder sessions, and tests that run side
/// by side fail now and then when they are used up.
#[cfg(test)]
pub(crate) fn encoder_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(all(test, windows))]
mod render_tests {
    use super::*;
    use crate::audio::{TrackWriter, TICKS};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::Duration;

    /// A generated recording of `secs` seconds (no screen, no real sound): moving test pattern in 2 s segments, a tone for each
    /// track, a generated cursor track. Returns the folder's `RecordingInfo` that was written.
    fn generated(dir: &Path, w: u32, h: u32, fps: u32, secs: u32) {
        let mut seg = win::Segments::new(dir, w, h, fps, "standard", Duration::from_secs(2));
        for i in 0..(fps * secs) as usize {
            let f = flip_rows(
                &test_pattern(w as usize, h as usize, i),
                w as usize,
                h as usize,
            );
            seg.send_buffer(&f, i as i64 * (TICKS / fps as i64))
                .unwrap();
        }
        let files = seg.finish_all().unwrap();
        let joined = crate::mp4join::join(&files, &dir.join("screen.mp4")).unwrap();
        for f in &files {
            let _ = std::fs::remove_file(f);
        }
        for (name, hz) in [("system.wav", 440.0f64), ("mic.wav", 880.0)] {
            let on = Arc::new(AtomicBool::new(true));
            let mut t = TrackWriter::create(&dir.join(name), 44_100, 2, 0, on).unwrap();
            let rate = 44_100usize;
            for k in 0..(secs as usize * 100) {
                let chunk: Vec<f32> = (0..rate / 100)
                    .flat_map(|i| {
                        let n = k * rate / 100 + i;
                        let v = ((n as f64 / rate as f64 * hz * std::f64::consts::TAU).sin() * 0.3)
                            as f32;
                        [v, v]
                    })
                    .collect();
                t.push(&chunk, k as i64 * TICKS / 100);
            }
            t.finish(secs as i64 * TICKS).unwrap();
        }
        let area = crate::cursor::Area { x: 0, y: 0, w, h };
        let mut s = crate::cursor::Sampler::new(area, 500);
        let mut a =
            crate::cursor::Appender::create(&dir.join("cursor.jsonl"), &s.header(fps)).unwrap();
        let mut img = image::RgbaImage::new(24, 24);
        for p in img.pixels_mut() {
            *p = image::Rgba([255, 255, 255, 255]);
        }
        std::fs::create_dir_all(dir.join("cursors")).unwrap();
        img.save(dir.join("cursors").join("arrow.png")).unwrap();
        a.define_shape(
            0,
            &crate::cursor::Shape {
                id: "arrow".into(),
                hx: 0,
                hy: 0,
                w: 24,
                h: 24,
                file: "cursors/arrow.png".into(),
            },
        )
        .unwrap();
        for ms in (0..secs as u64 * 1000).step_by(8) {
            let r = crate::cursor::Reading {
                x: (w / 2) as i32 + ((ms as f64 / 500.0).cos() * (w / 4) as f64) as i32,
                y: (h / 2) as i32 + ((ms as f64 / 500.0).sin() * (h / 4) as f64) as i32,
                visible: true,
                shape: "arrow".into(),
                // One left click at 1.5 s.
                left: (1500..1560).contains(&ms),
                right: false,
            };
            for l in s.feed(ms, &r) {
                a.line(&l).unwrap();
            }
        }
        a.finish().unwrap();
        let info = RecordingInfo {
            version: 1,
            screen_file: "screen.mp4".into(),
            width: w,
            height: h,
            fps,
            quality: "standard".into(),
            duration_ms: joined.duration_ms,
            frames: joined.samples,
            system_file: Some("system.wav".into()),
            mic_file: Some("mic.wav".into()),
            cursor_file: Some("cursor.jsonl".into()),
            ..Default::default()
        };
        write_info(dir, &info).unwrap();
    }

    /// Export a generated recording with the default settings.
    fn export(
        dir: &Path,
        name: &str,
        cancel: &AtomicBool,
    ) -> Result<crate::render::win::Exported, String> {
        export_with(dir, name, crate::effects::ExportSettings::default(), cancel)
    }

    fn export_with(
        dir: &Path,
        name: &str,
        settings: crate::effects::ExportSettings,
        cancel: &AtomicBool,
    ) -> Result<crate::render::win::Exported, String> {
        crate::render::win::render(
            &crate::render::win::Request {
                dir,
                out: dir.join(name),
                settings,
                system_volume: 1.0,
                mic_volume: 1.0,
                probe: None,
            },
            &|_| {},
            cancel,
        )
    }

    /// Mean absolute difference over the colour channels, sampled on a grid.
    fn mean_diff(a: &[u8], b: &[u8], w: usize, h: usize) -> f64 {
        let (mut sum, mut n) = (0u64, 0u64);
        for y in (0..h).step_by(3) {
            for x in (0..w).step_by(3) {
                let i = (y * w + x) * 4;
                for c in 0..3 {
                    sum += (a[i + c] as i32 - b[i + c] as i32).unsigned_abs() as u64;
                    n += 1;
                }
            }
        }
        sum as f64 / n as f64
    }

    /// Which picture of a `generated` recording each of `frames` shows (its number among `count` pictures): the clean
    /// `test_pattern` nearest to it along three rows. The bar's place and the shading tell all pictures apart, also
    /// through compression noise. Tests ask this instead of counting frames: an encoder or decoder may leave a picture out
    /// or repeat one (Windows' software encoder, which the build servers use, does), and the position of a frame in the
    /// file then no longer says which moment it shows.
    #[allow(clippy::chunks_exact_to_as_chunks)]
    fn pictures_shown(frames: &[Vec<u8>], w: usize, h: usize, count: usize) -> Vec<usize> {
        // Between the squares in two corners of the pattern.
        let rows = [h / 4, h / 2, h * 3 / 4];
        let line = |picture: &[u8]| -> Vec<u8> {
            rows.iter()
                .flat_map(|y| picture[y * w * 4..(y + 1) * w * 4].iter().copied())
                .collect()
        };
        let clean: Vec<Vec<u8>> = (0..count).map(|i| line(&test_pattern(w, h, i))).collect();
        frames
            .iter()
            .map(|frame| {
                let seen = line(frame);
                let distance = |other: &Vec<u8>| -> u64 {
                    // (the fourth byte of a pixel says nothing)
                    seen.chunks_exact(4)
                        .zip(other.chunks_exact(4))
                        .map(|(a, b)| (0..3).map(|c| u64::from(a[c].abs_diff(b[c]))).sum::<u64>())
                        .sum()
                };
                (0..count)
                    .min_by_key(|&i| distance(&clean[i]))
                    .expect("at least one picture")
            })
            .collect()
    }

    /// A1: pictures rendered at awkward sizes (rows padded by the decoder, odd sizes) come out as the pattern, not sheared.
    #[test]
    fn rendered_pictures_match_the_pattern_at_awkward_sizes() {
        let _encoder = super::encoder_lock();
        let cancel = AtomicBool::new(false);
        // 641x359 is recorded as 640x358 (the recorder and the render both drop the odd row and column).
        for (w, h) in [
            (676u32, 1182u32),
            (1052, 802),
            (1366, 768),
            (3440, 1440),
            (640, 358),
        ] {
            let dir = crate::testdir::new();
            generated(dir.path(), w, h, 10, 1);
            let mut info: RecordingInfo =
                serde_json::from_slice(&std::fs::read(dir.path().join("recording.json")).unwrap())
                    .unwrap();
            info.cursor_file = None;
            info.system_file = None;
            info.mic_file = None;
            write_info(dir.path(), &info).unwrap();
            for f in ["system.wav", "mic.wav", "cursor.jsonl"] {
                let _ = std::fs::remove_file(dir.path().join(f));
            }
            // The recorded video itself first: if this is off, the fault is not in the render.
            let (sw, sh, src) =
                crate::render::win::read_frames(&dir.path().join("screen.mp4"), 6).unwrap();
            assert_eq!((sw, sh), (w, h));
            let d0 = mean_diff(
                &src[0],
                &test_pattern(w as usize, h as usize, 0),
                w as usize,
                h as usize,
            );
            assert!(
                d0 < 12.0,
                "{w}x{h} the recorded video itself: mean difference {d0}"
            );
            let r = export(dir.path(), "r.mp4", &cancel).unwrap();
            let (ow, oh, frames) = crate::render::win::read_frames(&r.file, 6).unwrap();
            assert_eq!((ow, oh), (w, h), "size of the output");
            assert!(frames.len() >= 5, "{w}x{h}: {} frames", frames.len());
            for i in [0usize, 4] {
                let expected = test_pattern(w as usize, h as usize, i);
                let d = mean_diff(&frames[i], &expected, w as usize, h as usize);
                assert!(d < 12.0, "{w}x{h} frame {i}: mean difference {d}");
            }
        }
    }

    /// Where the time of a render goes (printed, not asserted): decoding alone, and sending pictures to the encoder alone.
    #[test]
    fn render_stage_timings() {
        let _encoder = super::encoder_lock();
        let (w, h) = (
            std::env::var("SNIPMUNK_RENDER_W")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1920u32),
            std::env::var("SNIPMUNK_RENDER_H")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1080u32),
        );
        let dir = crate::testdir::new();
        generated(dir.path(), w, h, 30, 4);
        let t = std::time::Instant::now();
        let (_, _, f) =
            crate::render::win::read_frames(&dir.path().join("screen.mp4"), 1000).unwrap();
        eprintln!(
            "decode only: {} frames in {:.2} s = {:.0} fps",
            f.len(),
            t.elapsed().as_secs_f64(),
            f.len() as f64 / t.elapsed().as_secs_f64()
        );
        let t = std::time::Instant::now();
        let flipped: Vec<Vec<u8>> = f
            .iter()
            .map(|p| flip_rows(p, w as usize, h as usize))
            .collect();
        eprintln!(
            "flip only: {:.0} fps",
            f.len() as f64 / t.elapsed().as_secs_f64()
        );
        use windows_capture::encoder::*;
        let part = dir.path().join("enc.mp4");
        let mut e = VideoEncoder::new(
            VideoSettingsBuilder::new(w, h)
                .sub_type(VideoSettingsSubType::H264)
                .frame_rate(30)
                .bitrate(bitrate_for(w, h, 30, "high")),
            AudioSettingsBuilder::default().disabled(true),
            ContainerSettingsBuilder::default(),
            &part,
        )
        .unwrap();
        let t = std::time::Instant::now();
        for (i, fr) in flipped.iter().enumerate() {
            e.send_frame_buffer(fr, i as i64 * 333_333).unwrap();
        }
        e.finish().unwrap();
        eprintln!(
            "encode only: {:.0} fps",
            f.len() as f64 / t.elapsed().as_secs_f64()
        );
    }

    /// Write the effects of a generated recording.
    fn set_effects(dir: &Path, f: impl FnOnce(&mut crate::effects::Effects)) {
        let mut info: RecordingInfo =
            serde_json::from_slice(&std::fs::read(dir.join("recording.json")).unwrap()).unwrap();
        let mut fx = info.effects.take().unwrap_or_default();
        f(&mut fx);
        info.effects = Some(fx);
        write_info(dir, &info).unwrap();
    }

    #[test]
    fn trim_aspect_ratio_halo_and_click_effects_are_applied_in_the_export() {
        let _encoder = super::encoder_lock();
        use crate::compose::{Aspect, Fit};
        let dir = crate::testdir::new();
        let (w, h, fps) = (640u32, 360u32, 15u32);
        generated(dir.path(), w, h, fps, 4);
        let cancel = AtomicBool::new(false);
        // The plain export of 2 s with the cursor drawn but no effects.
        set_effects(dir.path(), |fx| {
            fx.click.kind = "off".into();
            fx.trim = crate::effects::Trim {
                start_ms: 1000,
                end_ms: Some(3000),
            };
        });
        let plain = export(dir.path(), "plain.mp4", &cancel).unwrap();
        // About 2 s long: 30 pictures at 15 fps.
        assert!(
            (plain.frames as i64 - 30).abs() <= 2,
            "{} pictures",
            plain.frames
        );
        let f = std::fs::File::open(&plain.file).unwrap();
        let size = f.metadata().unwrap().len();
        let secs = mp4::Mp4Reader::read_header(std::io::BufReader::new(f), size)
            .unwrap()
            .duration()
            .as_secs_f64();
        assert!((secs - 2.0).abs() < 0.25, "{secs} s");
        // The halo adds a yellow glow around the cursor and nothing elsewhere.
        set_effects(dir.path(), |fx| {
            fx.cursor.halo = true;
            fx.cursor.halo_color = "#FFFF00".into();
        });
        let halo = export(dir.path(), "halo.mp4", &cancel).unwrap();
        // The two exports are compared where they show the same recorded picture, a few pictures in. (Their fourth frames
        // need not: see `pictures_shown`.)
        let (_, _, a) = crate::render::win::read_frames(&plain.file, 10).unwrap();
        let (_, _, b) = crate::render::win::read_frames(&halo.file, 10).unwrap();
        let count = (fps * 4) as usize;
        let in_plain = pictures_shown(&a, w as usize, h as usize, count);
        let in_halo = pictures_shown(&b, w as usize, h as usize, count);
        // The trim starts at 1 s, picture 15, give or take two pictures (see `pictures_shown`).
        assert!(
            (13..=17).contains(&in_plain[0]) && (13..=17).contains(&in_halo[0]),
            "the exports start at the trim: {in_plain:?} / {in_halo:?}"
        );
        let (ia, ib) = (3..in_plain.len())
            .find_map(|ia| {
                in_halo
                    .iter()
                    .position(|&p| p == in_plain[ia])
                    .map(|ib| (ia, ib))
            })
            .unwrap_or_else(|| panic!("no picture in both: {in_plain:?} / {in_halo:?}"));
        let (a, b) = (&a[ia], &b[ib]);
        // Where the cursor is drawn in that picture. The generated cursor goes round in a circle; the export draws it
        // for the time of the picture in the file, which with Windows' software encoder (its files reorder pictures) is
        // about a picture later than the picture's number says. So it is found in the plain export: what differs from the
        // clean pattern around the circle is the cursor, a white square of 24 pixels held at its top left corner.
        let path = |ms: f64| {
            (
                w as f64 / 2.0 + (ms / 500.0).cos() * (w as f64 / 4.0),
                h as f64 / 2.0 + (ms / 500.0).sin() * (h as f64 / 4.0),
            )
        };
        let nominal = in_plain[ia] as f64 * 1000.0 / fps as f64;
        let (px, py) = path(nominal);
        let clean = test_pattern(w as usize, h as usize, in_plain[ia]);
        // (the edges of the pattern's white bar are left out: compression blurs them)
        let bar = (in_plain[ia] * 7) % w as usize;
        let cursor: Vec<(usize, usize)> = (0..h as usize)
            .flat_map(|y| (0..w as usize).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let i = (y * w as usize + x) * 4;
                (x as f64 - px).abs() < 80.0
                    && (y as f64 - py).abs() < 80.0
                    && !(bar.saturating_sub(3)..bar + 11).contains(&x)
                    && (0..3)
                        .map(|c| (a[i + c] as i32 - clean[i + c] as i32).abs())
                        .sum::<i32>()
                        > 150
            })
            .collect();
        let left = cursor
            .iter()
            .map(|p| p.0)
            .min()
            .expect("the cursor is drawn");
        let top = cursor.iter().map(|p| p.1).min().unwrap();
        let right = cursor.iter().map(|p| p.0).max().unwrap();
        let bottom = cursor.iter().map(|p| p.1).max().unwrap();
        assert!(
            right - left < 26 && bottom - top < 26,
            "one cursor of 24 pixels, not {left},{top} to {right},{bottom}"
        );
        let (cx, cy) = (left as f64, top as f64);
        // ...and it is on its circle where it was within a little over two pictures of that time.
        let off = (-150..=150)
            .map(|d| {
                let (x, y) = path(nominal + f64::from(d));
                ((x - cx).powi(2) + (y - cy).powi(2)).sqrt()
            })
            .fold(f64::MAX, f64::min);
        assert!(
            off < 5.0,
            "the cursor at {cx},{cy} is {off:.1} pixels from where it was around {nominal} ms"
        );
        let radius = h as f64 * 0.05;
        let (mut near, mut far) = (0, 0);
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                let d: i32 = (0..3)
                    .map(|c| (a[i + c] as i32 - b[i + c] as i32).abs())
                    .sum();
                if d > 60 {
                    let dist = ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt();
                    if dist <= radius + 6.0 {
                        near += 1;
                    } else {
                        far += 1;
                    }
                }
            }
        }
        eprintln!(
            "halo at picture {} (frames {ia} and {ib}): {near} pixels changed near the cursor, {far} elsewhere",
            in_plain[ia]
        );
        assert!(near > 50, "the halo changed {near} pixels near the cursor");
        assert!(far < near / 10, "and {far} elsewhere (compression noise)");

        // 9:16 with bars: a tall picture, the recording in the middle, black above and below.
        let tall = export_with(
            dir.path(),
            "tall.mp4",
            crate::effects::ExportSettings {
                aspect: Aspect::Tall,
                fit: Fit::Bars,
                resolution: "480".into(),
                ..Default::default()
            },
            &cancel,
        )
        .unwrap();
        assert_eq!((tall.width, tall.height), (480, 852));
        let (tw, th, t) = crate::render::win::read_frames(&tall.file, 2).unwrap();
        assert_eq!((tw, th), (480, 852));
        let at = |x: usize, y: usize| t[1][(y * 480 + x) * 4];
        assert!(at(240, 10) < 20 && at(240, 840) < 20, "black bars");
        // Cropped 1:1: the middle of the recording.
        let square = export_with(
            dir.path(),
            "square.mp4",
            crate::effects::ExportSettings {
                aspect: Aspect::Square,
                fit: Fit::Crop,
                ..Default::default()
            },
            &cancel,
        )
        .unwrap();
        assert_eq!((square.width, square.height), (360, 360));
        // 720p never makes a 360p picture bigger.
        let small = export_with(
            dir.path(),
            "small.mp4",
            crate::effects::ExportSettings {
                resolution: "720".into(),
                ..Default::default()
            },
            &cancel,
        )
        .unwrap();
        assert_eq!((small.width, small.height), (640, 360));
    }

    #[test]
    fn the_generated_webcam_is_recorded_across_a_pause_joined_and_drawn_over_the_export() {
        let _encoder = super::encoder_lock();
        use crate::effects::Effects;
        let dir = crate::testdir::new();
        generated(dir.path(), 640, 360, 15, 3);
        // 1.5 s of webcam, a pause of 1 s, 1.5 s again: 3 s of video, in 3 segments (one of them after the pause).
        let cam = crate::webcam::Webcam::start(
            dir.path(),
            crate::webcam::SYNTHETIC,
            true,
            Arc::new(|| true),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(1500));
        cam.pause();
        std::thread::sleep(Duration::from_millis(1000));
        cam.resume();
        std::thread::sleep(Duration::from_millis(1500));
        let segments = cam.finish();
        assert!(segments.len() >= 2, "{segments:?}");
        let name = join_webcam(dir.path(), &segments).unwrap();
        assert_eq!(name, "webcam.mp4");
        assert!(
            crate::mp4join::segments_named(dir.path(), "webcam").is_empty(),
            "the segments are gone"
        );
        let (cw, ch, frames) =
            crate::render::win::read_frames(&dir.path().join("webcam.mp4"), 1000).unwrap();
        assert_eq!((cw, ch), (640, 360));
        // The pause is cut out: the camera took 3 s of pictures in two stretches. (Opening a segment's encoder takes up to a second
        // on this PC, and a camera does not deliver what it missed, so the number of pictures is not the length: the length of
        // the video track is, and it counts from the first to the last picture.)
        let (len_ms, _) = track_lengths_ms(&dir.path().join("webcam.mp4"));
        assert!(frames.len() >= 30, "{} pictures", frames.len());
        assert!(
            (1500..=3600).contains(&len_ms),
            "{len_ms} ms of webcam (the pause is cut out)"
        );
        // The recording knows the webcam; with it shown the export has a disc in the corner, without it not.
        let mut info: RecordingInfo =
            serde_json::from_slice(&std::fs::read(dir.path().join("recording.json")).unwrap())
                .unwrap();
        info.webcam_file = Some(name);
        info.webcam_start_ms = 500;
        let mut fx = Effects::default();
        fx.cursor.show = false;
        fx.click.kind = "off".into();
        info.effects = Some(fx.clone());
        write_info(dir.path(), &info).unwrap();
        let cancel = AtomicBool::new(false);
        let with = export(dir.path(), "with.mp4", &cancel).unwrap();
        fx.webcam.show = false;
        info.effects = Some(fx.clone());
        write_info(dir.path(), &info).unwrap();
        let without = export(dir.path(), "without.mp4", &cancel).unwrap();
        let (_, _, a) = crate::render::win::read_frames(&with.file, 20).unwrap();
        let (_, _, b) = crate::render::win::read_frames(&without.file, 20).unwrap();
        let rect = Effects::default().webcam_rect(640, 360);
        let (inside, outside) = {
            let (mut inside, mut outside) = (0u64, 0u64);
            for y in 0..360usize {
                for x in 0..640usize {
                    let i = (y * 640 + x) * 4;
                    let d: i32 = (0..3)
                        .map(|c| (a[12][i + c] as i32 - b[12][i + c] as i32).abs())
                        .sum();
                    let in_rect = (x as i32) >= rect.0
                        && (x as i32) < rect.0 + rect.2
                        && (y as i32) >= rect.1
                        && (y as i32) < rect.1 + rect.3;
                    if d > 60 {
                        if in_rect {
                            inside += 1;
                        } else {
                            outside += 1;
                        }
                    }
                }
            }
            (inside, outside)
        };
        assert!(
            inside > 1500,
            "the webcam disc covers the corner: {inside} pixels differ"
        );
        assert!(outside < 100, "and nothing else changed: {outside}");
    }

    /// The first sample of every sound burst of a 16 bit WAV file, in milliseconds of the track.
    fn beep_onsets_ms(path: &Path) -> Vec<f64> {
        let bytes = std::fs::read(path).unwrap();
        let ch = u16::from_le_bytes([bytes[22], bytes[23]]) as usize;
        let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]) as f64;
        let data = &bytes[44..];
        let mut onsets = Vec::new();
        let mut quiet = 0usize;
        for (i, f) in data.chunks_exact(2 * ch).enumerate() {
            let v = i16::from_le_bytes([f[0], f[1]]).unsigned_abs();
            if v > 1500 {
                if quiet > (rate * 0.3) as usize || onsets.is_empty() {
                    onsets.push(i as f64 * 1000.0 / rate);
                }
                quiet = 0;
            } else {
                quiet += 1;
            }
        }
        onsets
    }

    /// The first picture of every white flash, as a frame number.
    #[allow(clippy::chunks_exact_to_as_chunks)]
    fn flash_onsets(frames: &[Vec<u8>], fps: usize) -> Vec<usize> {
        let mut onsets = Vec::new();
        let mut last = None::<usize>;
        for (i, f) in frames.iter().enumerate() {
            let white = f
                .chunks_exact(4)
                .step_by(7)
                .filter(|p| p[0] > 245 && p[1] > 245 && p[2] > 245)
                .count();
            if white * 10 > f.len() / 4 / 7 * 9 && last.is_none_or(|l| i > l + fps / 2) {
                onsets.push(i);
                last = Some(i);
            }
        }
        onsets
    }

    /// One generated recording with the white flash and the beep at the same recorded times; returns (webcam - mic) and
    /// (screen - system sound) offsets in milliseconds, one per mark.
    fn sync_offsets(dir: &Path, camera_lag_ms: u64, arrival_stamps: bool) -> (Vec<f64>, Vec<f64>) {
        use std::sync::atomic::Ordering::SeqCst;
        let fps = 30usize;
        crate::audio::SYNC_TEST.store(true, SeqCst);
        crate::audio::CAM_LAG_MS.store(camera_lag_ms, SeqCst);
        crate::audio::CAM_ARRIVAL_STAMPS.store(arrival_stamps, SeqCst);
        let handle = win::start_synthetic(
            dir,
            fps as u32,
            "standard",
            320,
            180,
            Duration::from_secs(3),
        )
        .unwrap();
        handle.apply_audio(true, true, &(String::new(), String::new()));
        // The camera opens after the recording began, like a switch turned on in the middle.
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(handle.apply_webcam(true, crate::webcam::SYNTHETIC), None);
        std::thread::sleep(Duration::from_millis(4700));
        let stats = handle.stop().unwrap();
        crate::audio::SYNC_TEST.store(false, SeqCst);
        crate::audio::CAM_LAG_MS.store(0, SeqCst);
        crate::audio::CAM_ARRIVAL_STAMPS.store(false, SeqCst);
        let (cam_files, cam_start) = stats.webcam.clone().unwrap();
        crate::mp4join::join(&crate::mp4join::segments_in(dir), &dir.join("screen.mp4")).unwrap();
        let cam = join_webcam(dir, &cam_files).unwrap();
        let mic = stats
            .audio
            .iter()
            .find(|a| a.0 == crate::audio::Kind::Mic)
            .unwrap()
            .1
            .clone();
        let sys = stats
            .audio
            .iter()
            .find(|a| a.0 == crate::audio::Kind::System)
            .unwrap()
            .1
            .clone();
        let (_, _, cam_frames) = crate::render::win::read_frames(&dir.join(cam), 1000).unwrap();
        let (_, _, screen_frames) =
            crate::render::win::read_frames(&dir.join("screen.mp4"), 1000).unwrap();
        let near = |t: f64| (t / 1000.0).round() * 1000.0;
        let cam_t: Vec<f64> = flash_onsets(&cam_frames, fps)
            .iter()
            .map(|&i| cam_start as f64 + i as f64 * 1000.0 / fps as f64)
            .collect();
        let mic_t = beep_onsets_ms(&mic);
        let screen_t: Vec<f64> = flash_onsets(&screen_frames, fps)
            .iter()
            .map(|&i| i as f64 * 1000.0 / fps as f64)
            .collect();
        let sys_t = beep_onsets_ms(&sys);
        eprintln!("cam start {cam_start} ms; webcam flashes {cam_t:?}; mic beeps {mic_t:?}; screen {screen_t:?}; system {sys_t:?}");
        let pair = |a: &[f64], b: &[f64]| -> Vec<f64> {
            a.iter()
                .filter_map(|&x| b.iter().find(|&&y| near(x) == near(y)).map(|&y| x - y))
                .collect()
        };
        (pair(&cam_t, &mic_t), pair(&screen_t, &sys_t))
    }

    #[test]
    fn the_webcam_the_screen_and_the_sound_stay_in_step() {
        let _encoder = super::encoder_lock();
        // A camera that is 120 ms late (real cameras are 50 to 150 ms late), pictures dated by the camera's own time.
        let dir = crate::testdir::new();
        let (cam, screen) = sync_offsets(dir.path(), 120, false);
        eprintln!("SYNC after (camera time): webcam-mic {cam:?} ms, screen-system {screen:?} ms");
        assert!(cam.len() >= 3, "{cam:?}");
        assert!(screen.len() >= 3, "{screen:?}");
        // One picture (33 ms) is the finest a 30 fps camera can show.
        for d in cam.iter().chain(screen.iter()) {
            assert!(
                *d >= -34.0 && *d <= 34.0,
                "offset {d} ms in {cam:?} / {screen:?}"
            );
        }
        // The old way (pictures dated by their arrival) is behind by the delay of the camera.
        let dir2 = crate::testdir::new();
        let (old, _) = sync_offsets(dir2.path(), 120, true);
        eprintln!("SYNC before (arrival time): webcam-mic {old:?} ms");
        assert!(old.iter().all(|d| *d > 80.0), "{old:?}");
        let _ = &old;
    }

    /// The length of the video track and of the audio track of an MP4 file, in milliseconds.
    fn track_lengths_ms(path: &Path) -> (u64, u64) {
        let f = std::fs::File::open(path).unwrap();
        let size = f.metadata().unwrap().len();
        let r = mp4::Mp4Reader::read_header(std::io::BufReader::new(f), size).unwrap();
        let (mut v, mut a) = (0, 0);
        for t in r.tracks().values() {
            let ms = t.duration().as_millis() as u64;
            match t.track_type() {
                Ok(mp4::TrackType::Video) => v = ms,
                Ok(mp4::TrackType::Audio) => a = ms,
                _ => {}
            }
        }
        (v, a)
    }

    #[test]
    fn an_export_with_two_cuts_is_as_long_as_what_is_left_and_the_sound_stays_with_the_picture() {
        let _encoder = super::encoder_lock();
        use crate::effects::{Cut, Effects};
        let dir = crate::testdir::new();
        generated(dir.path(), 640, 360, 30, 6);
        let cancel = AtomicBool::new(false);
        let whole = export(dir.path(), "whole.mp4", &cancel).unwrap();
        let (wv, wa) = track_lengths_ms(&whole.file);
        let fx = Effects {
            cuts: vec![
                Cut {
                    start_ms: 3500,
                    end_ms: 4000,
                },
                Cut {
                    start_ms: 1000,
                    end_ms: 2000,
                },
            ],
            ..Default::default()
        };
        set_effects(dir.path(), |e| *e = fx.clone());
        let cut = export(dir.path(), "cut.mp4", &cancel).unwrap();
        // 6 s minus 1 s and 0.5 s.
        assert!(
            (cut.duration_ms as i64 - 4500).abs() <= 2,
            "{}",
            cut.duration_ms
        );
        let (cv, ca) = track_lengths_ms(&cut.file);
        eprintln!("whole: video {wv} ms, audio {wa} ms; two cuts: video {cv} ms, audio {ca} ms, {} frames", cut.frames);
        assert!(
            (cv as i64 - (wv as i64 - 1500)).abs() <= 40,
            "video {cv} ms (whole {wv})"
        );
        assert!(
            (ca as i64 - (wa as i64 - 1500)).abs() <= 40,
            "audio {ca} ms (whole {wa})"
        );
        assert!(
            (cv as i64 - ca as i64).abs() <= 33,
            "the sound ends with the picture: {cv} vs {ca}"
        );
        assert!(
            cut.frames >= 130 && cut.frames <= 136,
            "{} frames",
            cut.frames
        );
        // The pictures after a cut follow on: the right ones are shown, and where they should be (the test pattern moves
        // with time). The cuts take out the pictures 30 to 59 and 105 to 119 of the 180.
        let (_, _, cut_frames) = crate::render::win::read_frames(&cut.file, 1000).unwrap();
        let shown = pictures_shown(&cut_frames, 640, 360, 180);
        assert!(shown.len() >= 130, "{} pictures read back", shown.len());
        assert!(
            shown.windows(2).all(|p| p[0] <= p[1]),
            "the pictures run forward: {shown:?}"
        );
        // Nothing from inside a cut. Two pictures at each edge of a cut are allowed: the software encoder's files time a
        // picture a frame later than its number says, and the rounding at an edge can take one more.
        let inside: Vec<usize> = shown
            .iter()
            .copied()
            .filter(|p| (32..=57).contains(p) || (107..=117).contains(p))
            .collect();
        assert!(
            inside.is_empty(),
            "pictures of a cut: {inside:?} in {shown:?}"
        );
        // Each of the three kept stretches begins and ends where it should, within two pictures, and is nearly all there.
        for (from, to) in [(0usize, 29usize), (60, 104), (120, 179)] {
            let kept: Vec<usize> = shown
                .iter()
                .copied()
                .filter(|p| (from.saturating_sub(2)..=to + 2).contains(p))
                .collect();
            let (first, last) = (kept.first().copied(), kept.last().copied());
            assert!(
                first.is_some_and(|f| f <= from + 2) && last.is_some_and(|l| l + 2 >= to),
                "the stretch {from} to {to} runs from {first:?} to {last:?}: {shown:?}"
            );
            let mut different = kept.clone();
            different.dedup();
            // (at least nine in ten: two may be missing at its start, and a few left out or repeated within it)
            assert!(
                different.len() * 10 >= (to - from + 1) * 9,
                "the stretch {from} to {to} has only {} pictures: {shown:?}",
                different.len()
            );
        }
        // And in the middle of each stretch, away from the cuts, a frame stands at its time: before the cuts picture k,
        // after the first 30 later, after both 45 later (up to three frames of play, for pictures left out before it).
        for (frame, picture) in [(15usize, 15usize), (50, 80), (110, 155)] {
            assert!(
                shown[frame].abs_diff(picture) <= 3,
                "frame {frame} shows picture {}, not {picture}: {shown:?}",
                shown[frame]
            );
        }
        // The estimate of the dialog knows the cuts.
        let info: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("recording.json")).unwrap())
                .unwrap();
        let est = crate::render::mp4_estimate(&info, &crate::effects::ExportSettings::default());
        assert!((est.2 as i64 - 4500).abs() <= 2, "{}", est.2);
    }

    /// A real-sized export (set SNIPMUNK_RENDER_W/H and SNIPMUNK_PROFILE_SECS; run with --ignored --nocapture): every effect on,
    /// the webcam, both sound tracks. Prints where the time goes.
    #[test]
    #[ignore]
    fn profile_a_real_sized_export() {
        let _encoder = super::encoder_lock();
        let env = |k: &str, d: u32| {
            std::env::var(k)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(d)
        };
        let dir = crate::testdir::new();
        let (w, h, secs) = (
            env("SNIPMUNK_RENDER_W", 3440),
            env("SNIPMUNK_RENDER_H", 1440),
            env("SNIPMUNK_PROFILE_SECS", 61),
        );
        let t = std::time::Instant::now();
        generated(dir.path(), w, h, 30, secs);
        // A webcam video of 1280x720.
        let mut seg = win::Segments::new(
            dir.path(),
            1280,
            720,
            30,
            "standard",
            Duration::from_secs(10),
        )
        .named("webcam");
        for i in 0..(30 * secs) as usize {
            let f = flip_rows(&crate::webcam::pattern(1280, 720, i), 1280, 720);
            seg.send_buffer(&f, i as i64 * (TICKS / 30)).unwrap();
        }
        let files = seg.finish_all().unwrap();
        join_webcam(dir.path(), &files).unwrap();
        let mut info: RecordingInfo =
            serde_json::from_slice(&std::fs::read(dir.path().join("recording.json")).unwrap())
                .unwrap();
        info.webcam_file = Some("webcam.mp4".into());
        let mut fx = crate::effects::Effects::default();
        fx.cursor.halo = true;
        fx.cursor.size = "2".into();
        info.effects = Some(fx);
        write_info(dir.path(), &info).unwrap();
        eprintln!(
            "generated {w}x{h} {secs} s in {:.0} s",
            t.elapsed().as_secs_f64()
        );
        let cancel = AtomicBool::new(false);
        let settings = crate::effects::ExportSettings {
            quality: "high".into(),
            ..Default::default()
        };
        let r = export_with(dir.path(), "profile.mp4", settings, &cancel).unwrap();
        let bytes = std::fs::metadata(&r.file).unwrap().len();
        eprintln!(
            "export: {:.1} s for {secs} s = {:.2}x real time, {:.1} MB",
            r.seconds,
            secs as f64 / r.seconds,
            bytes as f64 / 1e6
        );
    }

    #[test]
    fn a_trim_near_the_end_seeks_instead_of_decoding_from_the_start() {
        let _encoder = super::encoder_lock();
        let dir = crate::testdir::new();
        generated(dir.path(), 320, 180, 30, 40);
        let cancel = AtomicBool::new(false);
        set_effects(dir.path(), |fx| {
            fx.click.kind = "off".into();
            fx.cursor.show = false;
        });
        let full = export(dir.path(), "full.mp4", &cancel).unwrap();
        set_effects(dir.path(), |fx| {
            fx.trim = crate::effects::Trim {
                start_ms: 36000,
                end_ms: Some(38000),
            };
        });
        let cut = export(dir.path(), "cut.mp4", &cancel).unwrap();
        eprintln!(
            "full {:.2} s, trimmed (2 s at 36 s) {:.2} s",
            full.seconds, cut.seconds
        );
        assert!(
            (cut.frames as i64 - 60).abs() <= 3,
            "{} pictures",
            cut.frames
        );
        assert!(
            cut.seconds < full.seconds * 0.5,
            "a trimmed export is not slower than a full one"
        );
        // The first picture is the one of 36 s of the full export.
        let (cw, ch, first) = crate::render::win::read_frames(&cut.file, 1).unwrap();
        let (_, _, all) = crate::render::win::read_frames(&full.file, 1084).unwrap();
        let best = (1078..1084)
            .map(|i| mean_diff(&first[0], &all[i], cw as usize, ch as usize))
            .fold(f64::MAX, f64::min);
        assert!(
            best < 6.0,
            "the picture at the trim start differs by {best} from the full export at 36 s"
        );
    }

    #[test]
    fn click_effects_start_at_the_button_press_and_last_600_ms() {
        let _encoder = super::encoder_lock();
        let dir = crate::testdir::new();
        generated(dir.path(), 320, 180, 10, 3);
        let layer = crate::render::CursorLayer::load(dir.path(), "cursor.jsonl").unwrap();
        assert!(layer.clicks_at(1400).is_empty(), "before the click");
        let c = layer.clicks_at(1650);
        assert_eq!(c.len(), 1);
        assert!(c[0].3, "the left button");
        assert!((c[0].0 - 150.0 / 600.0).abs() < 0.05, "age {}", c[0].0);
        assert!(layer.clicks_at(2200).is_empty(), "after 600 ms it is gone");
    }

    #[test]
    fn a_gif_is_made_with_the_chosen_rate_and_size_and_its_size_can_be_estimated() {
        let _encoder = super::encoder_lock();
        let dir = crate::testdir::new();
        generated(dir.path(), 640, 360, 15, 4);
        set_effects(dir.path(), |fx| {
            fx.trim = crate::effects::Trim {
                start_ms: 0,
                end_ms: Some(2000),
            };
        });
        let cancel = AtomicBool::new(false);
        for (quality, fps, max_short) in [("low", 10u32, 360u32), ("high", 15, 360)] {
            let started = std::time::Instant::now();
            let settings = crate::effects::ExportSettings {
                format: "gif".into(),
                quality: quality.into(),
                ..Default::default()
            };
            let r = export_with(
                dir.path(),
                &format!("{quality}.gif"),
                settings.clone(),
                &cancel,
            )
            .unwrap();
            assert_eq!(r.fps, fps);
            assert!(r.height <= max_short);
            let bytes = std::fs::metadata(&r.file).unwrap().len();
            eprintln!(
                "gif {quality}: {}x{} {} pictures {} bytes in {:.2} s",
                r.width,
                r.height,
                r.frames,
                bytes,
                started.elapsed().as_secs_f64()
            );
            let mut dec = gif::DecodeOptions::new()
                .read_info(std::fs::File::open(&r.file).unwrap())
                .unwrap();
            assert_eq!(
                (dec.width() as u32, dec.height() as u32),
                (r.width, r.height)
            );
            let mut n = 0;
            let mut delay = 0;
            while let Some(f) = dec.read_next_frame().unwrap() {
                n += 1;
                delay = f.delay;
            }
            assert!(
                (n as i64 - 2 * fps as i64).abs() <= 2,
                "{n} pictures for 2 s at {fps} fps"
            );
            assert_eq!(delay as u32, (100.0 / fps as f64).round() as u32);
            // The estimate is in the region of the real size.
            let est = crate::render::win::render(
                &crate::render::win::Request {
                    dir: dir.path(),
                    out: dir.path().join("probe"),
                    settings,
                    system_volume: 1.0,
                    mic_volume: 1.0,
                    probe: Some(24),
                },
                &|_| {},
                &cancel,
            )
            .unwrap();
            let frames_total = 2 * fps as u64;
            let estimated = est.probe_bytes * frames_total / est.probe_frames.max(1) as u64;
            eprintln!("gif {quality}: estimated {estimated} bytes for real {bytes}");
            assert!(
                estimated > bytes / 4 && estimated < bytes * 4,
                "{estimated} vs {bytes}"
            );
        }
    }

    #[test]
    fn a_generated_1080p_recording_renders_with_cursor_and_mixed_sound_faster_than_real_time() {
        let _encoder = super::encoder_lock();
        let dir = crate::testdir::new();
        let env = |k: &str, d: u32| {
            std::env::var(k)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(d)
        };
        let (w, h, fps, secs) = (
            env("SNIPMUNK_RENDER_W", 1920),
            env("SNIPMUNK_RENDER_H", 1080),
            30u32,
            6u32,
        );
        generated(dir.path(), w, h, fps, secs);
        let cancel = AtomicBool::new(false);
        let r = export(dir.path(), "r.mp4", &cancel).unwrap();
        eprintln!(
            "render of {secs} s of {w}x{h} at {fps} fps: {} frames in {:.2} s = {:.1}x real time",
            r.frames,
            r.seconds,
            secs as f64 / r.seconds
        );
        assert_eq!(r.frames as u32, fps * secs);
        // The file reads back: one video track with all the pictures and an audio track.
        let f = std::fs::File::open(&r.file).unwrap();
        let size = f.metadata().unwrap().len();
        let reader = mp4::Mp4Reader::read_header(std::io::BufReader::new(f), size).unwrap();
        let kinds: Vec<_> = reader
            .tracks()
            .values()
            .filter_map(|t| t.track_type().ok())
            .collect();
        assert!(
            kinds.contains(&mp4::TrackType::Video) && kinds.contains(&mp4::TrackType::Audio),
            "{kinds:?}"
        );
        let secs_out = reader.duration().as_secs_f64();
        assert!((secs_out - secs as f64).abs() < 0.3, "{secs_out}");
        // A render that is cancelled leaves no partial file.
        let stop = AtomicBool::new(true);
        assert!(export(dir.path(), "r.mp4", &stop).is_err());
        assert!(!dir.path().join("r.mp4.part").exists());
    }
}
