//! The recording mode shows ONE thing at a time: the current recording (kept in the Windows temp folder until it is saved as a project
//! or replaced) or one opened project (`.snpr`, see `package.rs`). This module keeps the opened projects: where each lies, the small
//! cache folder in temp that holds its unsaved edits (the journal) and, only when an export needs it, the extracted media; it serves
//! the media of a project to the player straight from the file (by offset, no extraction), and keeps the list of recent projects.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{CmdError, CmdResult};
use crate::package::{self, KIND_RECORDING};

/// The temp folder of the product (`%TEMP%`, or the folder of `SNIPMUNK_TEMP_DIR` for development).
#[cfg(not(test))]
pub fn temp_base() -> PathBuf {
    crate::capture::dev_env("SNIPMUNK_TEMP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(crate::store::temp_root)
        .join("Snipmunk")
}

/// In the tests: a test's own folder (see `testdir`).
#[cfg(test)]
pub fn temp_base() -> PathBuf {
    crate::testdir::product_folder("Snipmunk")
}

/// Where the current recording lives: `%TEMP%\Snipmunk\current`.
pub fn current_root() -> PathBuf {
    temp_base().join("current")
}

fn cache_root() -> PathBuf {
    temp_base().join("projects")
}

/// A stable id for a project file: the same file always has the same cache folder (so unsaved edits are found again after a crash).
pub fn project_id(path: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().to_lowercase().hash(&mut h);
    format!("{:016x}", h.finish())
}

struct Open {
    path: PathBuf,
    name: String,
    entries: HashMap<String, (u64, u64)>,
}

static OPEN: Mutex<Option<HashMap<String, Open>>> = Mutex::new(None);

fn with_open<R>(f: impl FnOnce(&mut HashMap<String, Open>) -> R) -> R {
    let mut g = OPEN.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

/// The cache folder of a project (made when needed).
pub fn cache_dir(id: &str) -> PathBuf {
    cache_root().join(id)
}

/// Is `id` the id of a project (`proj:<id>`)? Returns the id.
pub fn as_project(capture_id: &str) -> Option<&str> {
    capture_id.strip_prefix("proj:")
}

fn name_of(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Project".into())
}

/// The folder an export or an effects change of the project works in: it holds `recording.json` (the newest version, with the
/// unsaved edits) and, once `stage` ran, the media. Returns it with the name of the project.
pub fn project_dir(id: &str) -> Option<(PathBuf, String)> {
    let (path, name) = with_open(|m| m.get(id).map(|o| (o.path.clone(), o.name.clone())))?;
    let dir = cache_dir(id);
    std::fs::create_dir_all(&dir).ok()?;
    if !dir.join("recording.json").is_file() {
        let pkg = package::open(&path, KIND_RECORDING).ok()?;
        std::fs::write(dir.join("recording.json"), pkg.meta("recording.json").ok()?).ok()?;
    }
    Some((dir, name))
}

/// Extract the media of a project into its cache folder (an export reads files); what is there already stays. `recording.json` of
/// the cache is never replaced (it holds the unsaved edits).
pub fn stage(id: &str) -> std::io::Result<PathBuf> {
    let (dir, _) =
        project_dir(id).ok_or_else(|| std::io::Error::other("the project is not open"))?;
    let path = with_open(|m| m.get(id).map(|o| o.path.clone()))
        .ok_or_else(|| std::io::Error::other("the project is not open"))?;
    let pkg = package::open(&path, KIND_RECORDING)?;
    for (name, (offset, len)) in &pkg.entries {
        if name == package::MANIFEST
            || name.starts_with("meta/")
            || name == "recording.json"
            || name == "thumbnail.png"
        {
            continue;
        }
        let target = dir.join(name);
        if target.is_file() && std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0) == *len {
            continue;
        }
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut src = std::fs::File::open(&path)?;
        std::io::Seek::seek(&mut src, std::io::SeekFrom::Start(*offset))?;
        let part = dir.join(format!("{name}.part").replace('/', "_"));
        let mut out = std::fs::File::create(&part)?;
        std::io::copy(&mut std::io::Read::take(src, *len), &mut out)?;
        drop(out);
        std::fs::rename(&part, &target)?;
    }
    Ok(dir)
}

/// Where the bytes of `name` of the project `id` are, for the player: (file, offset, length). `recording.json` is the cache's
/// copy when there are unsaved edits (a plain file), else the newest stored version.
pub fn entry_range(id: &str, name: &str) -> Option<(PathBuf, u64, Option<u64>)> {
    if name == "recording.json" {
        let overlay = cache_dir(id).join("recording.json");
        if overlay.is_file() && cache_dir(id).join("dirty").is_file() {
            return Some((overlay, 0, None));
        }
        let path = with_open(|m| m.get(id).map(|o| o.path.clone()))?;
        let p = package::open(&path, KIND_RECORDING).ok()?;
        let prefix = "meta/recording.json.";
        let newest = p
            .entries
            .keys()
            .filter_map(|k| k.strip_prefix(prefix).and_then(|n| n.parse::<u64>().ok()))
            .max();
        let key = newest.map_or("recording.json".to_string(), |n| format!("{prefix}{n}"));
        let (o, l) = *p.entries.get(&key)?;
        return Some((path, o, Some(l)));
    }
    if name.contains("..") || name.starts_with('/') {
        return None;
    }
    let (path, entry) = with_open(|m| {
        m.get(id)
            .map(|o| (o.path.clone(), o.entries.get(name).copied()))
    })?;
    let (o, l) = entry?;
    Some((path, o, Some(l)))
}

// ---- recent projects ---------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recent {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
    pub duration_ms: u64,
}

