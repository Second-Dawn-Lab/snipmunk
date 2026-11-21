//! The live webcam bubble: while a recording is counted down or running with the webcam on, a small window shows the camera so the
//! person can see themselves and place the bubble. It is its own window, always on top, not in the taskbar or Alt+Tab, never takes
//! the focus, and is EXCLUDED from the capture (the webcam is a track of its own). Where it is when the recording stops becomes the
//! webcam overlay of the recording.
//!
//! The camera thread keeps the newest picture, shrunk to 320 pixels wide, in `webcam::PREVIEW`; the window's page asks the
//! `snipmunk-cam` address for it about 15 times a second and gets a JPEG (encoded only when asked). No picture goes through a command
//! or an event, and nothing here runs on the camera thread except the cheap shrink.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::geometry::Rect;

static AREA: Mutex<Option<Rect>> = Mutex::new(None);
/// The bubble's outer rectangle in screen pixels (x, y, width, height), kept by the window events.
static RECT: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);
static ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static CAMERA: Mutex<Option<crate::webcam::PreviewCamera>> = Mutex::new(None);

/// The webcam effects as the bubble's place says (see `placement`).
#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    /// "free" (the centre is inside the recorded area) or the nearest corner.
    pub position: String,
    pub x: f32,
    pub y: f32,
    /// "s" | "m" | "l": the nearest to the bubble's width.
    pub size: String,
}

/// Where the bubble lies relative to the recorded `area`: the centre as fractions of the area when it is inside; else the corner
/// of the area that is nearest. The size is the nearest of S, M, L by the bubble's width compared with the area's.
pub fn place(bubble: (i32, i32, u32, u32), area: Rect) -> Place {
    let cx = bubble.0 as f32 + bubble.2 as f32 / 2.0;
    let cy = bubble.1 as f32 + bubble.3 as f32 / 2.0;
    let fx = (cx - area.x as f32) / area.w.max(1) as f32;
    let fy = (cy - area.y as f32) / area.h.max(1) as f32;
    let frac = bubble.2 as f32 / area.w.max(1) as f32;
    let size = [("s", 0.14f32), ("m", 0.20), ("l", 0.28)]
        .iter()
        .min_by(|a, b| (a.1 - frac).abs().total_cmp(&(b.1 - frac).abs()))
        .map_or("m", |s| s.0)
        .to_string();
    if (0.0..=1.0).contains(&fx) && (0.0..=1.0).contains(&fy) {
        Place {
            position: "free".into(),
            x: fx,
            y: fy,
            size,
        }
    } else {
        let left = fx < 0.5;
        let top = fy < 0.5;
        let position = format!(
            "{}-{}",
            if top { "top" } else { "bottom" },
            if left { "left" } else { "right" }
        );
        Place {
            position,
            x: fx.clamp(0.0, 1.0),
            y: fy.clamp(0.0, 1.0),
            size,
        }
    }
}

/// The place of the bubble now, for the recorded area it was shown over.
pub fn placement() -> Option<Place> {
    let area = (*AREA.lock().unwrap_or_else(|e| e.into_inner()))?;
    let rect = (*RECT.lock().unwrap_or_else(|e| e.into_inner()))?;
    Some(place(rect, area))
}

/// Is the bubble there (for a recording that has a webcam)?
pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

/// Show the bubble over `area` (the recorded area), unless the webcam is off. Runs on a thread of its own (windows are made there).
pub fn open(app: &AppHandle, area: Rect) {
    *AREA.lock().unwrap_or_else(|e| e.into_inner()) = Some(area);
    ACTIVE.store(true, Ordering::SeqCst);
    let on = app
        .state::<crate::commands::AppState>()
        .settings
        .lock()
        .unwrap()
        .webcam_on;
    if on {
        set_visible(app, true);
    }
}

/// The webcam switch changed (the floating bar, the quick menu, the settings): show or hide the bubble.
pub fn set_visible(app: &AppHandle, on: bool) {
    if !is_active() {
        return;
    }
    if on {
        ensure_window(app);
        #[cfg(windows)]
        start_camera(app);
    } else {
        if let Some(w) = app.get_webview_window("webcambubble") {
            let _ = w.hide();
        }
        #[cfg(windows)]
        stop_preview_camera();
    }
}

#[cfg(windows)]
fn start_camera(app: &AppHandle) {
    // While a recording has the camera, the recording's thread publishes the pictures: no second open.
    if crate::webcam::recording_running() {
        return;
    }
    let mut cam = CAMERA.lock().unwrap_or_else(|e| e.into_inner());
    if cam.is_some() {
        return;
    }
    let (device, synthetic) = {
        let s = app
            .state::<crate::commands::AppState>()
            .settings
            .lock()
            .unwrap()
            .webcam_device
            .clone();
        (s, false)
    };
    match crate::webcam::start_preview(&device, synthetic) {
        Ok(p) => *cam = Some(p),
        Err(notice) => {
            drop(cam);
            use tauri::Emitter;
            let _ = app.emit("recording-notice", notice);
        }
    }
}

/// The recording takes over the camera: the camera that only showed the bubble is let go (the recording opens it again).
#[cfg(windows)]
pub fn stop_preview_camera() {
    let cam = CAMERA.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(c) = cam {
        c.stop();
    }
}

