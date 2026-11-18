//! The session: groups of screenshots, kept on disk automatically.
//!
//! `%AppData%\SecondDawn\snipmunk\sessions\<sessionId>\` holds `session.json` (the groups and the order of their
//! captures) and `images\<captureId>.png`. Every change is written to disk before the call returns, so closing the
//! app, a crash or a Windows restart never loses a capture. Only the newest session is "current"; older ones stay
//! on disk until the retention setting removes them.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::CmdError;

const SESSION_FILE: &str = "session.json";
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Capture {
    pub id: String,
    pub name: String,
    /// Unix time in milliseconds.
    pub created_at: u64,
    /// The image, relative to the session folder (`images/<id>.png`).
    pub file: String,
    /// A small preview for the capture list (`thumbs/<id>.png`); `None` for captures without one.
    pub thumbnail: Option<String>,
    pub width: u32,
    pub height: u32,
    /// The title of the window that was captured, when known.
    pub source_window_title: Option<String>,
    /// Placeholder for the annotation tools (Phase 5): a JSON array of marks, `null` until then.
    pub annotations: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Group {
    pub id: String,
    pub name: String,
    /// Position of the group tab, 0 first.
    pub order: u32,
    /// In the user's custom order.
    pub captures: Vec<Capture>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub groups: Vec<Group>,
    next_capture_number: u32,
    next_group_number: u32,
}

#[derive(Debug)]
pub enum StoreError {
    NotFound(String),
    Invalid(String),
    Io(io::Error),
}

impl From<io::Error> for StoreError {
    fn from(e: io::Error) -> Self {
        StoreError::Io(e)
    }
}

impl From<StoreError> for CmdError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::NotFound(m) => CmdError::new("not_found", m),
            StoreError::Invalid(m) => CmdError::new("invalid", m),
            StoreError::Io(e) => CmdError::new("io", e),
        }
    }
}

type StoreResult<T> = Result<T, StoreError>;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A new id that is safe as a file name: time in hex plus a counter, so it is unique across runs and within one.
fn new_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}{:x}{:03x}", now_ms(), n & 0xfff)
}

/// Ids are used in file names and URLs: letters, digits, `-` and `_` only.
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A path inside a session folder given by the web page (`images/<id>.png`): no way out of the folder.
pub fn is_safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
        && !path.contains(':')
}

impl Session {
    fn new() -> Self {
        let now = now_ms();
        let mut s = Session {
            id: new_id("s"),
            created_at: now,
            updated_at: now,
            ..Session::default()
        };
        s.push_group(None);
        s
    }

    fn push_group(&mut self, name: Option<String>) -> String {
        self.next_group_number += 1;
        let name = name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("Group {}", self.next_group_number));
        let id = new_id("g");
        let order = self.groups.len() as u32;
        self.groups.push(Group {
            id: id.clone(),
            name,
            order,
            captures: Vec::new(),
        });
        id
    }

    fn group_mut(&mut self, id: &str) -> StoreResult<&mut Group> {
        self.groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| StoreError::NotFound(format!("group {id}")))
    }

    fn find_capture(&self, id: &str) -> Option<(usize, usize)> {
        self.groups.iter().enumerate().find_map(|(gi, g)| {
            g.captures
                .iter()
                .position(|c| c.id == id)
                .map(|ci| (gi, ci))
        })
    }

    fn renumber_groups(&mut self) {
        for (i, g) in self.groups.iter_mut().enumerate() {
            g.order = i as u32;
        }
    }

    #[cfg(test)]
    pub fn capture_count(&self) -> usize {
        self.groups.iter().map(|g| g.captures.len()).sum()
    }
}

fn clean_name(name: &str) -> StoreResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(StoreError::Invalid("the name is empty".into()));
    }
    Ok(name.chars().take(80).collect())
}

pub struct SessionStore {
    root: PathBuf,
    session: Session,
}

impl SessionStore {
    /// `%AppData%\SecondDawn\snipmunk\sessions`
    pub fn default_root() -> PathBuf {
        dawn_core::app_dir("snipmunk").join("sessions")
    }