fn recent_file() -> PathBuf {
    crate::store::app_dir().join("recent-projects.json")
}

fn read_recent() -> Vec<Recent> {
    std::fs::read(recent_file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_recent(list: &[Recent]) {
    if let Ok(bytes) = serde_json::to_vec_pretty(list) {
        let _ = std::fs::write(recent_file(), bytes);
    }
}

fn remember(path: &Path, duration_ms: u64) {
    let mut list = read_recent();
    let key = path.to_string_lossy().to_lowercase();
    list.retain(|r| r.path.to_lowercase() != key);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    list.insert(
        0,
        Recent {
            path: path.to_string_lossy().into_owned(),
            name: name_of(path),
            opened_at: now,
            duration_ms,
        },
    );
    list.truncate(12);
    write_recent(&list);
}

/// The recent projects with their card picture (a data URL, read from the file); missing files are marked.
#[tauri::command]
pub async fn project_recent() -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(|| {
        let items: Vec<serde_json::Value> = read_recent()
            .into_iter()
            .map(|r| {
                let exists = Path::new(&r.path).is_file();
                let thumb = exists
                    .then(|| package::open(Path::new(&r.path), KIND_RECORDING).ok())
                    .flatten()
                    .and_then(|p| p.read("thumbnail.png").ok())
                    .map(|b| format!("data:image/png;base64,{}", base64_encode(&b)));
                serde_json::json!({ "path": r.path, "name": r.name, "openedAt": r.opened_at, "durationMs": r.duration_ms, "exists": exists, "thumbnail": thumb })
            })
            .collect();
        serde_json::json!(items)
    })
    .await
    .unwrap_or_else(|_| serde_json::json!([]))
}

fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[tauri::command]
pub fn project_recent_remove(path: String) {
    let key = path.to_lowercase();
    let mut list = read_recent();
    list.retain(|r| r.path.to_lowercase() != key);
    write_recent(&list);
}

// ---- commands ----------------------------------------------------------------------------------------------------------------

/// Open a project file: only its central directory and small items are read. Returns what the page needs to show it. Unsaved edits
/// of an earlier session (a cache folder marked dirty) are kept and reported.
#[tauri::command]
pub async fn project_open(path: String) -> CmdResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<serde_json::Value> {
        let p = Path::new(&path);
        let pkg = package::open(p, KIND_RECORDING)?;
        let id = project_id(p);
        let info: serde_json::Value = serde_json::from_slice(&pkg.meta("recording.json")?).unwrap_or_default();
        // The display name inside the package (renaming does not rename the file); the file's name when there is none.
        let name = info["name"].as_str().filter(|n| !n.trim().is_empty()).map(str::to_string).unwrap_or_else(|| name_of(p));
        with_open(|m| {
            m.insert(id.clone(), Open { path: p.to_path_buf(), name: name.clone(), entries: pkg.entries.clone() });
        });
        let dir = cache_dir(&id);
        let dirty = dir.join("dirty").is_file();
        let shown: serde_json::Value = if dirty {
            std::fs::read(dir.join("recording.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(info.clone())
        } else {
            info.clone()
        };
        remember(p, info["durationMs"].as_u64().unwrap_or(0));
        Ok(serde_json::json!({ "id": id, "name": name, "path": path, "info": shown, "dirty": dirty }))
    })
    .await
    .map_err(|e| CmdError::new("io", e.to_string()))?
    .map_err(|e| CmdError::new("io", e.to_string()))
}

/// Rename a project's display name (inside the package, saved with the next save; the file on disk keeps its name). Returns the name
/// as stored (made safe as a file name: it becomes the default file name of exports).
#[tauri::command]
pub fn project_rename(id: String, name: String) -> CmdResult<String> {
    let clean = crate::recstore::safe_name(name.trim());
    let (dir, _) =
        project_dir(&id).ok_or_else(|| CmdError::new("not_found", "this project is not open"))?;
    let path = dir.join("recording.json");
    let mut doc: serde_json::Value = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    doc["name"] = serde_json::json!(clean);
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&doc).map_err(|e| CmdError::new("io", e.to_string()))?,
    )
    .map_err(|e| CmdError::new("io", e.to_string()))?;
    with_open(|m| {
        if let Some(o) = m.get_mut(&id) {
            o.name = clean.clone();
        }
    });
    mark_dirty(&id);
    Ok(clean)
}

