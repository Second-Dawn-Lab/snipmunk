//! Looking for a newer Snipmunk and installing it. This is the only network access in Snipmunk: a plain download of
//! `latest.json` from the latest GitHub release (see docs/releasing.md and PRIVACY.md), and of the installer when the
//! user chooses "Update and restart". Nothing about the user or their files is sent.
//!
//! The check runs quietly after a start, at most once a day (a setting switches it off), and from Settings → About.
//! "Update and restart" downloads the installer, then goes the ordinary restart way: unsaved work is asked about first,
//! and Cancel puts the update off. The Microsoft Store build (cargo feature `store`) has no updater: the Store updates it.
//!
//! A test instance never asks the network; `SNIPMUNK_FAKE_UPDATE=<version>` gives it a pretended update.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::commands::AppState;
use crate::error::CmdResult;

/// The quiet check runs at most this often.
pub const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;
/// How long after a start the quiet check waits, so it takes nothing from the start itself.
const QUIET_DELAY: Duration = Duration::from_secs(8);
/// A check that gets no answer gives up.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// What the pages show about updates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Checking,
    UpToDate,
    /// The server could not be reached.
    Offline,
    /// The server answered, but there is no release (yet) or no usable `latest.json`.
    NoRelease,
    Available {
        version: String,
    },
    Downloading {
        version: String,
        /// `None` while the size is not known.
        percent: Option<u8>,
    },
    /// Downloaded and verified: it is installed by the next restart that is asked for.
    Ready {
        version: String,
    },
    /// The download (or its signature check) failed.
    Failed {
        version: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    /// `false` in the Store build: there is nothing to check or install here.
    pub supported: bool,
    pub phase: Phase,
}

/// What a check found.
enum Found {
    Release(Box<Update>),
    /// A test instance's pretended update.
    Pretend(String),
}

impl Found {
    fn version(&self) -> String {
        match self {
            Found::Release(u) => u.version.clone(),
            Found::Pretend(v) => v.clone(),
        }
    }
}

struct Inner {
    phase: Phase,
    found: Option<Found>,
    /// The downloaded installer, verified.
    installer: Option<Vec<u8>>,
}

pub struct Updates(Mutex<Inner>);

impl Default for Updates {
    fn default() -> Self {
        Self(Mutex::new(Inner {
            phase: Phase::Idle,
            found: None,
            installer: None,
        }))
    }
}

/// Does this build update itself?
pub fn supported() -> bool {
    !cfg!(feature = "store")
}

/// Is a quiet check due? `last` is the Unix time of the previous one (0 = never). A clock that went backwards counts as
/// due, so a wrong clock cannot block checks forever.
pub fn check_due(last: u64, now: u64) -> bool {
    last == 0 || now < last || now - last >= CHECK_INTERVAL_SECS
}

/// Tell "I can't reach the server" apart from "the server has nothing for me".
fn failed_check(error: &tauri_plugin_updater::Error) -> Phase {
    use tauri_plugin_updater::Error;
    match error {
        Error::ReleaseNotFound
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_)
        | Error::Serialization(_)
        | Error::Semver(_) => Phase::NoRelease,
        _ => Phase::Offline,
    }
}

/// How much of the download is there, in whole percent.
pub fn percent(done: u64, total: Option<u64>) -> Option<u8> {
    total
        .filter(|t| *t > 0)
        .map(|t| (done.min(t) * 100 / t) as u8)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn lock(updates: &Updates) -> std::sync::MutexGuard<'_, Inner> {
    updates.0.lock().unwrap_or_else(|e| e.into_inner())
}

fn view(app: &AppHandle) -> UpdateView {
    UpdateView {
        supported: supported(),
        phase: lock(&app.state::<Updates>()).phase.clone(),
    }
}

fn set_phase(app: &AppHandle, phase: Phase) {
    lock(&app.state::<Updates>()).phase = phase;
    let _ = app.emit("update-state", view(app));
}

/// Remember that a check was made (also one that failed: an offline computer is not asked again at every start).
fn remember_check(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap();
    settings.last_update_check = now_secs();
    if let Err(e) = settings.save() {
        eprintln!("the time of the update check could not be saved: {e}");
    }
}

