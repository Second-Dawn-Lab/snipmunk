//! Settings of the web view that Tauri does not expose.

use tauri::WebviewWindow;

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
