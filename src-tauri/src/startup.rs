//! How the app was started, and making sure a normal start shows the window.
//!
//! Only the autostart entry (it passes `--hidden`) starts Snipmunk in the tray. Every other start, whether from the Start
//! menu, the desktop shortcut, a double click, `pnpm tauri dev` or `run-snipmunk.bat`, shows the main window.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};

/// The flag the autostart entry adds to the command line.
pub const HIDDEN_FLAG: &str = "--hidden";

/// Was the app started by the autostart entry (stay in the tray)? `args` is the whole command line, program first.
pub fn launched_hidden<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().skip(1).any(|a| a.as_ref() == HIDDEN_FLAG)
}

/// Give this process its application id (the bundle identifier).
#[cfg(windows)]
pub fn set_app_id(identifier: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    // SAFETY: the string lives through the call, which copies it.
    if let Err(e) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(identifier)) } {
        eprintln!("the application id could not be set: {e}");
    }
}

#[cfg(not(windows))]
pub fn set_app_id(_: &str) {}

/// The main window still waits for its page's first frame before it is shown.
static WAITING: AtomicBool = AtomicBool::new(false);

/// A normal start: the window is shown when its page reports its first painted frame (`app_ready`), so no empty window
/// flashes. A page that never reports (it failed to load) is shown anyway after a few seconds. A window that is still
/// hidden or minimized a moment later (a start-up hint from the launcher, a saved place off the screen) is shown again.
pub fn show_when_painted(app: &AppHandle) {
    WAITING.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        for wait in [3000u64, 1000, 2000] {
            std::thread::sleep(Duration::from_millis(wait));
            // Put away to the tray or quitting: that was asked for.
            if crate::tray::kept() || crate::lifecycle::quitting() {
                return;
            }
            let Some(w) = app.get_webview_window("main") else {
                return;
            };
            let shown = w.is_visible().unwrap_or(true) && !w.is_minimized().unwrap_or(false);
            if WAITING.swap(false, Ordering::SeqCst) || !shown {
                eprintln!("the main window was not visible after start-up; showing it");
                crate::tray::show_main(&app);
            }
        }
    });
}

/// The autostart entry's start: nothing comes to the front. With "Keep running in the tray" the window stays hidden
/// behind the tray icon; otherwise (there is no icon then) it is on the taskbar, minimized.
pub fn start_out_of_sight(app: &AppHandle, close_action: &str) {
    if crate::tray::wanted(close_action, false) {
        crate::tray::hide_to_tray(app);
    } else if let Some(w) = app.get_webview_window("main") {
        show_minimized(&w);
        crate::lifecycle::main_visible(app, false);
    }
}

#[cfg(windows)]
fn show_minimized(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWMINNOACTIVE};
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    // SAFETY: the handle is the live window's. Showing it minimized this way takes the focus from nothing.
    let _ = unsafe { ShowWindow(HWND(hwnd.0), SW_SHOWMINNOACTIVE) };
}

#[cfg(not(windows))]
fn show_minimized(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.minimize();
}

/// Milliseconds since this process was started.
#[cfg(windows)]
pub fn since_start() -> u64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::SystemInformation::GetSystemTimeAsFileTime;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    let ticks = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    let (mut created, mut exited, mut kernel, mut user) = Default::default();
    // SAFETY: the handle is this process's own, and the four times outlive the call.
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
        .is_ok()
    };
    // SAFETY: only reads the system clock.
    let now = unsafe { GetSystemTimeAsFileTime() };
    if ok {
        ticks(now).saturating_sub(ticks(created)) / 10_000
    } else {
        0
    }
}

#[cfg(not(windows))]
pub fn since_start() -> u64 {
    0
}

/// Note a step of the start-up in the file named by `SNIPMUNK_STARTUP_LOG` (for the start-up measurement).
pub fn note(step: &str) {
    note_value(step, since_start());
}

fn note_value(step: &str, value: u64) {
    use std::io::Write;
    // (test and measurement instances only)
    let Some(path) =
        std::env::var_os("SNIPMUNK_STARTUP_LOG").filter(|_| crate::capture::guard_active())
    else {
        return;
    };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{step} {value}");
    }
}

/// The main window's page calls this once its first frame is painted and it answers input: a normal start shows the
/// window now. `page_ms` is how long the page took since it began to load, `frame` whether an animation frame (and not
/// the fallback timer) reported it; both go into the start-up measurement.
#[tauri::command]
pub fn app_ready(app: AppHandle, page_ms: Option<f64>, frame: Option<bool>) {
    note("ready");
    if let Some(ms) = page_ms {
        note_value("page", ms.max(0.0) as u64);
    }
    if let Some(frame) = frame {
        note_value("frame", u64::from(frame));
    }
    if WAITING.swap(false, Ordering::SeqCst) {
        crate::tray::show_main(&app);
        note("shown");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_hidden_flag_starts_in_the_tray() {
        assert!(!launched_hidden(["snipmunk.exe"]));
        assert!(!launched_hidden(Vec::<String>::new()));
        assert!(launched_hidden(["snipmunk.exe", "--hidden"]));
        assert!(!launched_hidden(["snipmunk.exe", "--hide"]));
        assert!(!launched_hidden(["snipmunk.exe", "folder/--hidden.png"]));
        assert!(
            !launched_hidden(["--hidden"]),
            "the first entry is the program"
        );
    }
}