    /// Open the newest kept session, or start a new one when there is none.
    pub fn open(root: PathBuf) -> Self {
        let session = Self::list(&root)
            .into_iter()
            .max_by_key(|s| s.updated_at)
            .unwrap_or_else(Session::new);
        let store = Self { root, session };
        // A brand new session is written at once, so it exists on disk before the first capture.
        if !store.session_dir().join(SESSION_FILE).exists() {
            let _ = store.write(&store.session.clone());
        }
        store
    }

    /// All sessions on disk that can be read. Folders without a valid `session.json` are ignored (and kept).
    fn list(root: &Path) -> Vec<Session> {
        let Ok(entries) = fs::read_dir(root) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| {
                let bytes = fs::read(e.path().join(SESSION_FILE)).ok()?;
                let s: Session = serde_json::from_slice(&bytes).ok()?;
                let folder = e.file_name().to_string_lossy().to_string();
                // The folder name is the id; a mismatch means a copied or edited folder we do not trust.
                (is_safe_id(&s.id) && s.id == folder && !s.groups.is_empty()).then_some(s)
            })
            .collect()
    }

    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn session_dir(&self) -> PathBuf {
        self.root.join(&self.session.id)
    }

    fn write(&self, session: &Session) -> StoreResult<()> {
        dawn_core::write_json(&self.root.join(&session.id).join(SESSION_FILE), session)?;
        Ok(())
    }

    /// Apply a change to a copy, write it to disk, and only then make it current.
    fn change<R>(&mut self, f: impl FnOnce(&mut Session) -> StoreResult<R>) -> StoreResult<R> {
        let mut next = self.session.clone();
        let result = f(&mut next)?;
        next.updated_at = now_ms().max(self.session.updated_at);
        self.write(&next)?;
        self.session = next;
        Ok(result)
    }

    /// Start a new, empty session. The previous one stays on disk (until retention removes it), unless
    /// `discard_previous` is set.
    pub fn new_session(&mut self, discard_previous: bool) -> StoreResult<()> {
        let fresh = Session::new();
        self.write(&fresh)?;
        let old = std::mem::replace(&mut self.session, fresh);
        if discard_previous {
            let _ = fs::remove_dir_all(self.root.join(&old.id));
        }
        Ok(())
    }

    /// Delete the current session from disk (clear on exit). The store must not be used for changes afterwards.
    pub fn delete_current(&mut self) {
        let _ = fs::remove_dir_all(self.session_dir());
    }

    /// Delete sessions other than the current one whose last change is older than `days` days (0 = keep all).
    /// Returns how many were deleted.
    pub fn cleanup(&self, days: u32, now: u64) -> usize {
        if days == 0 {
            return 0;
        }
        let limit = u64::from(days) * DAY_MS;
        let mut removed = 0;
        for s in Self::list(&self.root) {
            if s.id != self.session.id
                && now.saturating_sub(s.updated_at) > limit
                && fs::remove_dir_all(self.root.join(&s.id)).is_ok()
            {
                removed += 1;
            }
        }
        removed
    }

    // --- groups ----------------------------------------------------------------

    pub fn create_group(&mut self, name: Option<String>) -> StoreResult<String> {
        self.change(|s| Ok(s.push_group(name)))
    }

    pub fn rename_group(&mut self, id: &str, name: &str) -> StoreResult<()> {
        let name = clean_name(name)?;
        self.change(|s| {
            s.group_mut(id)?.name = name;
            Ok(())
        })
    }

    /// Delete a group and the files of its captures. The last group cannot be deleted.
    pub fn delete_group(&mut self, id: &str) -> StoreResult<()> {
        let files = self.change(|s| {
            if s.groups.len() <= 1 {
                return Err(StoreError::Invalid(
                    "the last group cannot be deleted".into(),
                ));
            }
            let index = s
                .groups
                .iter()
                .position(|g| g.id == id)
                .ok_or_else(|| StoreError::NotFound(format!("group {id}")))?;
            let group = s.groups.remove(index);
            s.renumber_groups();
            Ok(group
                .captures
                .into_iter()
                .flat_map(|c| [Some(c.file), c.thumbnail])
                .flatten()
                .collect::<Vec<_>>())
        })?;
        for file in files {
            self.remove_file(&file);
        }
        Ok(())
    }

    // --- captures --------------------------------------------------------------

    /// Add a screenshot (PNG bytes, and a small PNG thumbnail) to the end of a group. The files are written before the
    /// session file mentions them.
    #[allow(clippy::too_many_arguments)]
    pub fn add_capture(
        &mut self,
        group_id: &str,
        name: Option<String>,
        png: &[u8],
        thumb: Option<&[u8]>,
        width: u32,
        height: u32,
        source_window_title: Option<String>,
    ) -> StoreResult<Capture> {
        if !self.session.groups.iter().any(|g| g.id == group_id) {
            return Err(StoreError::NotFound(format!("group {group_id}")));
        }
        let id = new_id("c");
        let file = format!("images/{id}.png");
        let path = self.session_dir().join(&file);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        // The image is on disk before the session file mentions it.
        fs::write(&path, png)?;
        // A thumbnail that cannot be written is not worth losing the capture: the list falls back to the image.
        let thumb_file = thumb.and_then(|bytes| {
            let rel = format!("thumbs/{id}.png");
            let thumb_path = self.session_dir().join(&rel);
            let written = thumb_path
                .parent()
                .map(fs::create_dir_all)
                .transpose()
                .and_then(|_| fs::write(&thumb_path, bytes));
            if written.is_err() {
                let _ = fs::remove_file(&thumb_path);
            }
            written.is_ok().then_some(rel)
        });
        let result = self.change(|s| {
            s.next_capture_number += 1;
            let name = match name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
                Some(n) => n,
                None => format!("Capture {}", s.next_capture_number),
            };
            let capture = Capture {
                id: id.clone(),
                name,
                created_at: now_ms(),
                file: file.clone(),
                thumbnail: thumb_file.clone(),
                width,
                height,
                source_window_title,
                annotations: Value::Null,
            };
            s.group_mut(group_id)?.captures.push(capture.clone());
            Ok(capture)
        });
        if result.is_err() {
            let _ = fs::remove_file(path);
            if let Some(rel) = &thumb_file {
                self.remove_file(rel);
            }
        }
        result
    }

    pub fn rename_capture(&mut self, id: &str, name: &str) -> StoreResult<()> {
        let name = clean_name(name)?;
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            s.groups[g].captures[c].name = name;
            Ok(())
        })
    }

    pub fn delete_capture(&mut self, id: &str) -> StoreResult<()> {
        let removed = self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            let c = s.groups[g].captures.remove(c);
            Ok((c.file, c.thumbnail))
        })?;
        self.remove_file(&removed.0);
        if let Some(t) = &removed.1 {
            self.remove_file(t);
        }
        Ok(())
    }

    /// Put the captures of a group in a new order. `ids` must be exactly the group's captures.
    pub fn reorder_captures(&mut self, group_id: &str, ids: &[String]) -> StoreResult<()> {
        self.change(|s| {
            let group = s.group_mut(group_id)?;
            let mut rest = std::mem::take(&mut group.captures);
            let mut ordered = Vec::with_capacity(rest.len());
            for id in ids {
                match rest.iter().position(|c| &c.id == id) {
                    Some(i) => ordered.push(rest.remove(i)),
                    None => {
                        group.captures = ordered.into_iter().chain(rest).collect();
                        return Err(StoreError::Invalid(format!(
                            "{id} is not a capture of this group, or is listed twice"
                        )));
                    }
                }
            }
            if !rest.is_empty() {
                group.captures = ordered.into_iter().chain(rest).collect();
                return Err(StoreError::Invalid(
                    "the list does not contain every capture of the group".into(),
                ));
            }
            group.captures = ordered;
            Ok(())
        })
    }

    /// Move a capture to another group (or within its group), to `index` (the end when `None`).
    pub fn move_capture_to_group(
        &mut self,
        capture_id: &str,
        group_id: &str,
        index: Option<usize>,
    ) -> StoreResult<()> {
        self.change(|s| {
            if !s.groups.iter().any(|g| g.id == group_id) {
                return Err(StoreError::NotFound(format!("group {group_id}")));
            }
            let (g, c) = s
                .find_capture(capture_id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {capture_id}")))?;
            let capture = s.groups[g].captures.remove(c);
            let target = s.group_mut(group_id)?;
            let at = index
                .unwrap_or(target.captures.len())
                .min(target.captures.len());
            target.captures.insert(at, capture);
            Ok(())
        })
    }

    fn remove_file(&self, relative: &str) {
        if is_safe_relative(relative) {
            let _ = fs::remove_file(self.session_dir().join(relative));
        }
    }

    /// The bytes of a session image for the `snipmunk-img` scheme. `session_id` and `file` come from the web page.
    pub fn read_image(&self, session_id: &str, file: &str) -> Option<Vec<u8>> {
        if !is_safe_id(session_id)
            || !is_safe_relative(file)
            || !(file.starts_with("images/") || file.starts_with("thumbs/"))
        {
            return None;
        }
        fs::read(self.root.join(session_id).join(file)).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, SessionStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::open(dir.path().join("sessions"));
        (dir, store)
    }

    fn add(store: &mut SessionStore, group: &str, name: &str) -> Capture {
        store
            .add_capture(group, Some(name.into()), b"png", None, 10, 20, None)
            .unwrap()
    }

    fn names(store: &SessionStore, group: usize) -> Vec<String> {
        store.session().groups[group]
            .captures
            .iter()
            .map(|c| c.name.clone())
            .collect()
    }

    #[test]
    fn a_new_store_has_one_group_on_disk() {
        let (_d, store) = store();
        assert_eq!(store.session().groups.len(), 1);
        assert_eq!(store.session().groups[0].name, "Group 1");
        assert!(store.session_dir().join("session.json").exists());
    }

    #[test]
    fn everything_survives_a_restart() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = add(&mut store, &g, "first");
        store.create_group(Some("Docs".into())).unwrap();
        let before = store.session().clone();
        drop(store);

        let again = SessionStore::open(dir.path().join("sessions"));
        assert_eq!(again.session(), &before);
        assert_eq!(fs::read(again.session_dir().join(&c.file)).unwrap(), b"png");
    }

    #[test]
    fn a_thumbnail_is_kept_next_to_the_image_and_removed_with_it() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = store
            .add_capture(&g, None, b"img", Some(b"thumb"), 4, 4, None)
            .unwrap();
        let rel = c.thumbnail.clone().unwrap();
        assert_eq!(rel, format!("thumbs/{}.png", c.id));
        let sid = store.session().id.clone();
        assert_eq!(store.read_image(&sid, &rel).unwrap(), b"thumb");
        assert_eq!(store.read_image(&sid, &c.file).unwrap(), b"img");
        store.delete_capture(&c.id).unwrap();
        assert!(store.read_image(&sid, &rel).is_none());
        assert!(store.read_image(&sid, &c.file).is_none());
    }

    #[test]
    fn captures_are_numbered_and_the_names_can_be_given() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = store.add_capture(&g, None, b"x", None, 1, 1, None).unwrap();
        let b = store
            .add_capture(&g, None, b"x", None, 1, 1, Some("Notepad".into()))
            .unwrap();
        assert_eq!(
            (a.name.as_str(), b.name.as_str()),
            ("Capture 1", "Capture 2")
        );
        assert_eq!(b.source_window_title.as_deref(), Some("Notepad"));
        store.delete_capture(&a.id).unwrap();
        let c = store.add_capture(&g, None, b"x", None, 1, 1, None).unwrap();
        assert_eq!(c.name, "Capture 3", "numbers are not reused");
    }

    #[test]
    fn groups_are_created_renamed_and_deleted_with_their_files() {
        let (_d, mut store) = store();
        let g1 = store.session().groups[0].id.clone();
        let g2 = store.create_group(None).unwrap();
        assert_eq!(store.session().groups[1].name, "Group 2");
        store.rename_group(&g2, "  Bug report ").unwrap();
        assert_eq!(store.session().groups[1].name, "Bug report");
        assert!(store.rename_group(&g2, "   ").is_err());

        let c = add(&mut store, &g2, "shot");
        let file = store.session_dir().join(&c.file);
        assert!(file.exists());
        store.delete_group(&g2).unwrap();
        assert!(!file.exists());
        assert_eq!(store.session().groups.len(), 1);
        assert!(store.delete_group(&g1).is_err(), "the last group stays");
    }

    #[test]
    fn group_order_is_renumbered_after_a_delete() {
        let (_d, mut store) = store();
        let a = store.create_group(None).unwrap();
        store.create_group(None).unwrap();
        store.delete_group(&a).unwrap();
        let orders: Vec<u32> = store.session().groups.iter().map(|g| g.order).collect();
        assert_eq!(orders, vec![0, 1]);
    }

    #[test]
    fn a_capture_is_renamed_and_deleted_with_its_file() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = add(&mut store, &g, "old");
        store.rename_capture(&c.id, "new").unwrap();
        assert_eq!(names(&store, 0), ["new"]);
        let file = store.session_dir().join(&c.file);
        store.delete_capture(&c.id).unwrap();
        assert!(!file.exists());
        assert!(names(&store, 0).is_empty());
        assert!(matches!(
            store.delete_capture(&c.id),
            Err(StoreError::NotFound(_))
        ));
    }

    #[test]
    fn captures_are_reordered_only_with_a_complete_list() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = add(&mut store, &g, "a");
        let b = add(&mut store, &g, "b");
        let c = add(&mut store, &g, "c");
        store
            .reorder_captures(&g, &[c.id.clone(), a.id.clone(), b.id.clone()])
            .unwrap();
        assert_eq!(names(&store, 0), ["c", "a", "b"]);

        assert!(store
            .reorder_captures(&g, std::slice::from_ref(&a.id))
            .is_err());
        assert!(store
            .reorder_captures(&g, &[a.id.clone(), a.id.clone(), b.id.clone()])
            .is_err());
        assert!(store
            .reorder_captures(&g, &["nope".into(), a.id.clone(), b.id.clone()])
            .is_err());
        assert_eq!(
            names(&store, 0),
            ["c", "a", "b"],
            "a bad list changes nothing"
        );
    }

    #[test]
    fn a_capture_moves_to_another_group_at_a_position() {
        let (_d, mut store) = store();
        let g1 = store.session().groups[0].id.clone();
        let g2 = store.create_group(None).unwrap();
        let a = add(&mut store, &g1, "a");
        add(&mut store, &g2, "x");
        add(&mut store, &g2, "y");
        store.move_capture_to_group(&a.id, &g2, Some(1)).unwrap();
        assert!(names(&store, 0).is_empty());
        assert_eq!(names(&store, 1), ["x", "a", "y"]);
        store.move_capture_to_group(&a.id, &g2, None).unwrap();
        assert_eq!(names(&store, 1), ["x", "y", "a"]);
        store.move_capture_to_group(&a.id, &g1, Some(99)).unwrap();
        assert_eq!(names(&store, 0), ["a"]);
        assert!(store.move_capture_to_group(&a.id, "nope", None).is_err());
        assert_eq!(names(&store, 0), ["a"], "a failed move changes nothing");
    }

    #[test]
    fn a_new_session_keeps_or_discards_the_old_one() {
        let (dir, mut store) = store();
        let root = dir.path().join("sessions");
        let g = store.session().groups[0].id.clone();
        add(&mut store, &g, "a");
        let first = store.session().id.clone();

        store.new_session(false).unwrap();
        assert_ne!(store.session().id, first);
        assert_eq!(store.session().capture_count(), 0);
        assert!(root.join(&first).exists());

        let second = store.session().id.clone();
        store.new_session(true).unwrap();
        assert!(!root.join(&second).exists());
        assert!(root.join(&first).exists());
    }

    #[test]
    fn the_newest_session_is_reopened() {
        let (dir, mut store) = store();
        let root = dir.path().join("sessions");
        store.new_session(false).unwrap();
        let g = store.session().groups[0].id.clone();
        add(&mut store, &g, "in the second");
        let second = store.session().id.clone();
        drop(store);
        assert_eq!(SessionStore::open(root).session().id, second);
    }

    #[test]
    fn retention_removes_old_sessions_but_never_the_current_one() {
        let (dir, mut store) = store();
        let root = dir.path().join("sessions");
        let old = store.session().id.clone();
        store.new_session(false).unwrap();
        let current = store.session().id.clone();

        // Nothing is old yet.
        assert_eq!(store.cleanup(30, now_ms()), 0);
        // 31 days later the old one goes, the current one stays however old it is.
        assert_eq!(store.cleanup(30, now_ms() + 31 * DAY_MS), 1);
        assert!(!root.join(&old).exists());
        assert!(root.join(&current).exists());
        // 0 = keep forever.
        store.new_session(false).unwrap();
        assert_eq!(store.cleanup(0, now_ms() + 3650 * DAY_MS), 0);
        assert!(root.join(&current).exists());
    }

    #[test]
    fn clear_on_exit_deletes_the_session_folder() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        add(&mut store, &g, "a");
        let dir = store.session_dir();
        store.delete_current();
        assert!(!dir.exists());
    }

    #[test]
    fn broken_or_foreign_folders_are_ignored_and_kept() {
        let (dir, store) = store();
        let root = dir.path().join("sessions");
        drop(store);
        fs::create_dir_all(root.join("junk")).unwrap();
        fs::write(root.join("junk").join("session.json"), "{ not json").unwrap();
        fs::create_dir_all(root.join("other")).unwrap();
        fs::write(
            root.join("other").join("session.json"),
            r#"{"id":"someone-else","groups":[{"id":"g","name":"G"}]}"#,
        )
        .unwrap();
        let store = SessionStore::open(root.clone());
        assert!(is_safe_id(&store.session().id));
        assert!(root.join("junk").exists() && root.join("other").exists());
        assert_eq!(store.cleanup(1, now_ms() + 100 * DAY_MS), 0);
    }

    #[test]
    fn image_paths_from_the_page_cannot_leave_the_session_folder() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = add(&mut store, &g, "a");
        let sid = store.session().id.clone();
        assert_eq!(store.read_image(&sid, &c.file).unwrap(), b"png");
        for bad in [
            "../session.json",
            "images/../session.json",
            "session.json",
            "images\\x.png",
            "C:/Windows/win.ini",
            "/etc/passwd",
            "",
        ] {
            assert!(store.read_image(&sid, bad).is_none(), "{bad}");
        }
        assert!(store.read_image("..", &c.file).is_none());
        assert!(store.read_image("a/b", &c.file).is_none());
    }

    #[test]
    fn ids_are_unique_and_safe() {
        let a = new_id("c");
        let b = new_id("c");
        assert_ne!(a, b);
        assert!(is_safe_id(&a));
        assert!(!is_safe_id("a/b") && !is_safe_id("") && !is_safe_id("a.b"));
    }

    #[test]
    fn json_uses_camel_case() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        add(&mut store, &g, "a");
        let v = serde_json::to_value(store.session()).unwrap();
        assert!(v.get("createdAt").is_some() && v.get("groups").is_some());
        let c = &v["groups"][0]["captures"][0];
        for key in [
            "id",
            "name",
            "createdAt",
            "file",
            "width",
            "height",
            "sourceWindowTitle",
            "annotations",
        ] {
            assert!(c.get(key).is_some(), "{key}");
        }
    }
}
