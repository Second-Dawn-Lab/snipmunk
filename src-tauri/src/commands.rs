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
        let mut sessions = SessionStore::open_in(
            SessionStore::default_root(),
            crate::language::resolve(&settings.language),
        );
        // The current recording lives in the temp folder; recordings of earlier layouts stay where they are (not shown).
        sessions.set_recordings_root(crate::projects::current_root());
        // Cards of recordings whose folder is gone (deleted in Explorer, or temp cleaned up) go; old sessions go according to the
        // retention setting, but never their recordings.
        sessions.absorb_all_recordings();
        sessions.prune_missing_recordings();
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
    crate::recording::apply_audio_settings(app);
    {
        let state = app.state::<AppState>();
        let mut store = state.sessions.lock().unwrap();
        store.set_language(crate::language::resolve(&settings.language));
        store.set_recordings_root(crate::projects::current_root());
    }
    // The live webcam bubble follows the webcam switch (windows are made on a thread of their own).
    {
        let (app2, on) = (app.clone(), settings.webcam_on);
        std::thread::spawn(move || crate::bubble::set_visible(&app2, on));
    }
    crate::hotkey::apply(
        app,
        &settings.capture_hotkey,
        &settings.record_hotkey,
        &[
            ("guide", &settings.doc_start_hotkey),
            ("guidestep", &settings.doc_step_hotkey),
        ],
    );
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

/// The page the settings window is to show when it opens (set by "More recording settings…", taken by the window).
static SETTINGS_TAB: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Open the settings window, on the page `tab` when given.
#[tauri::command]
pub fn open_settings(app: AppHandle, tab: Option<String>) {
    let existing = app.get_webview_window("settings").is_some();
    *SETTINGS_TAB.lock().unwrap() = tab;
    tray::open_settings_window(&app);
    if existing {
        // An open window takes the page now; a new one asks for it when it has loaded.
        let _ = app.emit("settings-tab", ());
    }
}

/// The page that was asked for with `open_settings` (once).
#[tauri::command]
pub fn take_settings_tab() -> Option<String> {
    SETTINGS_TAB.lock().unwrap().take()
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::projects::leave(&app);
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
        crate::projects::request_quit(&app);
    } else if let Some(w) = app.get_webview_window("main") {
        crate::placement::flush();
        let _ = w.hide();
    }
    Ok(())
}

// --- session ---------------------------------------------------------------

/// Run a change on the session store, then tell every window about the new state.
pub(crate) fn change_session(
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

/// The folder the recordings are kept in (the setting, or the Videos folder + Snipmunk), and how many recordings are not in it.
#[tauri::command]
pub fn recordings_info(state: State<'_, AppState>) -> Value {
    let store = state.sessions.lock().unwrap();
    serde_json::json!({
        "folder": store.recordings_root().to_string_lossy(),
        "toMove": store.recordings_to_move().len(),
    })
}

/// The default folders of recordings and of automatically saved screenshots (Videos / Pictures + Snipmunk).
#[tauri::command]
pub fn default_folders() -> Value {
    serde_json::json!({
        "recordings": crate::recstore::default_recordings_dir().to_string_lossy(),
        "pictures": crate::recstore::default_pictures_dir().to_string_lossy(),
    })
}

/// The microphones and the outputs (whose sound can be recorded) that Windows has now, with the default of each. Only the list is read:
/// no device is opened. The settings window asks again every few seconds, so plugging a device in or out shows up.
#[tauri::command]
pub async fn audio_devices() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        let (mic, system) = crate::audio::wasapi::list_devices();
        #[cfg(not(windows))]
        let (mic, system): (Vec<()>, Vec<()>) = (Vec::new(), Vec::new());
        serde_json::json!({ "mic": mic, "system": system })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "mic": [], "system": [] }))
}

