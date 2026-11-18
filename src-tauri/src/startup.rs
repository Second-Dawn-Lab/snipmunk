//! How the app was started, and making sure a normal start shows the window.
//!
//! Only the autostart entry (it passes `--hidden`) starts Snipmunk in the tray. Every other start, whether from the Start
//! menu, the desktop shortcut, a double click, `pnpm tauri dev` or `run-snipmunk.bat`, shows the main window.

use std::time::Duration;

use tauri::{AppHandle, Manager};

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

/// The window is shown by `setup`; this makes sure it stays shown. A window that is still hidden or minimized a moment
/// later (a start-up hint from the launcher, a slow web view, a saved place off the screen) is shown again.
pub fn keep_main_shown(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        for wait in [400u64, 1100, 2500] {
            std::thread::sleep(Duration::from_millis(wait));
            let Some(w) = app.get_webview_window("main") else {
                return;
            };
            let shown = w.is_visible().unwrap_or(true) && !w.is_minimized().unwrap_or(false);
            if !shown {
                eprintln!("the main window was not visible after start-up; showing it");
                crate::tray::show_main(&app);
            }
        }
    });
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