/// Close a project: its cache folder goes, with the unsaved edits when `discard` (else the journal stays for a recovery).
#[tauri::command]
pub fn project_close(id: String, discard: bool) {
    with_open(|m| m.remove(&id));
    if discard || !cache_dir(&id).join("dirty").is_file() {
        let _ = std::fs::remove_dir_all(cache_dir(&id));
    }
}

/// Write the unsaved edits into the project file (a small appended version). The journal is then clean.
#[tauri::command]
pub async fn project_commit(id: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
        let path = with_open(|m| m.get(&id).map(|o| o.path.clone()))
            .ok_or_else(|| std::io::Error::other("the project is not open"))?;
        let dir = cache_dir(&id);
        if dir.join("dirty").is_file() {
            let bytes = std::fs::read(dir.join("recording.json"))?;
            package::append_meta(&path, KIND_RECORDING, &[("recording.json".into(), bytes)])?;
            let _ = std::fs::remove_file(dir.join("dirty"));
            // The open entries moved (a new central directory): read them again.
            let pkg = package::open(&path, KIND_RECORDING)?;
            with_open(|m| {
                if let Some(o) = m.get_mut(&id) {
                    o.entries = pkg.entries;
                }
            });
        }
        Ok(())
    })
    .await
    .map_err(|e| CmdError::new("io", e.to_string()))?
    .map_err(|e| CmdError::new("io", e.to_string()))
}

/// "Save as" for an open project: a compact copy at `to` that has the unsaved edits; the original file is not changed.
#[tauri::command]
pub async fn project_save_copy(id: String, to: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
        let path = with_open(|m| m.get(&id).map(|o| o.path.clone()))
            .ok_or_else(|| std::io::Error::other("the project is not open"))?;
        package::compact(&path, Path::new(&to), KIND_RECORDING)?;
        let dir = cache_dir(&id);
        if dir.join("dirty").is_file() {
            let bytes = std::fs::read(dir.join("recording.json"))?;
            package::append_meta(
                Path::new(&to),
                KIND_RECORDING,
                &[("recording.json".into(), bytes)],
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|e| CmdError::new("io", e.to_string()))?
    .map_err(|e| CmdError::new("io", e.to_string()))
}

/// Projects whose unsaved edits survived a crash: (path) of every cache folder marked dirty.
#[tauri::command]
pub fn project_journal() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(cache_root()) {
        for e in rd.flatten() {
            if e.path().join("dirty").is_file() {
                if let Ok(t) = std::fs::read_to_string(e.path().join("project.txt")) {
                    if Path::new(t.trim()).is_file() {
                        out.push(t.trim().to_string());
                    }
                }
            }
        }
    }
    out
}

