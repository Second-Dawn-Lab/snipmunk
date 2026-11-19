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
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::AppState;
use crate::error::{CmdError, CmdResult};
use crate::sessions::Session;

/// The areas a recording can have (there is no freeform recording).
pub const MODES: [&str; 3] = ["rectangle", "window", "fullscreen"];

/// The bitrate for a size, frame rate and quality: bits per pixel and frame, at least 2 and at most 80 Mbit/s.
pub fn bitrate_for(width: u32, height: u32, fps: u32, quality: &str) -> u32 {
    let bits_per_pixel = if quality == "high" { 0.16 } else { 0.08 };
    let bits = width as f64 * height as f64 * fps as f64 * bits_per_pixel;
    bits.clamp(2_000_000.0, 80_000_000.0) as u32
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

/// What the page is told about the state of the recorder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingState {
    pub recording: bool,
    /// Unix time (ms) when it started.
    pub started_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The running recording (one at a time).
pub struct Recorder {
    active: Mutex<Option<Active>>,
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
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

fn announce(app: &AppHandle, recording: bool, started_at: u64) {
    let _ = app.emit(
        "recording-state",
        RecordingState {
            recording,
            started_at,
        },
    );
}

/// Start a recording of an area ("rectangle" | "window" | "fullscreen"). In a development build `window` names one of Snipmunk's
/// own windows to record instead (for tests: nothing else on the desktop is recorded).
#[tauri::command]
pub fn start_recording(
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
    let mut guard = recorder.active.lock().unwrap();
    if guard.is_some() {
        return Err(CmdError::new("busy", "a recording is already running"));
    }
    let (fps, quality) = {
        let s = state.settings.lock().unwrap();
        (s.rec_fps, s.rec_quality.clone())
    };
    let (session_dir, session_id) = {
        let store = state.sessions.lock().unwrap();
        (store.session_dir(), store.session().id.clone())
    };
    let id = format!("r{:x}", now_ms());
    let rel_dir = format!("recordings/{id}");
    let dir = session_dir.join(&rel_dir);
    std::fs::create_dir_all(&dir)?;
    let _ = session_id;
    start_platform(&app, &mut guard, dir, rel_dir, fps, &quality, window)
}

#[cfg(not(windows))]
fn start_platform(
    _app: &AppHandle,
    _guard: &mut Option<Active>,
    _dir: PathBuf,
    _rel_dir: String,
    _fps: u32,
    _quality: &str,
    _window: Option<String>,
) -> CmdResult<()> {
    Err(CmdError::new(
        "unsupported",
        "Screen recording needs Windows in this version.",
    ))
}

#[cfg(windows)]
fn start_platform(
    app: &AppHandle,
    guard: &mut Option<Active>,
    dir: PathBuf,
    rel_dir: String,
    fps: u32,
    quality: &str,
    window: Option<String>,
) -> CmdResult<()> {
    let target = match window.filter(|_| cfg!(debug_assertions)) {
        Some(label) => {
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
        None => win::Target::MonitorUnderPointer,
    };
    let handle = win::start(&dir, fps, quality, target).map_err(|e| CmdError::new("capture", e))?;
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
    announce(app, true, info.started_at);
    *guard = Some(Active {
        handle,
        dir,
        rel_dir,
        info,
        started: std::time::Instant::now(),
    });
    Ok(())
}

/// Stop the recording: the file is finished, the capture card is made in the active group. Returns the new session.
#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    recorder: State<'_, Recorder>,
    state: State<'_, AppState>,
) -> CmdResult<Session> {
    let active = recorder
        .active
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| CmdError::new("not_running", "no recording is running"))?;
    announce(&app, false, 0);
    finish(&app, &state, active)
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
    let stats = handle.stop().map_err(|e| CmdError::new("capture", e))?;
    info.frames = stats.frames;
    info.duration_ms = if stats.last_ms > 0 {
        stats.last_ms
    } else {
        started.elapsed().as_millis() as u64
    };
    write_info(&dir, &info)?;
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
        let group = store
            .session()
            .groups
            .iter()
            .find(|g| Some(&g.id) == wanted.as_ref())
            .or_else(|| store.session().groups.first())
            .map(|g| g.id.clone())
            .ok_or_else(|| CmdError::new("not_found", "the session has no group"))?;
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
        let _ = &rel_dir;
        (capture, group, store.session().clone())
    };
    let _ = app.emit("session-changed", &session);
    let _ = app.emit(
        "capture-added",
        serde_json::json!({ "captureId": capture.id, "groupId": group_id }),
    );
    Ok(session)
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

/// Is a recording running? (The page asks when it starts.)
#[tauri::command]
pub fn recording_state(recorder: State<'_, Recorder>) -> RecordingState {
    let g = recorder.active.lock().unwrap();
    RecordingState {
        recording: g.is_some(),
        started_at: g.as_ref().map(|a| a.info.started_at).unwrap_or(0),
    }
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

    pub enum Target {
        MonitorUnderPointer,
        Window {
            hwnd: usize,
            width: u32,
            height: u32,
        },
    }

    /// What the capture thread and the stop command share.
    struct Shared {
        encoder: Mutex<Option<VideoEncoder>>,
        first_png: std::path::PathBuf,
        first_done: AtomicBool,
        t0: AtomicI64,
        last_ms: AtomicU64,
        frames: AtomicU64,
    }

    pub struct Stats {
        pub frames: u64,
        pub last_ms: u64,
    }

    pub struct Handle {
        control: Option<CaptureControl<Handler, Error>>,
        shared: Arc<Shared>,
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
            let encoder = self.shared.encoder.lock().unwrap().take();
            if let Some(e) = encoder {
                e.finish().map_err(|e| e.to_string())?;
            }
            Ok(Stats {
                frames: self.shared.frames.load(Ordering::Relaxed),
                last_ms: self.shared.last_ms.load(Ordering::Relaxed),
            })
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
            if !s.first_done.swap(true, Ordering::Relaxed) {
                // The first picture is the card's picture.
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
            if let Some(enc) = s.encoder.lock().unwrap().as_mut() {
                enc.send_frame(frame)?;
            }
            s.frames.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    pub fn start(dir: &Path, fps: u32, quality: &str, target: Target) -> Result<Handle, String> {
        let (width, height, source) = match &target {
            Target::MonitorUnderPointer => {
                let mut p = POINT::default();
                unsafe { GetCursorPos(&mut p).map_err(|e| e.to_string())? };
                let hmon = unsafe { MonitorFromPoint(p, MONITOR_DEFAULTTOPRIMARY) };
                let m = Monitor::from_raw_hmonitor(hmon.0);
                (
                    m.width().map_err(|e| e.to_string())?,
                    m.height().map_err(|e| e.to_string())?,
                    "monitor",
                )
            }
            Target::Window { width, height, .. } => (*width, *height, "window"),
        };
        let (w, h) = (super::even(width), super::even(height));
        let shared = Arc::new(Shared {
            encoder: Mutex::new(None),
            first_png: dir.join("first.png"),
            first_done: AtomicBool::new(false),
            t0: AtomicI64::new(i64::MIN),
            last_ms: AtomicU64::new(0),
            frames: AtomicU64::new(0),
        });
        let encoder = VideoEncoder::new(
            VideoSettingsBuilder::new(w, h)
                .sub_type(VideoSettingsSubType::H264)
                .frame_rate(fps)
                .bitrate(super::bitrate_for(w, h, fps, quality)),
            AudioSettingsBuilder::default().disabled(true),
            ContainerSettingsBuilder::default(),
            dir.join("screen.mp4"),
        )
        .map_err(|e| e.to_string())?;
        *shared.encoder.lock().unwrap() = Some(encoder);

        macro_rules! settings {
            ($item:expr) => {
                Settings::new(
                    $item,
                    // The cursor is not recorded in the picture: it has its own track and is drawn when playing and rendering.
                    CursorCaptureSettings::WithoutCursor,
                    DrawBorderSettings::WithoutBorder,
                    SecondaryWindowSettings::Default,
                    MinimumUpdateIntervalSettings::Default,
                    DirtyRegionSettings::Default,
                    ColorFormat::Bgra8,
                    shared.clone(),
                )
            };
        }
        let control = match target {
            Target::MonitorUnderPointer => {
                let mut p = POINT::default();
                unsafe { GetCursorPos(&mut p).map_err(|e| e.to_string())? };
                let hmon = unsafe { MonitorFromPoint(p, MONITOR_DEFAULTTOPRIMARY) };
                Handler::start_free_threaded(settings!(Monitor::from_raw_hmonitor(hmon.0)))
            }
            Target::Window { hwnd, .. } => {
                Handler::start_free_threaded(settings!(Window::from_raw_hwnd(hwnd as *mut _)))
            }
        }
        .map_err(|e| e.to_string())?;
        Ok(Handle {
            control: Some(control),
            shared,
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
        assert!(high > std && std > 2_000_000);
        assert!(bitrate_for(1920, 1080, 60, "standard") > std);
        assert_eq!(bitrate_for(100, 100, 30, "standard"), 2_000_000);
        assert_eq!(bitrate_for(7680, 4320, 60, "high"), 80_000_000);
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
