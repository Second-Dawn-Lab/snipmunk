//! The commands the web page calls (all listed in one `generate_handler!` in `lib.rs`) and the shared app state.

use std::sync::Mutex;

use crate::hotkey::{self, HotkeyManager, HotkeyStatus, ShortcutCheck};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{CmdError, CmdResult};
use crate::sessions::{now_ms, Session, SessionStore};
use crate::settings::Settings;
use crate::tray;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub sessions: Mutex<SessionStore>,
    /// The group tab the user is looking at: new captures go there. Set by the page.
    pub active_group: Mutex<Option<String>>,
}

impl AppState {
    pub fn load() -> Self {
        let settings = Settings::load();
        let sessions = SessionStore::open(SessionStore::default_root());
        // Old sessions go at startup, according to the retention setting.
        sessions.cleanup(settings.retention_days, now_ms());
        Self {
            settings: Mutex::new(settings),
            sessions: Mutex::new(sessions),
            active_group: Mutex::new(None),
        }
    }
}

// --- settings --------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, patch: Value) -> CmdResult<Settings> {
    patch_settings(&app, patch)
}

/// Merge a change into the settings, save them, apply them and tell every window.
pub fn patch_settings(app: &AppHandle, patch: Value) -> CmdResult<Settings> {
    let state = app.state::<AppState>();
    let updated = {
        let mut settings = state.settings.lock().unwrap();
        // Check the whole result first: a bad value must not be saved.
        let mut next = settings.clone();
        next.merge(patch)?;
        next.save()?;
        *settings = next;
        settings.clone()
    };
    apply(app, &updated);
    let _ = app.emit("settings-changed", &updated);
    Ok(updated)
}

/// Make the running app match the settings.
pub fn apply(app: &AppHandle, settings: &Settings) {
    apply_autostart(app, settings.launch_at_login);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_always_on_top(settings.always_on_top);
    }
    tray::set_language(app, &settings.language);
    crate::hotkey::apply(app, &settings.capture_hotkey);
}

/// Only touches the Windows registry entry when the state differs.
pub fn apply_autostart(app: &AppHandle, wanted: bool) {
    let manager = app.autolaunch();
    if manager.is_enabled().unwrap_or(false) == wanted {
        return;
    }
    let result = if wanted {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(err) = result {
        eprintln!("could not update launch-at-login: {err}");
    }
}

/// The state of the capture shortcut, for the notice in the main and settings windows.
#[tauri::command]
pub fn get_hotkey_status(manager: State<'_, HotkeyManager>) -> HotkeyStatus {
    manager.status()
}

/// Check a shortcut the settings window recorded.
#[tauri::command]
pub fn check_shortcut(text: String) -> ShortcutCheck {
    hotkey::check(&text)
}

/// Open one of Snipmunk's pages on GitHub in the browser. Only addresses of the Second Dawn organization are opened.
#[tauri::command]
pub fn open_url(url: String) -> CmdResult<()> {
    const ALLOWED: &str = "https://github.com/Second-Dawn-Lab/";
    if !url.starts_with(ALLOWED) || url.contains(char::is_whitespace) || url.contains('"') {
        return Err(CmdError::new(
            "bad_request",
            "this address cannot be opened",
        ));
    }
    #[cfg(windows)]
    let result = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result
        .map(|_| ())
        .map_err(|e| CmdError::new("io", e.to_string()))
}

// --- windows ---------------------------------------------------------------

#[tauri::command]
pub fn open_settings(app: AppHandle) {
    tray::open_settings_window(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Answer to the "close window?" dialog: "background" or "quit".
#[tauri::command]
pub fn close_action(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
    remember: bool,
) -> CmdResult<()> {
    if action != "background" && action != "quit" {
        return Err(CmdError::new("bad_request", "unknown close action"));
    }
    if remember {
        let updated = {
            let mut settings = state.settings.lock().unwrap();
            settings.close_action = action.clone();
            settings.save()?;
            settings.clone()
        };
        let _ = app.emit("settings-changed", &updated);
    }
    if action == "quit" {
        app.exit(0);
    } else if let Some(w) = app.get_webview_window("main") {
        crate::placement::flush();
        let _ = w.hide();
    }
    Ok(())
}

// --- session ---------------------------------------------------------------

/// Run a change on the session store, then tell every window about the new state.
fn change_session(
    app: &AppHandle,
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut SessionStore) -> Result<(), crate::sessions::StoreError>,
) -> CmdResult<Session> {
    let session = {
        let mut store = state.sessions.lock().unwrap();
        f(&mut store)?;
        store.session().clone()
    };
    let _ = app.emit("session-changed", &session);
    Ok(session)
}

/// The page tells which group tab is shown, so a capture lands there.
#[tauri::command]
pub fn set_active_group(state: State<'_, AppState>, group_id: Option<String>) {
    *state.active_group.lock().unwrap() = group_id;
}

#[tauri::command]
pub fn get_current_session(state: State<'_, AppState>) -> Session {
    state.sessions.lock().unwrap().session().clone()
}

/// Start an empty session. The old one stays on disk (retention removes it later) unless `discard_previous`.
#[tauri::command]
pub fn new_session(
    app: AppHandle,
    state: State<'_, AppState>,
    discard_previous: bool,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.new_session(discard_previous))
}

#[tauri::command]
pub fn create_group(
    app: AppHandle,
    state: State<'_, AppState>,
    name: Option<String>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.create_group(name).map(|_| ()))
}

#[tauri::command]
pub fn rename_group(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: String,
    name: String,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.rename_group(&group_id, &name))
}

#[tauri::command]
pub fn delete_group(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: String,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.delete_group(&group_id))
}

#[tauri::command]
pub fn rename_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_id: String,
    name: String,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.rename_capture(&capture_id, &name))
}

#[tauri::command]
pub fn delete_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_id: String,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.delete_capture(&capture_id))
}

#[tauri::command]
pub fn reorder_captures(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: String,
    capture_ids: Vec<String>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.reorder_captures(&group_id, &capture_ids)
    })
}

#[tauri::command]
pub fn move_capture_to_group(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_id: String,
    group_id: String,
    index: Option<usize>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.move_capture_to_group(&capture_id, &group_id, index)
    })
}

/// Handler of the `snipmunk-img` scheme: `/<sessionId>/images/<captureId>.png` is that screenshot.
pub fn serve_image<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    // The web view sends the path percent-encoded ("<session>%2Fimages%2F<id>.png").
    let path = percent_decode(request.uri().path().trim_matches('/'));
    let body = path.split_once('/').and_then(|(session, file)| {
        let state = ctx.app_handle().try_state::<AppState>()?;
        let store = state.sessions.lock().unwrap();
        store.read_image(session, file)
    });
    match body {
        Some(bytes) => tauri::http::Response::builder()
            .header("Content-Type", "image/png")
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

/// Decode %XX escapes (invalid ones are kept as they are).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn the_encoded_image_path_of_the_web_view_is_decoded() {
        assert_eq!(
            percent_decode("s0demo0000001%2Fimages%2Fc0001.png"),
            "s0demo0000001/images/c0001.png"
        );
        assert_eq!(percent_decode("a%2fb"), "a/b");
        assert_eq!(percent_decode("plain/path.png"), "plain/path.png");
    }

    #[test]
    fn invalid_escapes_are_kept() {
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz%2"), "%zz%2");
        assert_eq!(percent_decode("a%41"), "aA");
    }
}
