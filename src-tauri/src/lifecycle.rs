//! Showing, minimizing and leaving: the main window's background colour, the web view's memory level while the window is
//! out of sight, and a quit that is quick on screen and leaves no process and no web view cache behind.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewWindow};

static QUITTING: AtomicBool = AtomicBool::new(false);
/// Snipmunk was started again while it was still leaving: the command line and folder of that start, which is made
/// again when this process is done.
static REOPEN: Mutex<Option<(Vec<String>, String)>> = Mutex::new(None);
/// The last memory level the main window's web view was given.
static LOW: AtomicBool = AtomicBool::new(false);

/// How long a quit waits for the web view's browser process before the caches are cleared anyway.
const BROWSER_WAIT_MS: u32 = 4000;

/// Is Snipmunk on its way out?
pub fn quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

/// A second launch arrived while Snipmunk was leaving.
pub fn reopen_after_quit(args: Vec<String>, cwd: String) {
    *REOPEN.lock().unwrap_or_else(|e| e.into_inner()) = Some((args, cwd));
}

/// The very last step of a quit: start Snipmunk again with what a launch asked for in the meantime (a file to open).
pub fn reopen_if_asked(app: &AppHandle) {
    let Some((args, cwd)) = REOPEN.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return;
    };
    // The new process must not find this one still holding the "one instance" lock.
    tauri_plugin_single_instance::destroy(app);
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut command = std::process::Command::new(exe);
    command.args(args.iter().skip(1));
    if Path::new(&cwd).is_dir() {
        command.current_dir(cwd);
    }
    if let Err(e) = command.spawn() {
        eprintln!("Snipmunk could not be started again: {e}");
    }
}

// --- the window before its page is there -------------------------------------

/// The page's background colour (`--dw-bg` of the design system) for the theme setting; "system" follows Windows.
pub fn background(theme: &str, system_dark: bool) -> (u8, u8, u8) {
    let dark = match theme {
        "dark" => true,
        "light" => false,
        _ => system_dark,
    };
    if dark {
        (0x19, 0x19, 0x1b)
    } else {
        (0xf6, 0xf6, 0xf7)
    }
}

/// Paint the window in the theme's background colour, so nothing white shows before the page does.
pub fn paint_background(window: &WebviewWindow, theme: &str) {
    let system_dark = matches!(window.theme(), Ok(Theme::Dark));
    let (r, g, b) = background(theme, system_dark);
    let _ = window.set_background_color(Some(Color(r, g, b, 255)));
}

// --- memory while out of sight -----------------------------------------------

/// Take the memory level from what the main window is doing now (called when it is resized, minimized or focused).
/// A window that is hidden for a moment, as during a screenshot, keeps its level.
pub fn follow(main: &WebviewWindow) {
    if main.is_minimized().unwrap_or(false) {
        main_visible(main.app_handle(), false);
    } else if main.is_visible().unwrap_or(false) {
        main_visible(main.app_handle(), true);
    }
}

/// The main window went out of sight (minimized or put away) or came back. Meanwhile its web view is told that it is
/// not visible (nothing is drawn, timers slow down) and asked to hold on to less memory; the page is told too, so it can
/// drop what it can load again. Nothing is lost.
pub fn main_visible(app: &AppHandle, visible: bool) {
    if LOW.swap(!visible, Ordering::SeqCst) != visible {
        return; // it already has this level
    }
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    set_out_of_sight(&main, !visible);
    let _ = app.emit_to("main", "main-visible", visible);
}

#[cfg(windows)]
fn set_out_of_sight(window: &WebviewWindow, away: bool) {
    let _ = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        let level = if away {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: the controller is the live web view's; the calls read it and set two values.
        unsafe {
            let _ = webview.controller().SetIsVisible(!away);
            if let Ok(core) = webview.controller().CoreWebView2() {
                // (an older WebView2 runtime does not have the interface: nothing to do)
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let _ = core19.SetMemoryUsageTargetLevel(level);
                }
            }
        }
    });
}

#[cfg(not(windows))]
fn set_out_of_sight(_: &WebviewWindow, _: bool) {}

// --- quit --------------------------------------------------------------------

/// What the web view keeps only to be faster next time: removed on quit. Local storage, session storage, cookies and
/// every other part of the profile stay.
const CACHES: [&str; 10] = [
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnGraphiteCache",
    "Default/DawnWebGPUCache",
    "GPUPersistentCache",
    "ShaderCache",
    "GrShaderCache",
    "GraphiteDawnCache",
    "component_crx_cache",
];

/// Delete the web view's caches under its user data folder (WebView2 keeps its profile in `EBWebView` inside it).
/// Returns how many folders went.
pub fn clear_web_caches(user_data: &Path) -> usize {
    let mut gone = 0;
    for root in [user_data.to_path_buf(), user_data.join("EBWebView")] {
        for name in CACHES {
            let dir = root.join(name);
            if dir.is_dir() && std::fs::remove_dir_all(&dir).is_ok() {
                gone += 1;
            }
        }
    }
    gone
}

/// The web view's browser process and user data folder.
struct Browser {
    pid: u32,
    data: Option<PathBuf>,
}

