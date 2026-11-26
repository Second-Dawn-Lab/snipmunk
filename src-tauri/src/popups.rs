//! The two small windows of a capture: the countdown badge near the pointer (the delay) and the toast in the corner
//! (after a capture, when Snipmunk stays in the background). Each is made when it is needed and taken away after use,
//! never takes the keyboard focus, and is left out of every screenshot. Its page asks what to show when it has loaded
//! (the event that was sent before is gone by then) and listens for what changes.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
};

use crate::geometry::{self, Rect};

pub const BADGE: &str = "countdown";
pub const TOAST: &str = "toast";

/// Logical size of the badge and of the toast.
const BADGE_SIZE: f64 = 88.0;
const TOAST_SIZE: (f64, f64) = (340.0, 92.0);
/// How long the toast stays.
const TOAST_SECONDS: u64 = 4;

static TOAST_GENERATION: AtomicU64 = AtomicU64::new(0);
/// The number the countdown badge shows now.
static COUNT: AtomicU32 = AtomicU32::new(0);
/// What the toast shows while there is one.
static TOAST_SHOWN: Mutex<Option<ToastInfo>> = Mutex::new(None);

fn ensure(app: &AppHandle, label: &str, size: (f64, f64)) -> tauri::Result<WebviewWindow> {
    if let Some(w) = crate::webview::existing(app, label) {
        return Ok(w);
    }
    let window = crate::webview::window(app, label, WebviewUrl::default())
        .title(match label {
            "toast" => "Snipmunk – Notice",
            "countdown" => "Snipmunk – Countdown",
            _ => "Snipmunk – Popup",
        })
        .inner_size(size.0, size.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()?;
    crate::webview::exclude_from_capture(&window);
    crate::webview::disable_browser_accelerators(&window);
    Ok(window)
}

/// The countdown page asks for the number to show.
#[tauri::command]
pub fn countdown_value() -> Option<u32> {
    Some(COUNT.load(Ordering::SeqCst)).filter(|n| *n > 0)
}

/// The toast page asks what to show.
#[tauri::command]
pub fn toast_info() -> Option<ToastInfo> {
    TOAST_SHOWN
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn monitor_rects(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            Rect::new(
                m.position().x,
                m.position().y,
                m.size().width,
                m.size().height,
            )
        })
        .collect()
}

/// Count down `seconds` with a badge near the pointer. Returns false when the user pressed Esc.
pub fn countdown(app: &AppHandle, seconds: u32) -> bool {
    COUNT.store(seconds, Ordering::SeqCst);
    let Ok(window) = ensure(app, BADGE, (BADGE_SIZE, BADGE_SIZE)) else {
        // Without a badge the delay is still honored, just not shown.
        for _ in 0..seconds {
            for _ in 0..40 {
                if crate::webview::escape_down() {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
        return true;
    };
    let rects = monitor_rects(app);
    let cursor = dawn_hotkeys::cursor_position().unwrap_or((0, 0));
    let scale = geometry::monitor_at(&rects, cursor)
        .and_then(|i| {
            app.available_monitors()
                .ok()
                .and_then(|m| m.get(i).map(|m| m.scale_factor()))
        })
        .unwrap_or(1.0);
    let size = (BADGE_SIZE * scale).round() as u32;
    let (x, y) = geometry::badge_position(cursor, size, &rects, (20.0 * scale) as i32);
    // Move first, so the window is on the pointer's monitor (and its DPI) when it is resized.
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(size, size));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.emit("countdown-tick", seconds);
    crate::webview::exclude_from_capture(&window); // see capture::begin
    let _ = window.show();

    let mut cancelled = false;
    'outer: for n in (1..=seconds).rev() {
        COUNT.store(n, Ordering::SeqCst);
        let _ = window.emit("countdown-tick", n);
        for _ in 0..40 {
            if crate::webview::escape_down() {
                cancelled = true;
                break 'outer;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
    COUNT.store(0, Ordering::SeqCst);
    let _ = window.hide();
    crate::webview::destroy(&window);
    if !cancelled {
        // Let the window disappear before the screen is grabbed.
        std::thread::sleep(Duration::from_millis(60));
    }
    !cancelled
}

/// What the toast shows. The page builds the picture's address from the session and file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastInfo {
    pub session_id: String,
    pub file: String,
    pub group_name: String,
    pub copied: bool,
    pub width: u32,
    pub height: u32,
}

/// Show the toast bottom-right for a few seconds, without taking the focus.
pub fn show_toast(app: &AppHandle, info: ToastInfo) {
    // (an earlier toast's timer no longer counts: it must not take this one's window away)
    TOAST_GENERATION.fetch_add(1, Ordering::SeqCst);
    *TOAST_SHOWN.lock().unwrap_or_else(|e| e.into_inner()) = Some(info.clone());
    let Ok(window) = ensure(app, TOAST, TOAST_SIZE) else {
        return;
    };
    let primary = app.primary_monitor().ok().flatten();
    let (work, scale) = match &primary {
        Some(m) => {
            let w = m.work_area();
            (
                Rect::new(w.position.x, w.position.y, w.size.width, w.size.height),
                m.scale_factor(),
            )
        }
        None => (Rect::new(0, 0, 1920, 1040), 1.0),
    };
    let size = (
        (TOAST_SIZE.0 * scale).round() as u32,
        (TOAST_SIZE.1 * scale).round() as u32,
    );
    let (x, y) = geometry::toast_position(work, size, (16.0 * scale) as u32);
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(size.0, size.1));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.emit("toast-show", &info);
    crate::webview::exclude_from_capture(&window); // see capture::begin
    let _ = window.show();

    let generation = TOAST_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(TOAST_SECONDS));
        if TOAST_GENERATION.load(Ordering::SeqCst) == generation {
            hide_toast(&app);
        }
    });
}

pub fn hide_toast(app: &AppHandle) {
    TOAST_GENERATION.fetch_add(1, Ordering::SeqCst);
    *TOAST_SHOWN.lock().unwrap_or_else(|e| e.into_inner()) = None;
    if let Some(w) = app.get_webview_window(TOAST) {
        let _ = w.hide();
        crate::webview::destroy(&w);
    }
}

/// The toast's Open button: bring Snipmunk forward (the new capture is already selected) and hide the toast.
#[tauri::command]
pub fn toast_open(app: AppHandle) {
    hide_toast(&app);
    crate::tray::show_main(&app);
}