/// Cards of recordings that were deleted or moved away in Explorer are removed (the page asks when the recordings are shown).
#[tauri::command]
pub async fn refresh_recordings(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Session> {
    let (session, removed) = {
        let mut store = state.sessions.lock().unwrap();
        let n = store.prune_missing_recordings();
        (store.session().clone(), n)
    };
    if removed > 0 {
        let _ = app.emit("session-changed", &session);
    }
    Ok(session)
}

/// Move the existing recordings into the recordings folder of the setting, one after the other (the lock is held for one
/// recording at a time), telling the page the progress (`recordings-move`: done, total).
#[tauri::command]
pub async fn move_recordings(app: AppHandle, state: State<'_, AppState>) -> CmdResult<usize> {
    let ids = state.sessions.lock().unwrap().recordings_to_move();
    let total = ids.len();
    let mut moved = 0;
    for (i, id) in ids.iter().enumerate() {
        let _ = app.emit(
            "recordings-move",
            serde_json::json!({ "done": i, "total": total }),
        );
        if state.sessions.lock().unwrap().relocate_capture(id) {
            moved += 1;
        }
    }
    let _ = app.emit(
        "recordings-move",
        serde_json::json!({ "done": total, "total": total }),
    );
    let session = state.sessions.lock().unwrap().session().clone();
    let _ = app.emit("session-changed", &session);
    Ok(moved)
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

#[tauri::command]
pub fn create_group(
    app: AppHandle,
    state: State<'_, AppState>,
    name: Option<String>,
    kind: Option<String>,
) -> CmdResult<Session> {
    let recording = kind.as_deref() == Some("recording");
    change_session(&app, &state, |s| {
        s.create_group_of(name, recording).map(|_| ())
    })
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

/// Delete a group; its captures go to the end of `move_to`, or are deleted with it when that is not given.
#[tauri::command]
pub fn delete_group(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: String,
    move_to: Option<String>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.delete_group(&group_id, move_to.as_deref())
    })
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
    // A recording (the player reads it in parts: the video element sends Range requests).
    if let Some((session, file)) = path.split_once('/') {
        // A picture of a guide (Documents mode): guide/<id>/<file>
        if session == "guide" {
            if let Some((id, name)) = file.split_once('/') {
                let target = crate::guides::image_path(id, name).map(|p| (p, 0, None));
                return serve_recording(target, name, None);
            }
        }
        // A project (a .snpr file): the media is read from the file by offset, nothing is extracted.
        if let Some(rest) = file.strip_prefix("proj/") {
            if let Some((id, name)) = rest.split_once('/') {
                let target = crate::projects::entry_range(id, name);
                let range = request
                    .headers()
                    .get("range")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                return serve_recording(target, name, range.as_deref());
            }
        }
        if file.starts_with("rec/") {
            let target = ctx
                .app_handle()
                .try_state::<AppState>()
                .and_then(|state| state.sessions.lock().unwrap().recording_file(session, file))
                .map(|p| (p, 0, None));
            let range = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            return serve_recording(target, file, range.as_deref());
        }
    }
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

/// The part of a file a `Range: bytes=a-b` header asks for, as (start, end inclusive); `None` for a missing or unusable header.
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        // "-500": the last 500 bytes.
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() {
            len - 1
        } else {
            b.parse::<u64>().ok()?.min(len - 1)
        };
        (start, end)
    };
    (start <= end && start < len).then_some((start, end))
}

fn serve_recording(
    target: Option<(std::path::PathBuf, u64, Option<u64>)>,
    file: &str,
    range: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let not_found = || {
        tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap_or_default()
    };
    // The part of the file that is the entry: all of a plain file, or a stored entry of a project file.
    let Some((path, base, window)) = target else {
        return not_found();
    };
    let Ok(mut f) = std::fs::File::open(&path) else {
        return not_found();
    };
    let Ok(file_len) = f.metadata().map(|m| m.len()) else {
        return not_found();
    };
    let len = window.unwrap_or(file_len.saturating_sub(base));
    let kind = match file.rsplit('.').next() {
        Some("mp4") => "video/mp4",
        Some("m4a") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("png") => "image/png",
        _ => "application/json",
    };
    let builder = tauri::http::Response::builder()
        .header("Content-Type", kind)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store");
    match range.and_then(|r| parse_range(r, len)) {
        Some((start, end)) => {
            let mut bytes = vec![0u8; (end - start + 1) as usize];
            if f.seek(SeekFrom::Start(base + start)).is_err() || f.read_exact(&mut bytes).is_err() {
                return not_found();
            }
            builder
                .status(206)
                .header("Content-Range", format!("bytes {start}-{end}/{len}"))
                .body(bytes)
                .unwrap_or_default()
        }
        None => {
            let mut bytes = Vec::with_capacity(len as usize);
            if f.seek(SeekFrom::Start(base)).is_err()
                || f.take(len).read_to_end(&mut bytes).is_err()
            {
                return not_found();
            }
            builder.status(200).body(bytes).unwrap_or_default()
        }
    }
}

/// Decode %XX escapes (invalid ones are kept as they are).
pub(crate) fn percent_decode(s: &str) -> String {
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

#[cfg(test)]
mod range_tests {
    use super::parse_range;

    #[test]
    fn byte_ranges_are_read_the_way_a_video_element_asks() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=50-10", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-1", 0), None);
    }
}

/// The cameras Windows has now (only their names are read: no camera is opened).
#[tauri::command]
pub async fn webcam_devices() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        let list = crate::webcam::list_devices();
        #[cfg(not(windows))]
        let list: Vec<()> = Vec::new();
        serde_json::json!(list)
    })
    .await
    .unwrap_or_else(|_| serde_json::json!([]))
}