/// Ask for a newer version. A `quiet` check shows nothing unless there is one.
async fn check(app: &AppHandle, quiet: bool) {
    if !supported() {
        return;
    }
    {
        let updates = app.state::<Updates>();
        let inner = lock(&updates);
        // A check or a download that runs, and a downloaded update, are left alone.
        if matches!(
            inner.phase,
            Phase::Checking | Phase::Downloading { .. } | Phase::Ready { .. }
        ) {
            return;
        }
    }
    if !quiet {
        set_phase(app, Phase::Checking);
    }
    remember_check(app);
    let result: Result<Option<Found>, Phase> = if crate::capture::guard_active() {
        match std::env::var("SNIPMUNK_FAKE_UPDATE") {
            Ok(v) if !v.is_empty() => Ok(Some(Found::Pretend(v))),
            _ => Err(Phase::Offline),
        }
    } else {
        match app.updater_builder().timeout(CHECK_TIMEOUT).build() {
            Ok(updater) => match updater.check().await {
                Ok(update) => Ok(update.map(|u| Found::Release(Box::new(u)))),
                Err(e) => {
                    eprintln!("update check: {e}");
                    Err(failed_check(&e))
                }
            },
            Err(e) => {
                eprintln!("update check: {e}");
                Err(failed_check(&e))
            }
        }
    };
    match result {
        Ok(Some(found)) => {
            let version = found.version();
            lock(&app.state::<Updates>()).found = Some(found);
            set_phase(app, Phase::Available { version });
        }
        Ok(None) if !quiet => set_phase(app, Phase::UpToDate),
        Err(phase) if !quiet => set_phase(app, phase),
        _ => {}
    }
}

/// The quiet check of a start, when it is switched on and due. Development builds only check when asked.
pub fn check_after_start(app: &AppHandle) {
    if !supported() || cfg!(debug_assertions) || crate::capture::guard_active() {
        return;
    }
    let due = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        settings.auto_update_check && check_due(settings.last_update_check, now_secs())
    };
    if !due {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(QUIET_DELAY)).await;
        if !crate::lifecycle::quitting() {
            check(&app, true).await;
        }
    });
}

#[tauri::command]
pub fn update_state(app: AppHandle) -> UpdateView {
    view(&app)
}

/// "Check for updates".
#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateView {
    check(&app, false).await;
    view(&app)
}

/// Download the update that was found and verify it. `None`: nothing is waiting.
async fn download(app: &AppHandle) -> Option<()> {
    let (update, version) = {
        let updates = app.state::<Updates>();
        let inner = lock(&updates);
        if matches!(inner.phase, Phase::Downloading { .. }) {
            return None;
        }
        match inner.found.as_ref()? {
            Found::Release(u) => (Some(u.clone()), u.version.clone()),
            Found::Pretend(v) => (None, v.clone()),
        }
    };
    set_phase(
        app,
        Phase::Downloading {
            version: version.clone(),
            percent: None,
        },
    );
    let report = |shown: &mut Option<u8>, now: Option<u8>| {
        // (the pages are told once per percent, not once per piece)
        if now != *shown {
            *shown = now;
            set_phase(
                app,
                Phase::Downloading {
                    version: version.clone(),
                    percent: now,
                },
            );
        }
    };
    let mut shown = None;
    let bytes = match update {
        Some(update) => {
            let mut done = 0u64;
            update
                .download(
                    |chunk, total| {
                        done += chunk as u64;
                        report(&mut shown, percent(done, total));
                    },
                    || {},
                )
                .await
        }
        None => {
            for step in 1..=20u64 {
                let _ = tauri::async_runtime::spawn_blocking(|| {
                    std::thread::sleep(Duration::from_millis(100))
                })
                .await;
                report(&mut shown, percent(step, Some(20)));
            }
            Ok(Vec::new())
        }
    };
    match bytes {
        Ok(bytes) => {
            lock(&app.state::<Updates>()).installer = Some(bytes);
            set_phase(app, Phase::Ready { version });
            Some(())
        }
        Err(e) => {
            eprintln!("the update could not be downloaded: {e}");
            set_phase(app, Phase::Failed { version });
            None
        }
    }
}

