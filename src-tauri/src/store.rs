//! What differs when Snipmunk is installed as a package (MSIX, the Microsoft Store build, cargo feature `store`).
//! See docs/store.md.
//!
//! * Windows redirects what a packaged program writes below `%AppData%` and (most likely) `%TEMP%` into a place of the
//!   package that other programs do not see. Snipmunk hands files to other programs (drag out, the clipboard, "Show in
//!   Explorer", exports), so the Store build keeps its data in the package's own folders, which are ordinary folders:
//!   `LocalState` and `TempState`.
//! * "Start with Windows" is the package's start-up task (declared in the manifest, off at first), not a registry entry.
//! * The application id comes from the package; the program sets none.
//! * No updater: the Store updates the app.

use std::path::PathBuf;
use std::sync::OnceLock;

/// The task id in `msix/AppxManifest.xml`.
#[cfg(any(feature = "store", test))]
pub const STARTUP_TASK: &str = "SnipmunkStartup";

/// The package's data and temp folders, once `use_package_folders` found them.
static FOLDERS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();

/// Does this process run from an installed package?
#[cfg(windows)]
pub fn packaged() -> bool {
    use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    let mut length = 0u32;
    // SAFETY: with no buffer the call only says how long the name would be, or that there is no package.
    let answer = unsafe { GetCurrentPackageFullName(&mut length, None) };
    answer != APPMODEL_ERROR_NO_PACKAGE
}

#[cfg(not(windows))]
pub fn packaged() -> bool {
    false
}

/// In the packaged Store build: keep data and temporary files in the package's folders. Call before anything is read.
pub fn use_package_folders() {
    #[cfg(all(windows, feature = "store"))]
    if packaged() {
        use windows::Storage::ApplicationData;
        let folders = || -> windows::core::Result<(PathBuf, PathBuf)> {
            let data = ApplicationData::Current()?;
            Ok((
                PathBuf::from(data.LocalFolder()?.Path()?.to_os_string()),
                PathBuf::from(data.TemporaryFolder()?.Path()?.to_os_string()),
            ))
        };
        match folders() {
            Ok(f) => {
                let _ = FOLDERS.set(f);
            }
            Err(e) => eprintln!("the package's folders could not be found: {e}"),
        }
    }
}

/// Where Snipmunk keeps its settings, sessions, templates and guides.
pub fn app_dir() -> PathBuf {
    match FOLDERS.get() {
        Some((data, _)) => data.join("SecondDawn").join("snipmunk"),
        None => dawn_core::app_dir("snipmunk"),
    }
}

/// The folder temporary files go below.
pub fn temp_root() -> PathBuf {
    FOLDERS
        .get()
        .map(|(_, temp)| temp.clone())
        .unwrap_or_else(std::env::temp_dir)
}

/// Switch the package's start-up task on or off. Returns whether it is on afterwards: Windows does not let a program
/// switch on a task the user switched off in Task Manager or Settings (or an organization forbids).
#[cfg(all(windows, feature = "store"))]
pub fn set_start_with_windows(wanted: bool) -> windows::core::Result<bool> {
    use windows::core::HSTRING;
    use windows::ApplicationModel::{StartupTask, StartupTaskState};
    let task = StartupTask::GetAsync(&HSTRING::from(STARTUP_TASK))?.get()?;
    let mut state = task.State()?;
    if wanted && state == StartupTaskState::Disabled {
        state = task.RequestEnableAsync()?.get()?;
    } else if !wanted && state == StartupTaskState::Enabled {
        task.Disable()?;
        state = task.State()?;
    }
    Ok(state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_that_is_not_installed_as_a_package_uses_the_ordinary_folders() {
        assert!(!packaged());
        use_package_folders();
        assert_eq!(app_dir(), dawn_core::app_dir("snipmunk"));
        assert_eq!(temp_root(), std::env::temp_dir());
    }

    #[test]
    fn the_manifest_declares_the_start_up_task_the_program_asks_for() {
        let manifest = include_str!("../msix/AppxManifest.xml");
        assert!(manifest.contains(&format!("TaskId=\"{STARTUP_TASK}\"")));
        // Off at first, and the quiet start.
        assert!(manifest.contains("Enabled=\"false\""));
        assert!(manifest.contains(&format!(
            "uap10:Parameters=\"{}\"",
            crate::startup::HIDDEN_FLAG
        )));
        for kind in [".snpr", ".snpd", ".snpt"] {
            assert!(
                manifest.contains(&format!("<uap:FileType>{kind}</uap:FileType>")),
                "{kind}"
            );
        }
        for capability in ["runFullTrust", "microphone", "webcam"] {
            assert!(manifest.contains(&format!("Name=\"{capability}\"")));
        }
    }
}
