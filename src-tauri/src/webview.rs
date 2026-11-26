//! Settings of the web view that Tauri does not expose, and the windows that are made for one use.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The web view options of every Snipmunk window. All windows must name exactly the same ones: they then share one
/// web view environment (one user data folder, one browser process). The main window's are in `tauri.conf.json`.
///
/// - `--disable-features=...`: the three features Tauri's web view library turns off itself (naming options replaces
///   its list, so they are repeated): two Office/PDF toolbar overlays and SmartScreen's page checks, none of which an
///   app that shows only its own pages uses.
/// - `--process-per-site`: all windows show the same local site, so their pages share one renderer process instead of
///   one per window (measured: about 40 MB less with four windows; see docs/performance.md).
///
/// The GPU stays on: the video player and the large canvases depend on it.
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --process-per-site";

/// The builder of every window Snipmunk makes.
pub fn window<'a>(
    app: &'a AppHandle,
    label: &str,
    url: WebviewUrl,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, url).additional_browser_args(BROWSER_ARGS)
}

/// Windows that were told to go and may not be gone yet.
static GOING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Take away a window that was made for one use (an overlay, the countdown, the toast): its web page and the memory it
/// holds go with it. The next one of that name is made by whoever finds none with `existing`.
pub fn destroy(window: &WebviewWindow) {
    GOING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(window.label().to_string());
    let _ = window.destroy();
}

/// The window of that name, if there is one to use: one that is just going away is waited for (its name is free then).
/// Not to be called on the main thread, which is what takes the window away.
pub fn existing(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    let going = {
        let mut list = GOING.lock().unwrap_or_else(|e| e.into_inner());
        let before = list.len();
        list.retain(|l| l != label);
        list.len() != before
    };
    if going {
        let start = Instant::now();
        while app.get_webview_window(label).is_some() && start.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    app.get_webview_window(label)
}

/// Show a window without giving it the keyboard focus.
#[cfg(windows)]
pub fn show_without_focus(win: &WebviewWindow) {
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
pub fn show_without_focus(win: &WebviewWindow) {
    let _ = win.show();
}

/// Turn off WebView2's browser accelerator keys (F5, Ctrl+P, Ctrl+F, F12, ...) for a window.
/// Snipmunk is an app, not a browser: those shortcuts do nothing useful, and the capture shortcut must reach
/// Snipmunk. Text editing keys (Ctrl+C, V, X, Z, Y, A) are not accelerators and keep working.
#[cfg(windows)]
pub fn disable_browser_accelerators(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;
        // SAFETY: the controller and settings are valid COM objects of the live web view; the calls only read
        // them and set one boolean.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                if let Ok(settings) = core.Settings() {
                    if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                        let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                    }
                }
            }
        }
    });
}

#[cfg(not(windows))]
pub fn disable_browser_accelerators(_: &WebviewWindow) {}

/// Windows can leave a window out of every screen capture (Windows 10 version 2004 and later). The overlay, countdown and
/// toast windows use it for good. The main and settings windows are capturable (Snipping Tool, screen sharing, OBS) and
/// only leave the screenshot while Snipmunk grabs the screen (see `capture::OwnWindowsHidden`).
/// Returns whether it worked.
#[cfg(windows)]
pub fn set_capture_excluded(window: &WebviewWindow, excluded: bool) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_NONE, WINDOW_DISPLAY_AFFINITY,
    };
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    // WDA_EXCLUDEFROMCAPTURE = 0x11
    let affinity = if excluded {
        WINDOW_DISPLAY_AFFINITY(0x11)
    } else {
        WDA_NONE
    };
    unsafe { SetWindowDisplayAffinity(HWND(hwnd.0), affinity).is_ok() }
}

#[cfg(not(windows))]
pub fn set_capture_excluded(_: &WebviewWindow, _: bool) -> bool {
    false
}

/// Leave a window out of every screen capture for good.
pub fn exclude_from_capture(window: &WebviewWindow) -> bool {
    set_capture_excluded(window, true)
}

/// Whether Esc is held down right now (the countdown window cannot take the keyboard focus, so it polls).
#[cfg(windows)]
pub fn escape_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
    unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) as u16 & 0x8000 != 0 }
}

#[cfg(not(windows))]
pub fn escape_down() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::BROWSER_ARGS;

    #[test]
    fn every_window_uses_the_same_web_view_options() {
        // The main window comes from the configuration...
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        for window in config["app"]["windows"].as_array().unwrap() {
            assert_eq!(window["additionalBrowserArgs"], BROWSER_ARGS);
        }
        // ...and every other one from `webview::window`: a window with other options could not be made at all.
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for entry in std::fs::read_dir(src).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|n| n == "webview.rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            assert!(
                !text.contains("WebviewWindowBuilder::new"),
                "{} makes a window without crate::webview::window",
                path.display()
            );
        }
        assert!(!BROWSER_ARGS.contains("--disable-gpu"));
    }
}