/// "Update and restart": download (once), then restart the ordinary way, which asks about unsaved work first.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> CmdResult<()> {
    if !supported() {
        return Ok(());
    }
    let ready = lock(&app.state::<Updates>()).installer.is_some();
    if ready || download(&app).await.is_some() {
        crate::projects::request_restart(&app);
    }
    Ok(())
}

// --- the restart that installs ------------------------------------------------

/// A file that makes the next start show the window, whatever the command line says: the installer starts the program
/// again with the old one, which may be the quiet start of "Start with Windows".
const SHOW_MARKER: &str = "show-after-update";

fn marker_in(dir: &Path) -> PathBuf {
    dir.join(SHOW_MARKER)
}

/// Was this start made by an update? (Asked once: the marker goes.)
pub fn started_by_update_in(dir: &Path) -> bool {
    std::fs::remove_file(marker_in(dir)).is_ok()
}

pub fn started_by_update() -> bool {
    started_by_update_in(&crate::store::app_dir())
}

/// Is a downloaded update waiting for the restart?
pub fn waiting(app: &AppHandle) -> bool {
    lock(&app.state::<Updates>()).installer.is_some()
}

/// Run the downloaded installer. On success the process ends here (the installer starts the new version). Returns only
/// when it could not be started, or in a test instance, which installs nothing.
pub fn install(app: &AppHandle) {
    if crate::capture::guard_active() {
        eprintln!("[test] an update would be installed now (the test guard)");
        return;
    }
    let updates = app.state::<Updates>();
    let inner = lock(&updates);
    if let (Some(Found::Release(update)), Some(bytes)) =
        (inner.found.as_ref(), inner.installer.as_ref())
    {
        let dir = crate::store::app_dir();
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker_in(&dir), b"1");
        if let Err(e) = update.install(bytes) {
            eprintln!("the update could not be installed: {e}");
            let _ = std::fs::remove_file(marker_in(&dir));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = CHECK_INTERVAL_SECS;

    #[test]
    fn the_quiet_check_runs_at_most_once_a_day() {
        assert!(check_due(0, 1_000_000), "the first start checks");
        let last = 1_000_000;
        assert!(!check_due(last, last));
        assert!(!check_due(last, last + DAY - 1));
        assert!(check_due(last, last + DAY));
        assert!(check_due(2_000_000, 1_000_000), "a clock set back");
    }

    #[test]
    fn progress_is_in_whole_percent_and_unknown_without_a_size() {
        assert_eq!(percent(0, Some(200)), Some(0));
        assert_eq!(percent(100, Some(200)), Some(50));
        assert_eq!(percent(500, Some(200)), Some(100));
        assert_eq!(percent(5, None), None);
        assert_eq!(percent(5, Some(0)), None);
    }

    #[test]
    fn a_missing_release_is_not_called_offline() {
        use tauri_plugin_updater::Error;
        assert_eq!(failed_check(&Error::ReleaseNotFound), Phase::NoRelease);
        assert_eq!(
            failed_check(&Error::TargetNotFound("windows-x86_64".into())),
            Phase::NoRelease
        );
        assert_eq!(
            failed_check(&Error::Network("timed out".into())),
            Phase::Offline
        );
    }

    #[test]
    fn the_start_after_an_update_is_known_once() {
        let dir = crate::testdir::new();
        assert!(!started_by_update_in(dir.path()));
        std::fs::write(marker_in(dir.path()), b"1").unwrap();
        assert!(started_by_update_in(dir.path()));
        assert!(!started_by_update_in(dir.path()));
    }

    #[test]
    fn the_pages_get_the_phase_with_its_kind() {
        let json = serde_json::to_value(Phase::Downloading {
            version: "0.1.1".into(),
            percent: Some(40),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "downloading", "version": "0.1.1", "percent": 40 })
        );
        assert_eq!(
            serde_json::to_value(Phase::UpToDate).unwrap()["kind"],
            "upToDate"
        );
    }
}