#[cfg(not(windows))]
pub fn stop_preview_camera() {}

/// Close the bubble and the camera that showed it (the recording ended or the countdown was cancelled).
pub fn close(app: &AppHandle) {
    ACTIVE.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    stop_preview_camera();
    if let Some(w) = app.get_webview_window("webcambubble") {
        let _ = w.close();
    }
    *RECT.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn ensure_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("webcambubble") {
        show_without_focus(&w);
        return;
    }
    let Some(area) = *AREA.lock().unwrap_or_else(|e| e.into_inner()) else {
        return;
    };
    let fx = {
        let s = app
            .state::<crate::commands::AppState>()
            .settings
            .lock()
            .unwrap()
            .clone();
        crate::effects::Effects::from_settings(&s)
    };
    // The bubble starts where the settings say (a corner of the recorded area) and as big as the overlay will be.
    let (x, y, w, h) = fx.webcam_rect(area.w, area.h);
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "webcambubble",
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
    let Ok(win) = built else { return };
    let _ = win.set_size(tauri::PhysicalSize::new(w.max(60) as u32, h.max(60) as u32));
    let _ = win.set_position(tauri::PhysicalPosition::new(area.x + x, area.y + y));
    *RECT.lock().unwrap_or_else(|e| e.into_inner()) =
        Some((area.x + x, area.y + y, w.max(60) as u32, h.max(60) as u32));
    // The window events only store the new place.
    win.on_window_event(|event| match event {
        tauri::WindowEvent::Moved(p) => {
            if let Some(r) = RECT.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                r.0 = p.x;
                r.1 = p.y;
            }
        }
        tauri::WindowEvent::Resized(s) => {
            if let Some(r) = RECT.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                r.2 = s.width;
                r.3 = s.height;
            }
        }
        _ => {}
    });
    crate::webview::exclude_from_capture(&win);
    style_window(&win);
    show_without_focus(&win);
}

/// Not in Alt+Tab (a tool window) and never activated by a click.
#[cfg(windows)]
fn style_window(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    if let Ok(hwnd) = win.hwnd() {
        let hwnd = HWND(hwnd.0);
        // SAFETY: a valid window handle of this process; only the extended style bits are changed.
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

#[cfg(not(windows))]
fn style_window(_: &tauri::WebviewWindow) {}

#[cfg(windows)]
fn show_without_focus(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    if let Ok(hwnd) = win.hwnd() {
        // SAFETY: a valid window handle of this process.
        unsafe {
            let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNOACTIVATE);
        }
    }
}

#[cfg(not(windows))]
fn show_without_focus(win: &tauri::WebviewWindow) {
    let _ = win.show();
}

/// The page of the bubble asks for a new width (CSS pixels) while its corner is dragged: the window follows around its centre.
#[tauri::command]
pub async fn bubble_resize(app: AppHandle, width: f64) -> crate::error::CmdResult<()> {
    let Some(w) = app.get_webview_window("webcambubble") else {
        return Ok(());
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let shape_rect = app
        .state::<crate::commands::AppState>()
        .settings
        .lock()
        .unwrap()
        .webcam_shape
        == "rect";
    let nw = (width.clamp(80.0, 640.0) * scale).round() as u32;
    let nh = if shape_rect {
        (nw as f64 * 9.0 / 16.0).round() as u32
    } else {
        nw
    };
    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
        let (cx, cy) = (
            pos.x + size.width as i32 / 2,
            pos.y + size.height as i32 / 2,
        );
        let _ = w.set_size(tauri::PhysicalSize::new(nw, nh));
        let _ = w.set_position(tauri::PhysicalPosition::new(
            cx - nw as i32 / 2,
            cy - nh as i32 / 2,
        ));
    }
    Ok(())
}

/// The newest camera picture as a JPEG for the `snipmunk-cam` address.
pub fn serve_cam<R: tauri::Runtime>(
    _ctx: tauri::UriSchemeContext<'_, R>,
    _request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    match crate::webcam::preview_jpeg() {
        Some(bytes) => tauri::http::Response::builder()
            .header("Content-Type", "image/jpeg")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bubble_inside_the_area_is_placed_freely_and_outside_it_goes_to_the_nearest_corner() {
        let area = Rect::new(100, 100, 1000, 500);
        // The centre at (850, 450): 75% across, 70% down; 200 wide = 20% of the area: size M.
        let p = place((750, 350, 200, 200), area);
        assert_eq!(p.position, "free");
        assert!(
            (p.x - 0.75).abs() < 0.01 && (p.y - 0.70).abs() < 0.01,
            "{p:?}"
        );
        assert_eq!(p.size, "m");
        // Left of the area (outside), a bit lower than the middle: the bottom left corner. 280 wide: L.
        let q = place((-300, 400, 280, 280), area);
        assert_eq!(q.position, "bottom-left");
        assert_eq!(q.size, "l");
        // Above the area on the right: top right. 140 wide: S.
        let r = place((1000, -200, 140, 140), area);
        assert_eq!(r.position, "top-right");
        assert_eq!(r.size, "s");
    }
}