/// Mark the journal of a project dirty (written with every change of its effects): `dirty` + the project's path.
pub fn mark_dirty(id: &str) {
    let dir = cache_dir(id);
    let _ = std::fs::create_dir_all(&dir);
    if let Some(path) = with_open(|m| m.get(id).map(|o| o.path.clone())) {
        let _ = std::fs::write(dir.join("project.txt"), path.to_string_lossy().as_bytes());
    }
    let _ = std::fs::write(dir.join("dirty"), b"1");
}

/// The current recording (the one in the temp folder), if there is one: its capture id.
#[tauri::command]
pub fn current_recording(state: tauri::State<'_, crate::commands::AppState>) -> Option<String> {
    state.sessions.lock().unwrap().current_recording_id()
}

/// Delete the current recording from the temp folder.
#[tauri::command]
pub fn discard_current_recording(
    state: tauri::State<'_, crate::commands::AppState>,
) -> CmdResult<()> {
    state
        .sessions
        .lock()
        .unwrap()
        .drop_current_except(None)
        .map_err(CmdError::from)
}

static PENDING_OPEN: Mutex<Option<String>> = Mutex::new(None);
static PENDING_GUIDE: Mutex<Option<String>> = Mutex::new(None);
/// Template files waiting for the person's yes, in the order they came (several can be opened at once).
static PENDING_TEMPLATES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The files of one kind (`.snpr`, …) among the arguments, the program's own name left out.
fn files_given<'a>(args: &'a [String], kind: &'a str) -> impl Iterator<Item = &'a String> {
    args.iter()
        .skip(1)
        .filter(move |a| a.to_lowercase().ends_with(kind) && Path::new(a).is_file())
}

/// A `.snpr` file given on the command line (double-click in Explorer, "Open with Snipmunk"): the page opens it. Also called by the
/// single-instance plugin with the arguments of a second launch.
pub fn handle_args(app: &tauri::AppHandle, args: &[String]) {
    use tauri::Emitter;
    if let Some(path) = files_given(args, ".snpr").next() {
        *PENDING_OPEN.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.clone());
        let _ = app.emit("open-project", path);
    }
    // A guide file opens in Documents mode (the page asks about the guide that is open).
    if let Some(path) = files_given(args, ".snpd").next() {
        *PENDING_GUIDE.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.clone());
        let _ = app.emit("open-guide", path);
    }
    // Template files are imported after a question (the page takes them from the list).
    if queue_templates(args) > 0 {
        let _ = app.emit("open-template", ());
    }
}

/// Put the template files of a command line into the waiting list; returns how many there were.
fn queue_templates(args: &[String]) -> usize {
    let mut waiting = PENDING_TEMPLATES.lock().unwrap_or_else(|e| e.into_inner());
    let before = waiting.len();
    waiting.extend(files_given(args, ".snpt").cloned());
    waiting.len() - before
}

/// The template files that were opened and not yet asked about (each is given once).
#[tauri::command]
pub fn take_pending_templates() -> Vec<String> {
    std::mem::take(&mut *PENDING_TEMPLATES.lock().unwrap_or_else(|e| e.into_inner()))
}