#[cfg(windows)]
fn ask_browser(window: &WebviewWindow) -> Option<Browser> {
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment7;
            use windows_core::{Interface, PWSTR};
            let mut pid = 0u32;
            let mut data = None;
            // SAFETY: the controller and environment are the live web view's; the out values outlive the calls, and
            // `take_pwstr` frees the string the call allocated.
            unsafe {
                if let Ok(core) = webview.controller().CoreWebView2() {
                    let _ = core.BrowserProcessId(&mut pid);
                }
                if let Ok(env) = webview.environment().cast::<ICoreWebView2Environment7>() {
                    let mut folder = PWSTR::null();
                    if env.UserDataFolder(&mut folder).is_ok() {
                        data = Some(PathBuf::from(webview2_com::take_pwstr(folder)));
                    }
                }
            }
            let _ = tx.send(Browser { pid, data });
        })
        .ok()?;
    rx.recv_timeout(Duration::from_secs(1)).ok()
}

#[cfg(not(windows))]
fn ask_browser(_: &WebviewWindow) -> Option<Browser> {
    None
}

/// Wait for a process to end. `false`: it was still there after `ms`.
#[cfg(windows)]
fn wait_for_end(pid: u32, ms: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    if pid == 0 {
        return false;
    }
    // SAFETY: the handle is opened only to wait on, and closed again.
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) else {
            return true; // no such process any more
        };
        let ended = WaitForSingleObject(handle, ms) == WAIT_OBJECT_0;
        let _ = CloseHandle(handle);
        ended
    }
}

#[cfg(not(windows))]
fn wait_for_end(_: u32, _: u32) -> bool {
    false
}

/// Leave Snipmunk. The windows and the tray icon are gone at once; the web view is then closed, its caches are deleted
/// and the process ends. `restart` starts Snipmunk anew instead (after an update).
pub fn quit(app: &AppHandle, restart: bool) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    // (the steps of a quit go into the measurement's log, like those of a start)
    crate::startup::note("quit");
    crate::placement::flush();
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    crate::tray::remove(app);
    crate::startup::note("quit-hidden");
    // No shortcut starts a capture while Snipmunk is leaving.
    crate::hotkey::stop(app);
    // A clean exit (saved, or "Don't save") removes the working copy of the open guide; a crash or a shutdown leaves it
    // for recovery.
    crate::snpd::discard_open();
    // Waiting on the web view must not block the thread that runs it.
    let app = app.clone();
    std::thread::spawn(move || {
        let browser = app.get_webview_window("main").and_then(|w| ask_browser(&w));
        for window in app.webview_windows().values() {
            let _ = window.destroy();
        }
        if let Some(browser) = browser {
            // The files are only free once the browser process has ended.
            if wait_for_end(browser.pid, BROWSER_WAIT_MS) {
                crate::startup::note("quit-browser");
                if let Some(data) = browser.data {
                    clear_web_caches(&data);
                }
            }
        }
        crate::startup::note("quit-cleared");
        if restart {
            // The restart is the new start: a launch that came meanwhile is not made a second time.
            REOPEN.lock().unwrap_or_else(|e| e.into_inner()).take();
            // A downloaded update is installed by this restart. The installer ends this process, so what the end of
            // the program would clear away is cleared first.
            if crate::updates::waiting(&app) {
                clear_at_end(&app);
                crate::updates::install(&app);
            }
            app.restart();
        } else {
            app.exit(0);
        }
    });
}

/// What goes when Snipmunk ends: its temporary files, the shortcut hook and, with "Clear on exit", the session.
pub fn clear_at_end(app: &AppHandle) {
    crate::placement::flush();
    crate::hotkey::stop(app);
    crate::export::clear_temp();
    let state = app.state::<crate::commands::AppState>();
    if state.settings.lock().unwrap().clear_on_exit {
        state.sessions.lock().unwrap().delete_current();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_is_painted_in_the_themes_background() {
        assert_eq!(background("light", true), (0xf6, 0xf6, 0xf7));
        assert_eq!(background("dark", false), (0x19, 0x19, 0x1b));
        assert_eq!(background("system", true), background("dark", false));
        assert_eq!(background("system", false), background("light", true));
        // The same colours as the page's.
        let css = include_str!("../../../dawn-core/packages/ui/src/styles.css");
        for value in ["--dw-bg: #f6f6f7", "--dw-bg: #19191b"] {
            assert!(
                css.contains(value),
                "{value} is in the design system's styles"
            );
        }
    }

    #[test]
    fn quitting_removes_the_caches_and_keeps_what_the_page_stored() {
        let dir = crate::testdir::new();
        let profile = dir.path().join("EBWebView");
        let kept = [
            "Default/Local Storage/leveldb",
            "Default/Session Storage",
            "Default/Network",
            "Default/IndexedDB",
        ];
        for name in CACHES.iter().chain(kept.iter()) {
            let sub = profile.join(name);
            std::fs::create_dir_all(&sub).unwrap();
            std::fs::write(sub.join("data"), b"x").unwrap();
        }
        std::fs::write(profile.join("Local State"), b"x").unwrap();
        assert_eq!(clear_web_caches(dir.path()), CACHES.len());
        for name in CACHES {
            assert!(!profile.join(name).exists(), "{name} is gone");
        }
        for name in kept {
            assert!(profile.join(name).join("data").is_file(), "{name} stays");
        }
        assert!(profile.join("Local State").is_file());
        assert_eq!(clear_web_caches(dir.path()), 0, "nothing left to remove");
    }
}
