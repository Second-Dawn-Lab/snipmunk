//! Where recordings live: a normal, visible folder (`<recordings folder>\<group>\<recording>\`, by default the Windows Videos
//! folder + `\Snipmunk`). This module has the file-system helpers: Windows-safe names, names that do not clash, moving a folder
//! (also across drives) and the Known Folders. The cards (which recording is in which group) stay in the session file.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// A name that is safe as a Windows file or folder name: no `<>:"/\|?*` or control characters, no trailing dot or space, not a
/// reserved device name, at most 80 characters, never empty.
pub fn safe_name(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(80)
        .collect();
    out = out.trim().trim_end_matches(['.', ' ']).to_string();
    if out.is_empty() {
        return "Recording".to_string();
    }
    let stem = out.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.chars().last().is_some_and(|c| c.is_ascii_digit()));
    if reserved {
        out.insert(0, '_');
    }
    out
}

/// `parent\name`, or `parent\name (2)`, `(3)`, ... when that exists already.
pub fn unique_dir(parent: &Path, name: &str) -> PathBuf {
    let name = safe_name(name);
    let first = parent.join(&name);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| parent.join(format!("{name} ({n})")))
        .find(|p| !p.exists())
        .expect("an endless range")
}

/// Move a folder. A rename when possible; across drives it is copied and the old one deleted afterwards.
pub fn move_dir(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)?;
    fs::remove_dir_all(from)
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Remove a folder when nothing is in it.
pub fn remove_if_empty(dir: &Path) {
    let _ = fs::remove_dir(dir);
}

/// A Windows Known Folder (`Videos`, `Pictures`); `None` when Windows does not tell.
#[cfg(windows)]
fn known_folder(videos: bool) -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{
        FOLDERID_Pictures, FOLDERID_Videos, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
    };
    let id = if videos {
        &FOLDERID_Videos
    } else {
        &FOLDERID_Pictures
    };
    // SAFETY: the returned string is read once and freed with CoTaskMemFree as the API requires.
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s.map(PathBuf::from)
    }
}

#[cfg(not(windows))]
fn known_folder(videos: bool) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(if videos { "Videos" } else { "Pictures" }))
}

/// The default folder of the recordings: the Videos folder + `\Snipmunk`.
pub fn default_recordings_dir() -> PathBuf {
    known_folder(true)
        .unwrap_or_else(std::env::temp_dir)
        .join("Snipmunk")
}

/// The default folder of guides: the Documents folder + `\Snipmunk`.
pub fn default_guides_dir() -> PathBuf {
    #[cfg(windows)]
    let docs = {
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{
            FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
        };
        // SAFETY: the returned string is read once and freed with CoTaskMemFree as the API requires.
        unsafe {
            SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None)
                .ok()
                .and_then(|p| {
                    let s = p.to_string().ok();
                    CoTaskMemFree(Some(p.0 as *const _));
                    s.map(PathBuf::from)
                })
        }
    };
    #[cfg(not(windows))]
    let docs = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Documents"));
    docs.unwrap_or_else(std::env::temp_dir).join("Snipmunk")
}

/// The default folder of the automatically saved screenshots: the Pictures folder + `\Snipmunk`.
pub fn default_pictures_dir() -> PathBuf {
    known_folder(false)
        .unwrap_or_else(std::env::temp_dir)
        .join("Snipmunk")
}

/// "2026-11-19 14-05-33" in local time (for file names).
pub fn local_stamp() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        // SAFETY: GetLocalTime has no preconditions.
        let t = unsafe { GetLocalTime() };
        format!(
            "{:04}-{:02}-{:02} {:02}-{:02}-{:02}",
            t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
        )
    }
    #[cfg(not(windows))]
    {
        "now".to_string()
    }
}

/// The file name (without extension) of an automatically saved screenshot: `naming` is the Save dialog's option, "capture" (its
/// name), "group" (the group's name and the number of the capture in it) or "dateTime" (a word and the date and time).
pub fn screenshot_file_stem(
    naming: &str,
    capture: &str,
    group: &str,
    number: usize,
    word: &str,
    stamp: &str,
) -> String {
    safe_name(&match naming {
        "group" => format!("{group} {number}"),
        "dateTime" => format!("{word} {stamp}"),
        _ => capture.to_string(),
    })
}

/// The folder a setting names, or the default when the setting is empty.
pub fn resolve(setting: &str, default: fn() -> PathBuf) -> PathBuf {
    let s = setting.trim();
    if s.is_empty() {
        default()
    } else {
        PathBuf::from(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe_for_windows() {
        assert_eq!(safe_name("a<b>c:d\"e/f\\g|h?i*j"), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(safe_name("  name. . "), "name");
        assert_eq!(safe_name(""), "Recording");
        assert_eq!(safe_name("..."), "Recording");
        assert_eq!(safe_name("con"), "_con");
        assert_eq!(safe_name("COM1.txt"), "_COM1.txt");
        assert_eq!(safe_name("com10"), "com10");
        assert_eq!(safe_name(&"x".repeat(200)).chars().count(), 80);
        assert_eq!(
            safe_name("Aufnahme 2026-11-19 14-05 ä"),
            "Aufnahme 2026-11-19 14-05 ä"
        );
    }

    #[test]
    fn a_name_that_exists_gets_a_number() {
        let dir = tempfile::tempdir().unwrap();
        let a = unique_dir(dir.path(), "Rec");
        assert_eq!(a, dir.path().join("Rec"));
        fs::create_dir(&a).unwrap();
        let b = unique_dir(dir.path(), "Rec");
        assert_eq!(b, dir.path().join("Rec (2)"));
        fs::create_dir(&b).unwrap();
        assert_eq!(unique_dir(dir.path(), "Rec"), dir.path().join("Rec (3)"));
    }

    #[test]
    fn a_folder_with_subfolders_moves_with_everything_in_it() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a");
        fs::create_dir_all(from.join("sub")).unwrap();
        fs::write(from.join("x.txt"), b"1").unwrap();
        fs::write(from.join("sub").join("y.txt"), b"2").unwrap();
        let to = dir.path().join("new").join("b");
        move_dir(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read(to.join("sub").join("y.txt")).unwrap(), b"2");
        // The copy path used across drives gives the same result.
        let again = dir.path().join("c");
        copy_dir(&to, &again).unwrap();
        assert_eq!(fs::read(again.join("x.txt")).unwrap(), b"1");
    }

    #[test]
    fn automatic_screenshot_names_follow_the_save_dialog_options() {
        let f = |n| {
            screenshot_file_stem(
                n,
                "Chrome: tab",
                "Group 1",
                3,
                "Screenshot",
                "2026-11-19 14-05-33",
            )
        };
        assert_eq!(f("capture"), "Chrome_ tab");
        assert_eq!(f("group"), "Group 1 3");
        assert_eq!(f("dateTime"), "Screenshot 2026-11-19 14-05-33");
    }

    #[test]
    fn the_known_folders_are_found_and_a_setting_wins_over_the_default() {
        assert!(default_recordings_dir().ends_with("Snipmunk"));
        assert!(default_pictures_dir().ends_with("Snipmunk"));
        assert_eq!(
            resolve("D:\\Rec", default_recordings_dir),
            PathBuf::from("D:\\Rec")
        );
        assert_eq!(
            resolve("  ", default_recordings_dir),
            default_recordings_dir()
        );
    }
}