/// The guide file that was asked for before the page was ready (once).
#[tauri::command]
pub fn take_pending_guide() -> Option<String> {
    PENDING_GUIDE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// The project file that was asked for before the page was ready (once).
#[tauri::command]
pub fn take_pending_open() -> Option<String> {
    PENDING_OPEN
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// Does any open project have unsaved edits (a cache folder marked dirty)?
pub fn any_dirty() -> bool {
    let ids: Vec<String> = with_open(|m| m.keys().cloned().collect());
    ids.iter().any(|id| cache_dir(id).join("dirty").is_file())
}

/// Quit, but ask first when something is not saved: the main window comes forward and the page shows one dialog listing it
/// (the page answers with `quit_app` when the person has chosen). Nothing unsaved: Snipmunk quits at once.
pub fn request_quit(app: &tauri::AppHandle) {
    quit_or_ask(app, false);
}

/// Restart Snipmunk (for an update): the same question as Quit comes first when something is not saved.
pub fn request_restart(app: &tauri::AppHandle) {
    quit_or_ask(app, true);
}

/// A restart was asked for and the question is on screen (the answer `quit_app` then restarts instead of exiting).
pub static RESTART: AtomicBool = AtomicBool::new(false);

/// Leave: quit, or restart when one was asked for.
pub fn leave(app: &tauri::AppHandle) {
    crate::lifecycle::quit(app, RESTART.swap(false, Ordering::SeqCst));
}

/// What Snipmunk holds that Quit has to ask about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitState {
    /// A recording is running.
    pub recording: bool,
    /// A scrolling screenshot is running.
    pub scrolling: bool,
    /// An unsaved current recording or an edited project.
    pub unsaved: bool,
    /// The question comes before the restart that installs an update (the page words it that way).
    pub update: bool,
}

/// What Quit does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuitPlan {
    /// Nothing to ask about: leave at once, without showing any window.
    Exit,
    /// Bring the main window to the front (focused) and show the dialog: "Stop and keep the recording?" first when a recording
    /// runs, then the list of what is not saved.
    Ask,
}

pub fn quit_plan(s: QuitState) -> QuitPlan {
    if s.recording || s.scrolling || s.unsaved {
        QuitPlan::Ask
    } else {
        QuitPlan::Exit
    }
}

/// What the close button of the window does, from the setting `close_action`: hide to the tray, quit (asking first when needed), or
/// ask what to do. Anything unknown asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseBehavior {
    Hide,
    Quit,
    Ask,
}

pub fn close_behavior(setting: &str) -> CloseBehavior {
    match setting {
        "background" => CloseBehavior::Hide,
        "quit" => CloseBehavior::Quit,
        _ => CloseBehavior::Ask,
    }
}

fn quit_or_ask(app: &tauri::AppHandle, restart: bool) {
    use tauri::{Emitter, Manager};
    let state = QuitState {
        recording: crate::recording::is_recording(app) || crate::steprec::is_recording(app),
        scrolling: crate::scrollshot::running(),
        unsaved: {
            let s = app.state::<crate::commands::AppState>();
            has_unsaved(&s)
        },
        // (a restart is only ever asked for by the update)
        update: restart,
    };
    RESTART.store(restart, Ordering::SeqCst);
    match quit_plan(state) {
        QuitPlan::Exit => leave(app),
        QuitPlan::Ask => {
            // The window comes forward, focused, and the page shows the dialog (in every mode of the window).
            crate::tray::show_main(app);
            let _ = app.emit("quit-requested", state);
        }
    }
}

/// The person cancelled the question: a pending restart is forgotten.
#[tauri::command]
pub fn cancel_quit() {
    RESTART.store(false, Ordering::SeqCst);
}

/// Does Snipmunk hold anything that is not saved? (An unsaved current recording, unsaved edits of a project, an unsaved guide.) For Quit.
pub fn has_unsaved(state: &crate::commands::AppState) -> bool {
    any_dirty() || state.sessions.lock().unwrap().current_unsaved() || crate::snpd::has_unsaved()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_files_of_a_start_wait_their_turn_and_are_given_once() {
        let dir = crate::testdir::new();
        let file = |name: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, b"x").unwrap();
            path.to_string_lossy().into_owned()
        };
        let (one, two) = (file("A.snpt"), file("B.SNPT"));
        let args = vec![
            "snipmunk.exe".to_string(),
            one.clone(),
            file("C.snpd"),
            "missing.snpt".into(),
            "--hidden".into(),
        ];
        assert_eq!(queue_templates(&args), 1);
        // A second launch while the first file still waits.
        assert_eq!(queue_templates(&["snipmunk.exe".into(), two.clone()]), 1);
        assert_eq!(take_pending_templates(), [one, two]);
        assert!(take_pending_templates().is_empty());
        // The program's own path is never taken for a file to open.
        assert_eq!(queue_templates(std::slice::from_ref(&file("D.snpt"))), 0);
    }

    #[test]
    fn quit_exits_at_once_only_when_nothing_is_running_or_unsaved() {
        assert_eq!(quit_plan(QuitState::default()), QuitPlan::Exit);
        for s in [
            QuitState {
                recording: true,
                ..Default::default()
            },
            QuitState {
                scrolling: true,
                ..Default::default()
            },
            QuitState {
                unsaved: true,
                ..Default::default()
            },
            QuitState {
                recording: true,
                scrolling: true,
                unsaved: true,
                update: true,
            },
        ] {
            assert_eq!(quit_plan(s), QuitPlan::Ask, "{s:?}");
        }
        // An update alone is no reason to ask: with nothing to lose it restarts at once.
        let update = QuitState {
            update: true,
            ..Default::default()
        };
        assert_eq!(quit_plan(update), QuitPlan::Exit);
    }

    #[test]
    fn the_close_button_hides_quits_or_asks_and_an_unknown_setting_asks() {
        assert_eq!(close_behavior("background"), CloseBehavior::Hide);
        assert_eq!(close_behavior("quit"), CloseBehavior::Quit);
        assert_eq!(close_behavior("ask"), CloseBehavior::Ask);
        assert_eq!(close_behavior("something else"), CloseBehavior::Ask);
    }

    #[test]
    fn a_project_has_a_stable_id_and_the_temp_folder_can_be_moved_for_tests() {
        let a = project_id(Path::new("C:\\Videos\\A.snpr"));
        assert_eq!(
            a,
            project_id(Path::new("c:\\videos\\a.snpr")),
            "the case of a Windows path does not matter"
        );
        assert_ne!(a, project_id(Path::new("C:\\Videos\\B.snpr")));
        assert_eq!(as_project("proj:abc"), Some("abc"));
        assert_eq!(as_project("c123"), None);
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
    }

    #[test]
    fn a_project_is_served_by_offset_and_edits_are_kept_in_the_cache_until_committed() {
        let _folders = crate::testdir::product_folders();
        let dir = crate::testdir::new();
        let path = dir.path().join("Demo.snpr");
        package::create(
            &path,
            KIND_RECORDING,
            1,
            &[
                package::Source {
                    name: "screen.mp4".into(),
                    data: package::Data::Bytes(vec![9u8; 5000]),
                },
                package::Source {
                    name: "recording.json".into(),
                    data: package::Data::Bytes(
                        br#"{"durationMs":1000,"effects":{"cursor":{"halo":false}}}"#.to_vec(),
                    ),
                },
            ],
        )
        .unwrap();
        let id = project_id(&path);
        let pkg = package::open(&path, KIND_RECORDING).unwrap();
        with_open(|m| {
            m.insert(
                id.clone(),
                Open {
                    path: path.clone(),
                    name: "Demo".into(),
                    entries: pkg.entries.clone(),
                },
            );
        });
        let (file, offset, len) = entry_range(&id, "screen.mp4").unwrap();
        assert_eq!(len, Some(5000));
        assert_eq!(package::read_range(&file, offset, 4).unwrap(), vec![9u8; 4]);
        assert!(entry_range(&id, "../x").is_none());
        // An edit goes to the cache (journal), not into the project.
        let (cache, name) = project_dir(&id).unwrap();
        assert_eq!(name, "Demo");
        let fx = crate::effects::Effects {
            cursor: crate::effects::CursorFx {
                halo: true,
                ..Default::default()
            },
            ..Default::default()
        };
        crate::effects::store_effects(&cache, fx).unwrap();
        mark_dirty(&id);
        let seen = entry_range(&id, "recording.json").unwrap();
        let text = std::fs::read_to_string(&seen.0).unwrap();
        assert!(
            text.contains("\"halo\": true"),
            "the player sees the edit: {text}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), std::fs::read(&path).unwrap());
        assert!(project_journal().iter().any(|p| p.ends_with("Demo.snpr")));
        // Staging extracts the media; recording.json of the cache stays.
        let staged = stage(&id).unwrap();
        assert_eq!(
            std::fs::read(staged.join("screen.mp4")).unwrap().len(),
            5000
        );
        assert!(std::fs::read_to_string(staged.join("recording.json"))
            .unwrap()
            .contains("\"halo\": true"));
        project_close(id.clone(), true);
        assert!(!cache.exists());
    }
}
