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

/// The colours a group tab can have (the page draws each one for the light and the dark theme).
pub const GROUP_COLORS: [&str; 9] = [
    "red", "orange", "amber", "yellow", "green", "teal", "blue", "purple", "pink",
];
/// The emoji a group tab can show before its name.
pub const GROUP_EMOJIS: [&str; 12] = [
    "📁", "⭐", "🔥", "✅", "🐞", "💡", "📄", "🎨", "📌", "🧪", "🗂️", "💬",
];
/// The most JSON the annotations of one capture may take.
const MAX_ANNOTATIONS_BYTES: usize = 8 * 1024 * 1024;
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
    /// The width limit the thumbnail was made for (0 = made by an earlier version, upgraded in the background).
    pub thumb_size: u32,
    /// Counts the times the thumbnail was replaced (an edit of the annotations), so the page loads the new picture.
    pub thumb_rev: u32,
    pub width: u32,
    pub height: u32,
    /// The title of the window that was captured, when known.
    pub source_window_title: Option<String>,
    /// "screenshot" (taken by Snipmunk) or "imported" (dropped in); `None` in sessions of earlier versions.
    pub source: Option<String>,
    /// Placeholder for the annotation tools (Phase 5): a JSON array of marks, `null` until then.
    pub annotations: Value,
    /// "image" (also `None` in sessions of earlier versions) or "video" (a screen recording, see `recording.rs`).
    pub kind: Option<String>,
    /// The length of a recording in milliseconds.
    pub duration_ms: u64,
    /// The screen video of a recording, relative to the session folder (`recordings/<id>/screen.mp4`).
    pub video_file: Option<String>,
    /// The folder of a recording (an absolute path, `<recordings folder>\<group>\<recording>`); `video_file` is then the name of
    /// the video in it. `None` in sessions of earlier versions (their recordings are moved there once).
    pub video_dir: Option<String>,
    /// The file a screenshot was saved to automatically (the setting "Save each screenshot automatically"), if any.
    pub saved_path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Group {
    pub id: String,
    pub name: String,
    /// Position of the group tab, 0 first.
    pub order: u32,
    /// One of `GROUP_COLORS`, or none.
    pub color: Option<String>,
    /// One of `GROUP_EMOJIS`, or none.
    pub emoji: Option<String>,
    /// In the user's custom order.
    pub captures: Vec<Capture>,
    /// "recording" for a group of screen recordings; `None` (also in sessions of earlier versions) for screenshots. The two
    /// kinds of groups are independent: each has its own tabs, names and "last group" rule.
    pub kind: Option<String>,
}

impl Group {
    pub fn is_recording(&self) -> bool {
        self.kind.as_deref() == Some("recording")
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub groups: Vec<Group>,
    next_capture_number: u32,
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
    fn new(lang: &str) -> Self {
        Self::named(None, lang)
    }

    /// A new session whose first group has the given name (the page passes it in the user's language).
    fn named(first_group: Option<String>, lang: &str) -> Self {
        let now = now_ms();
        let mut s = Session {
            id: new_id("s"),
            created_at: now,
            updated_at: now,
            ..Session::default()
        };
        s.push_group(first_group, lang);
        s
    }

    fn push_group(&mut self, name: Option<String>, lang: &str) -> String {
        self.push_group_of(name, lang, false)
    }

    /// A new group of the screenshot kind or (`recording`) of the recording kind. Default names count per kind.
    fn push_group_of(&mut self, name: Option<String>, lang: &str, recording: bool) -> String {
        let same: Vec<Group> = self
            .groups
            .iter()
            .filter(|g| g.is_recording() == recording)
            .cloned()
            .collect();
        let name = name
            .map(|n| n.trim().chars().take(80).collect::<String>())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| default_group_name(lang, lowest_free_group_number(&same)));
        let id = new_id("g");
        let order = self.groups.len() as u32;
        self.groups.push(Group {
            id: id.clone(),
            name,
            order,
            color: None,
            emoji: None,
            captures: Vec::new(),
            kind: recording.then(|| "recording".to_string()),
        });
        id
    }

    /// Screenshots are one list without groups: every screenshot group is merged into the first one (all captures sorted by the time
    /// they were taken, oldest first). The group engine stays in the data model (the documents mode reuses it); the screenshot
    /// list simply never has more than one group. Returns whether anything changed.
    pub fn merge_image_groups(&mut self) -> bool {
        let image: Vec<usize> = self
            .groups
            .iter()
            .enumerate()
            .filter(|(_, g)| !g.is_recording())
            .map(|(i, _)| i)
            .collect();
        if image.len() < 2 {
            return false;
        }
        let first = image[0];
        let mut all: Vec<Capture> = Vec::new();
        for &i in &image {
            all.extend(std::mem::take(&mut self.groups[i].captures));
        }
        all.sort_by_key(|c| c.created_at);
        self.groups[first].captures = all;
        let keep: std::collections::HashSet<usize> = std::iter::once(first)
            .chain(
                self.groups
                    .iter()
                    .enumerate()
                    .filter(|(_, g)| g.is_recording())
                    .map(|(i, _)| i),
            )
            .collect();
        let mut i = 0;
        self.groups.retain(|_| {
            let k = keep.contains(&i);
            i += 1;
            k
        });
        true
    }

    /// Recordings that sit in a screenshot group (sessions of the first recorder versions) move into the first recording group,
    /// which is made when there is none. Returns whether anything changed.
    fn migrate_videos(&mut self, lang: &str) -> bool {
        let stray = self.groups.iter().any(|g| {
            !g.is_recording()
                && g.captures
                    .iter()
                    .any(|c| c.kind.as_deref() == Some("video"))
        });
        if !stray {
            return false;
        }
        let target = match self.groups.iter().position(|g| g.is_recording()) {
            Some(i) => i,
            None => {
                self.push_group_of(None, lang, true);
                self.groups.len() - 1
            }
        };
        let mut moved = Vec::new();
        for g in self.groups.iter_mut().filter(|g| !g.is_recording()) {
            let (videos, rest): (Vec<Capture>, Vec<Capture>) = std::mem::take(&mut g.captures)
                .into_iter()
                .partition(|c| c.kind.as_deref() == Some("video"));
            g.captures = rest;
            moved.extend(videos);
        }
        self.groups[target].captures.extend(moved);
        true
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

/// "Group {number}" in each interface language (the page's `groups.defaultName`; a test compares the two).
pub const GROUP_NAME_TEMPLATES: [(&str, &str); 12] = [
    ("en", "Group {number}"),
    ("de", "Gruppe {number}"),
    ("es", "Grupo {number}"),
    ("fr", "Groupe {number}"),
    ("it", "Gruppo {number}"),
    ("nl", "Groep {number}"),
    ("pl", "Grupa {number}"),
    ("tr", "Grup {number}"),
    ("zh-Hans", "分组 {number}"),
    ("zh-Hant", "群組 {number}"),
    ("ar", "المجموعة {number}"),
    ("ur", "گروپ {number}"),
];

/// The default name of group `n` in a language (English for an unknown one).
pub fn default_group_name(lang: &str, n: u32) -> String {
    let template = GROUP_NAME_TEMPLATES
        .iter()
        .find(|(l, _)| *l == lang)
        .map_or(GROUP_NAME_TEMPLATES[0].1, |(_, t)| t);
    template.replace("{number}", &n.to_string())
}

/// The number of a group that still has its default name ("Group 3", "Gruppe 3", ... in any language), else `None`.
/// Renamed groups have no number.
fn default_group_number(name: &str) -> Option<u32> {
    GROUP_NAME_TEMPLATES.iter().find_map(|(_, template)| {
        let (before, after) = template.split_once("{number}")?;
        let digits = name.strip_prefix(before)?.strip_suffix(after)?;
        if digits.is_empty()
            || !digits.bytes().all(|b| b.is_ascii_digit())
            || digits.starts_with('0')
        {
            return None;
        }
        digits.parse().ok()
    })
}

/// The lowest N for which no group is called "Group N". Groups with other names do not count.
pub fn lowest_free_group_number(groups: &[Group]) -> u32 {
    let used: std::collections::HashSet<u32> = groups
        .iter()
        .filter_map(|g| default_group_number(&g.name))
        .collect();
    (1..).find(|n| !used.contains(n)).unwrap_or(1)
}

/// Does this session hold recordings (cards of recording groups)?
fn theirs_is_empty(s: &Session) -> bool {
    !s.groups
        .iter()
        .any(|g| g.is_recording() && !g.captures.is_empty())
}

fn clean_name(name: &str) -> StoreResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(StoreError::Invalid("the name is empty".into()));
    }
    Ok(name.chars().take(80).collect())
}

/// What `SessionStore::add_capture_with` needs to add a capture.
pub struct NewCapture<'a> {
    pub name: Option<String>,
    pub png: &'a [u8],
    pub thumb: Option<&'a [u8]>,
    /// The width limit the thumbnail was made for.
    pub thumb_size: u32,
    pub width: u32,
    pub height: u32,
    pub source_window_title: Option<String>,
    /// "screenshot" or "imported"
    pub source: &'static str,
}

pub struct SessionStore {
    root: PathBuf,
    session: Session,
    /// The interface language: names the groups the store makes itself.
    lang: String,
    /// The folder that holds the recordings (see `recstore`).
    rec_root: PathBuf,
}

impl SessionStore {
    /// The folder of the sessions.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `%AppData%\SecondDawn\snipmunk\sessions`
    pub fn default_root() -> PathBuf {
        crate::store::app_dir().join("sessions")
    }

    /// Open the newest kept session, or start a new one when there is none.
    #[cfg(test)]
    pub fn open(root: PathBuf) -> Self {
        Self::open_in(root, "en")
    }

    /// Like `open`, with the interface language that names the first group of a new session.
    pub fn open_in(root: PathBuf, lang: &str) -> Self {
        let mut session = Self::list(&root)
            .into_iter()
            .max_by_key(|s| s.updated_at)
            .unwrap_or_else(|| Session::new(lang));
        let migrated = session.migrate_videos(lang) | session.merge_image_groups();
        let rec_root = root.with_file_name("recordings");
        let store = Self {
            root,
            session,
            lang: lang.to_string(),
            rec_root,
        };
        // A brand new session is written at once, so it exists on disk before the first capture.
        if migrated || !store.session_dir().join(SESSION_FILE).exists() {
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

    /// The interface language changed.
    pub fn set_language(&mut self, lang: &str) {
        self.lang = lang.to_string();
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
    pub fn new_session(
        &mut self,
        discard_previous: bool,
        group_name: Option<String>,
    ) -> StoreResult<()> {
        let fresh = Session::named(group_name, &self.lang);
        self.write(&fresh)?;
        let old = std::mem::replace(&mut self.session, fresh);
        // Recordings are never deleted by a new session: their groups come along.
        self.absorb_recordings(old, discard_previous);
        Ok(())
    }

    /// The folder that holds the recordings.
    pub fn recordings_root(&self) -> &Path {
        &self.rec_root
    }

    pub fn set_recordings_root(&mut self, root: PathBuf) {
        self.rec_root = root;
    }

    /// The groups of recordings of another session (`old`) move into this one (a group of the same name takes the cards), so a
    /// new session, the retention setting and clear-on-exit never take a recording. With `discard_old` the old session folder is
    /// deleted afterwards, otherwise only its recording groups are taken out of it.
    fn absorb_recordings(&mut self, mut old: Session, discard_old: bool) {
        let old_dir = self.root.join(&old.id);
        let theirs: Vec<Group> = old
            .groups
            .iter()
            .filter(|g| g.is_recording() && !g.captures.is_empty())
            .cloned()
            .collect();
        if !theirs.is_empty() {
            let dir = self.session_dir();
            for c in theirs.iter().flat_map(|g| &g.captures) {
                for f in std::iter::once(&c.file).chain(c.thumbnail.iter()) {
                    if is_safe_relative(f) {
                        let to = dir.join(f);
                        if let Some(p) = to.parent() {
                            let _ = fs::create_dir_all(p);
                        }
                        let _ = fs::copy(old_dir.join(f), to);
                    }
                }
                // A recording of an earlier version lives in its session folder: it moves along (migrated later).
                if c.video_dir.is_none() {
                    if let Some(parent) =
                        c.video_file.as_deref().and_then(|v| Path::new(v).parent())
                    {
                        if is_safe_relative(&parent.to_string_lossy()) {
                            let _ =
                                crate::recstore::move_dir(&old_dir.join(parent), &dir.join(parent));
                        }
                    }
                }
            }
            let lang = self.lang.clone();
            let _ = self.change(|s| {
                for g in theirs {
                    let index = match s
                        .groups
                        .iter()
                        .position(|x| x.is_recording() && x.name == g.name)
                    {
                        Some(i) => i,
                        None => {
                            let id = s.push_group_of(Some(g.name.clone()), &lang, true);
                            s.groups.iter().position(|x| x.id == id).unwrap_or(0)
                        }
                    };
                    let group = &mut s.groups[index];
                    for c in g.captures {
                        if !group.captures.iter().any(|x| x.id == c.id) {
                            group.captures.push(c);
                        }
                    }
                }
                Ok(())
            });
        }
        if discard_old {
            let _ = fs::remove_dir_all(&old_dir);
        } else if !theirs_is_empty(&old) {
            old.groups.retain(|g| !g.is_recording());
            if old.groups.is_empty() {
                let _ = fs::remove_dir_all(&old_dir);
            } else {
                let _ = self.write(&old);
            }
        }
    }

    /// Sessions other than the current one that still hold recordings (an earlier version kept them per session): their
    /// recordings move into the current session.
    pub fn absorb_all_recordings(&mut self) {
        let current = self.session.id.clone();
        for s in Self::list(&self.root) {
            if s.id != current && !theirs_is_empty(&s) {
                self.absorb_recordings(s, false);
            }
        }
    }

    /// Delete the current session from disk (clear on exit). The store must not be used for changes afterwards.
    pub fn delete_current(&mut self) {
        if !theirs_is_empty(&self.session) {
            // Recordings stay: only the screenshots are deleted with the session.
            let dir = self.session_dir();
            let mut kept = self.session.clone();
            for g in kept.groups.iter().filter(|g| !g.is_recording()) {
                for c in &g.captures {
                    for f in std::iter::once(&c.file).chain(c.thumbnail.iter()) {
                        if is_safe_relative(f) {
                            let _ = fs::remove_file(dir.join(f));
                        }
                    }
                }
            }
            kept.groups.retain(|g| g.is_recording());
            kept.renumber_groups();
            let _ = self.write(&kept);
            return;
        }
        let _ = fs::remove_dir_all(self.session_dir());
    }

    /// Delete sessions other than the current one whose last change is older than `days` days (0 = keep all).
    /// Returns how many were deleted.
    pub fn cleanup(&mut self, days: u32, now: u64) -> usize {
        if days == 0 {
            return 0;
        }
        let limit = u64::from(days) * DAY_MS;
        let mut removed = 0;
        for s in Self::list(&self.root) {
            if s.id != self.session.id && now.saturating_sub(s.updated_at) > limit {
                let id = s.id.clone();
                // Recordings are never deleted by the retention setting.
                self.absorb_recordings(s, false);
                if fs::remove_dir_all(self.root.join(&id)).is_ok() {
                    removed += 1;
                }
            }
        }
        removed
    }

    // --- groups ----------------------------------------------------------------

    pub fn create_group(&mut self, name: Option<String>) -> StoreResult<String> {
        self.create_group_of(name, false)
    }

    /// A group of screenshots, or (`recording`) of recordings.
    pub fn create_group_of(
        &mut self,
        name: Option<String>,
        recording: bool,
    ) -> StoreResult<String> {
        let lang = self.lang.clone();
        self.change(|s| Ok(s.push_group_of(name, &lang, recording)))
    }

    /// The id of the first group of recordings, made when the session has none.
    pub fn ensure_recording_group(&mut self) -> StoreResult<String> {
        if let Some(g) = self.session.groups.iter().find(|g| g.is_recording()) {
            return Ok(g.id.clone());
        }
        self.create_group_of(None, true)
    }

    pub fn rename_group(&mut self, id: &str, name: &str) -> StoreResult<()> {
        let name = clean_name(name)?;
        self.change(|s| {
            s.group_mut(id)?.name = name;
            Ok(())
        })?;
        // The folder of the group follows its name.
        self.relocate_recordings(id);
        Ok(())
    }

    /// Put the recording folders of a group where its name says (`<recordings folder><group><recording>`), after a rename or
    /// when recordings were moved into it. A folder that cannot be moved stays where it is: the card keeps working.
    fn relocate_recordings(&mut self, group_id: &str) {
        let ids: Vec<String> = self
            .session
            .groups
            .iter()
            .filter(|g| g.id == group_id && g.is_recording())
            .flat_map(|g| g.captures.iter().map(|c| c.id.clone()))
            .collect();
        for id in ids {
            self.relocate_capture(&id);
        }
    }

    /// The recordings that are not where the recordings folder and their group say (the folder setting changed, or a group was
    /// renamed while a folder could not be moved).
    pub fn recordings_to_move(&self) -> Vec<String> {
        let mut v = Vec::new();
        for g in self.session.groups.iter().filter(|g| g.is_recording()) {
            let parent = self.rec_root.join(crate::recstore::safe_name(&g.name));
            for c in &g.captures {
                if let Some(d) = c.video_dir.as_deref().map(PathBuf::from) {
                    if d.parent() != Some(parent.as_path()) && d.exists() {
                        v.push(c.id.clone());
                    }
                }
            }
        }
        v
    }

    /// Move the folder of one recording to where its group says. True when it moved.
    pub fn relocate_capture(&mut self, id: &str) -> bool {
        let Some((g, c)) = self.session.find_capture(id) else {
            return false;
        };
        let group = &self.session.groups[g];
        if !group.is_recording() {
            return false;
        }
        let Some(dir) = group.captures[c].video_dir.as_deref().map(PathBuf::from) else {
            return false;
        };
        let target_parent = self.rec_root.join(crate::recstore::safe_name(&group.name));
        if dir.parent() == Some(target_parent.as_path()) || !dir.exists() {
            return false;
        }
        let leaf = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let to = crate::recstore::unique_dir(&target_parent, &leaf);
        if crate::recstore::move_dir(&dir, &to).is_err() {
            return false;
        }
        let to_s = to.to_string_lossy().into_owned();
        let _ = self.change(|s| {
            if let Some((g, c)) = s.find_capture(id) {
                s.groups[g].captures[c].video_dir = Some(to_s);
            }
            Ok(())
        });
        if let Some(p) = dir.parent() {
            crate::recstore::remove_if_empty(p);
        }
        true
    }

    /// Recordings of an earlier version (in their session folder) move into the recordings folder, once. Returns how many.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn migrate_recordings(&mut self) -> usize {
        let dir = self.session_dir();
        let mut done: Vec<(String, String)> = Vec::new();
        for g in self.session.groups.iter().filter(|g| g.is_recording()) {
            let parent = self.rec_root.join(crate::recstore::safe_name(&g.name));
            for c in &g.captures {
                let (None, Some(v)) = (&c.video_dir, &c.video_file) else {
                    continue;
                };
                let Some(from) = Path::new(v)
                    .parent()
                    .filter(|p| is_safe_relative(&p.to_string_lossy()))
                    .map(|p| dir.join(p))
                else {
                    continue;
                };
                if !from.exists() {
                    continue;
                }
                let to = crate::recstore::unique_dir(&parent, &c.name);
                if crate::recstore::move_dir(&from, &to).is_ok() {
                    done.push((c.id.clone(), to.to_string_lossy().into_owned()));
                }
            }
        }
        let n = done.len();
        if n > 0 {
            let _ = self.change(|s| {
                for (id, to) in &done {
                    if let Some((g, c)) = s.find_capture(id) {
                        let cap = &mut s.groups[g].captures[c];
                        cap.video_dir = Some(to.clone());
                        cap.video_file = Some("screen.mp4".into());
                    }
                }
                Ok(())
            });
        }
        n
    }

    /// Cards of recordings whose files were deleted or moved away (in Explorer) are removed. Returns how many.
    pub fn prune_missing_recordings(&mut self) -> usize {
        let dir = self.session_dir();
        let gone: Vec<String> = self
            .session
            .groups
            .iter()
            .flat_map(|g| &g.captures)
            .filter(|c| c.video_file.is_some())
            .filter(|c| match (&c.video_dir, &c.video_file) {
                (Some(d), Some(f)) => !Path::new(d).join(f).exists(),
                (None, Some(f)) => !dir.join(f).exists(),
                _ => false,
            })
            .map(|c| c.id.clone())
            .collect();
        for id in &gone {
            // The recording folder is already gone: only the card and its pictures are removed.
            let _ = self.change(|s| {
                if let Some((g, c)) = s.find_capture(id) {
                    let cap = s.groups[g].captures.remove(c);
                    for f in std::iter::once(&cap.file).chain(cap.thumbnail.iter()) {
                        if is_safe_relative(f) {
                            let _ = fs::remove_file(dir.join(f));
                        }
                    }
                }
                Ok(())
            });
        }
        gone.len()
    }

    /// The folder of a recording.
    /// What "Show in File Explorer" shows, worked out now from the current state (never from a path remembered by the page): for a
    /// recording its video (or, when that is gone, its folder); for a screenshot the file it was saved to automatically.
    /// `None` when there is nothing to show.
    pub fn explorer_path(&self, capture_id: &str) -> Option<PathBuf> {
        let (g, c) = self.session.find_capture(capture_id)?;
        let cap = &self.session.groups[g].captures[c];
        if cap.kind.as_deref() == Some("video") {
            let dir = self.recording_dir(capture_id)?;
            let video = cap
                .video_file
                .as_deref()
                .and_then(|f| Path::new(f).file_name())
                .map(|n| dir.join(n))
                .unwrap_or_else(|| dir.join("screen.mp4"));
            if video.is_file() {
                return Some(video);
            }
            return dir.is_dir().then_some(dir);
        }
        let saved = PathBuf::from(cap.saved_path.as_deref()?);
        saved.is_file().then_some(saved)
    }

    /// The name of the rendered video of a recording: its name, made safe for a file name, + ".mp4" ("Recording 2026-11-20 13-47.mp4").
    pub fn recording_file_name(&self, capture_id: &str) -> String {
        let name = self
            .session
            .find_capture(capture_id)
            .map(|(g, c)| self.session.groups[g].captures[c].name.clone())
            .unwrap_or_default();
        let safe = crate::recstore::safe_name(&name);
        format!("{}.mp4", if safe.is_empty() { "Recording" } else { &safe })
    }

    pub fn recording_dir(&self, capture_id: &str) -> Option<PathBuf> {
        let (g, c) = self.session.find_capture(capture_id)?;
        let cap = &self.session.groups[g].captures[c];
        match (&cap.video_dir, &cap.video_file) {
            (Some(d), _) => Some(PathBuf::from(d)),
            (None, Some(f)) => Path::new(f).parent().map(|p| self.session_dir().join(p)),
            _ => None,
        }
    }

    /// The capture of the current recording: the newest recording whose folder is in the current-recording folder (recordings of
    /// earlier layouts elsewhere are not shown).
    pub fn current_recording_id(&self) -> Option<String> {
        self.session
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .filter(|c| {
                c.kind.as_deref() == Some("video")
                    && c.video_dir
                        .as_deref()
                        .is_some_and(|d| Path::new(d).starts_with(&self.rec_root))
            })
            .max_by_key(|c| c.created_at)
            .map(|c| c.id.clone())
    }

    /// Has the current recording not been saved as a project?
    pub fn current_unsaved(&self) -> bool {
        self.current_recording_id().is_some_and(|id| {
            self.session
                .find_capture(&id)
                .is_some_and(|(g, c)| self.session.groups[g].captures[c].saved_path.is_none())
        })
    }

    /// Delete the recordings of the current-recording folder except `keep` (a new recording replaces the old one).
    pub fn drop_current_except(&mut self, keep: Option<&str>) -> StoreResult<()> {
        let ids: Vec<String> = self
            .session
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .filter(|c| {
                Some(c.id.as_str()) != keep
                    && c.video_dir
                        .as_deref()
                        .is_some_and(|d| Path::new(d).starts_with(&self.rec_root))
            })
            .map(|c| c.id.clone())
            .collect();
        for id in ids {
            self.delete_capture(&id)?;
        }
        Ok(())
    }

    /// A new folder for a recording that starts now, in the group `group_id`: `<recordings folder>\<group>\<name>` (not created).
    pub fn new_recording_dir(&self, group_id: &str, name: &str) -> StoreResult<PathBuf> {
        let g = self
            .session
            .groups
            .iter()
            .find(|g| g.id == group_id && g.is_recording())
            .ok_or_else(|| StoreError::NotFound(format!("group {group_id}")))?;
        Ok(crate::recstore::unique_dir(
            &self.rec_root.join(crate::recstore::safe_name(&g.name)),
            name,
        ))
    }

    /// Delete a group. Its captures are moved to the end of `move_to`, or deleted with their files when that is `None`.
    /// The last group cannot be deleted.
    pub fn delete_group(&mut self, id: &str, move_to: Option<&str>) -> StoreResult<()> {
        let rec_root = self.rec_root.clone();
        let files = self.change(|s| {
            // The last group of a kind stays (screenshots and recordings count separately).
            let recording = s
                .groups
                .iter()
                .find(|g| g.id == id)
                .map(|g| g.is_recording());
            if let Some(r) = recording {
                if s.groups.iter().filter(|g| g.is_recording() == r).count() <= 1 {
                    return Err(StoreError::Invalid(
                        "the last group cannot be deleted".into(),
                    ));
                }
            }
            let index = s
                .groups
                .iter()
                .position(|g| g.id == id)
                .ok_or_else(|| StoreError::NotFound(format!("group {id}")))?;
            if let Some(target) = move_to {
                if target == id || !s.groups.iter().any(|g| g.id == target) {
                    return Err(StoreError::Invalid(format!(
                        "{target} cannot receive the captures"
                    )));
                }
            }
            let group = s.groups.remove(index);
            s.renumber_groups();
            match move_to {
                Some(target) => {
                    s.group_mut(target)?.captures.extend(group.captures);
                    Ok(Vec::new())
                }
                None => {
                    // The folders of its recordings are deleted with it.
                    for c in &group.captures {
                        if let Some(d) = &c.video_dir {
                            let _ = fs::remove_dir_all(d);
                        }
                    }
                    if group.is_recording() {
                        crate::recstore::remove_if_empty(
                            &rec_root.join(crate::recstore::safe_name(&group.name)),
                        );
                    }
                    Ok(group
                        .captures
                        .into_iter()
                        .flat_map(|c| [Some(c.file), c.thumbnail])
                        .flatten()
                        .collect::<Vec<_>>())
                }
            }
        })?;
        if let Some(t) = move_to {
            self.relocate_recordings(t);
        }
        for file in files {
            self.remove_file(&file);
            // thumbs/<id>.png and images/<id>.png: the recognized text of that capture goes too.
            if let Some(id) = file
                .strip_prefix("images/")
                .and_then(|f| f.strip_suffix(".png"))
            {
                self.remove_ocr(id);
            }
        }
        Ok(())
    }

    /// Put the group tabs in a new order. `ids` must be exactly the session's groups.
    pub fn reorder_groups(&mut self, ids: &[String]) -> StoreResult<()> {
        self.change(|s| {
            let mut rest = std::mem::take(&mut s.groups);
            let mut ordered = Vec::with_capacity(rest.len());
            for id in ids {
                match rest.iter().position(|g| &g.id == id) {
                    Some(i) => ordered.push(rest.remove(i)),
                    None => {
                        s.groups = ordered.into_iter().chain(rest).collect();
                        return Err(StoreError::Invalid(format!(
                            "{id} is not a group of this session, or is listed twice"
                        )));
                    }
                }
            }
            if !rest.is_empty() {
                s.groups = ordered.into_iter().chain(rest).collect();
                return Err(StoreError::Invalid(
                    "the list does not contain every group".into(),
                ));
            }
            s.groups = ordered;
            s.renumber_groups();
            Ok(())
        })
    }

    /// The colour of a group tab (one of `GROUP_COLORS`), or `None` for no colour.
    pub fn set_group_color(&mut self, id: &str, color: Option<&str>) -> StoreResult<()> {
        if let Some(c) = color {
            if !GROUP_COLORS.contains(&c) {
                return Err(StoreError::Invalid(format!("{c} is not a group colour")));
            }
        }
        self.change(|s| {
            s.group_mut(id)?.color = color.map(str::to_string);
            Ok(())
        })
    }

    /// The emoji before a group's name (one of `GROUP_EMOJIS`), or `None` for no emoji.
    pub fn set_group_emoji(&mut self, id: &str, emoji: Option<&str>) -> StoreResult<()> {
        if let Some(e) = emoji {
            if !GROUP_EMOJIS.contains(&e) {
                return Err(StoreError::Invalid(format!("{e} is not a group emoji")));
            }
        }
        self.change(|s| {
            s.group_mut(id)?.emoji = emoji.map(str::to_string);
            Ok(())
        })
    }

    // --- captures --------------------------------------------------------------

    /// Add a screenshot (PNG bytes, and a thumbnail PNG) to the end of a group. The files are written before the
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
        self.add_capture_with(
            group_id,
            NewCapture {
                name,
                png,
                thumb,
                thumb_size: if thumb.is_some() {
                    crate::thumbs::THUMB_MAX.0
                } else {
                    0
                },
                width,
                height,
                source_window_title,
                source: "screenshot",
            },
        )
    }

    /// Add a capture to the end of a group (see `add_capture`).
    pub fn add_capture_with(&mut self, group_id: &str, new: NewCapture) -> StoreResult<Capture> {
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
        fs::write(&path, new.png)?;
        // A thumbnail that cannot be written is not worth losing the capture: the list falls back to the image.
        let thumb_file = new.thumb.and_then(|bytes| {
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
            let name = match new
                .name
                .clone()
                .map(|n| n.trim().chars().take(80).collect::<String>())
                .filter(|n| !n.is_empty())
            {
                Some(n) => n,
                None => format!("Capture {}", s.next_capture_number),
            };
            let capture = Capture {
                id: id.clone(),
                name,
                created_at: now_ms(),
                file: file.clone(),
                thumb_size: if thumb_file.is_some() {
                    new.thumb_size
                } else {
                    0
                },
                thumbnail: thumb_file.clone(),
                thumb_rev: 0,
                width: new.width,
                height: new.height,
                source_window_title: new.source_window_title.clone(),
                source: Some(new.source.to_string()),
                annotations: Value::Null,
                kind: Some("image".into()),
                duration_ms: 0,
                video_file: None,
                video_dir: None,
                saved_path: None,
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
            Ok((c.file, c.thumbnail, c.video_file, c.video_dir))
        })?;
        // A recording's folder (the video and what belongs to it) goes with its card.
        if let Some(d) = &removed.3 {
            let dir = PathBuf::from(d);
            let _ = fs::remove_dir_all(&dir);
            if let Some(p) = dir.parent() {
                crate::recstore::remove_if_empty(p);
            }
        } else if let Some(v) = &removed.2 {
            if let Some(dir) = Path::new(v).parent() {
                let _ = fs::remove_dir_all(self.session_dir().join(dir));
            }
        }
        self.remove_file(&removed.0);
        if let Some(t) = &removed.1 {
            self.remove_file(t);
        }
        self.remove_ocr(id);
        Ok(())
    }

    /// Remember the file a screenshot was saved to automatically.
    pub fn set_saved_path(&mut self, id: &str, path: &Path) -> StoreResult<()> {
        let path = path.to_string_lossy().into_owned();
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            s.groups[g].captures[c].saved_path = Some(path);
            Ok(())
        })
    }

    /// Make a capture a recording that lives in `dir` (`screen.mp4` and its tracks), with its length.
    pub fn set_recording(&mut self, id: &str, dir: &Path, duration_ms: u64) -> StoreResult<()> {
        let dir = dir.to_string_lossy().into_owned();
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            let cap = &mut s.groups[g].captures[c];
            cap.kind = Some("video".into());
            cap.video_file = Some("screen.mp4".into());
            cap.video_dir = Some(dir);
            cap.duration_ms = duration_ms;
            Ok(())
        })
    }

    /// Make a capture a recording: its screen video (relative to the session folder) and its length.
    #[cfg(test)]
    pub fn set_video(&mut self, id: &str, video_file: &str, duration_ms: u64) -> StoreResult<()> {
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            let cap = &mut s.groups[g].captures[c];
            cap.kind = Some("video".into());
            cap.video_file = Some(video_file.to_string());
            cap.duration_ms = duration_ms;
            Ok(())
        })
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

    /// Move several captures to a group in one step, in the order given, so that they sit together at `index` of that
    /// group's list *without* them (the end when `None`). Works within a group too, so it is also the reorder.
    pub fn move_captures(
        &mut self,
        ids: &[String],
        group_id: &str,
        index: Option<usize>,
    ) -> StoreResult<()> {
        self.change(|s| {
            if !s.groups.iter().any(|g| g.id == group_id) {
                return Err(StoreError::NotFound(format!("group {group_id}")));
            }
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if !seen.insert(id.as_str()) {
                    return Err(StoreError::Invalid(format!("{id} is listed twice")));
                }
                if s.find_capture(id).is_none() {
                    return Err(StoreError::NotFound(format!("capture {id}")));
                }
            }
            let mut moved = Vec::with_capacity(ids.len());
            for id in ids {
                let (g, c) = s.find_capture(id).expect("checked above");
                moved.push(s.groups[g].captures.remove(c));
            }
            let target = s.group_mut(group_id)?;
            let at = index
                .unwrap_or(target.captures.len())
                .min(target.captures.len());
            target.captures.splice(at..at, moved);
            Ok(())
        })?;
        // Recordings that moved to another group move their folders.
        self.relocate_recordings(group_id);
        Ok(())
    }

    /// Copy captures (image, thumbnail and annotations) into new captures that sit right after their originals. The
    /// name of each copy is the original's plus `suffix`. Returns the new ids, in the order of `ids`.
    pub fn duplicate_captures(&mut self, ids: &[String], suffix: &str) -> StoreResult<Vec<String>> {
        let dir = self.session_dir();
        let mut made: Vec<(String, Capture)> = Vec::new(); // (id of the original, the copy)
        let mut written: Vec<String> = Vec::new();
        let prepared: StoreResult<()> = (|| {
            for id in ids {
                let (g, c) = self
                    .session
                    .find_capture(id)
                    .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
                let original = &self.session.groups[g].captures[c];
                let new = new_id("c");
                let file = format!("images/{new}.png");
                fs::create_dir_all(dir.join("images"))?;
                fs::copy(dir.join(&original.file), dir.join(&file))?;
                written.push(file.clone());
                let thumbnail = match &original.thumbnail {
                    Some(t) => {
                        let rel = format!("thumbs/{new}.png");
                        fs::create_dir_all(dir.join("thumbs"))?;
                        // A thumbnail that cannot be copied is not worth failing for: the list shows the image.
                        if fs::copy(dir.join(t), dir.join(&rel)).is_ok() {
                            written.push(rel.clone());
                            Some(rel)
                        } else {
                            None
                        }
                    }
                    None => None,
                };
                let mut name = format!("{}{}", original.name, suffix);
                if name.chars().count() > 80 {
                    name = name.chars().take(80).collect();
                }
                made.push((
                    id.clone(),
                    Capture {
                        id: new,
                        name,
                        // The copy keeps the time of the original, so that it sits right after it in every sort order.
                        created_at: original.created_at,
                        file,
                        thumb_size: if thumbnail.is_some() {
                            original.thumb_size
                        } else {
                            0
                        },
                        thumbnail,
                        thumb_rev: 0,
                        width: original.width,
                        height: original.height,
                        source_window_title: original.source_window_title.clone(),
                        source: original.source.clone(),
                        annotations: original.annotations.clone(),
                        kind: original.kind.clone(),
                        duration_ms: original.duration_ms,
                        video_file: None,
                        video_dir: None,
                        saved_path: None,
                    },
                ));
            }
            Ok(())
        })();
        let result = prepared.and_then(|_| {
            self.change(|s| {
                let mut new_ids: Vec<String> = Vec::new();
                for (original, copy) in made.drain(..) {
                    let (g, c) = s
                        .find_capture(&original)
                        .ok_or_else(|| StoreError::NotFound(format!("capture {original}")))?;
                    // Right after the original (and after copies already put there, when one is listed twice).
                    let mut at = c + 1;
                    while s.groups[g]
                        .captures
                        .get(at)
                        .is_some_and(|x| new_ids.contains(&x.id))
                    {
                        at += 1;
                    }
                    new_ids.push(copy.id.clone());
                    s.groups[g].captures.insert(at, copy);
                }
                Ok(new_ids)
            })
        });
        if result.is_err() {
            for f in &written {
                self.remove_file(f);
            }
        }
        result
    }

    /// Ids and image files of the captures whose thumbnail is missing or smaller than `width` (made by an earlier
    /// version), in list order.
    pub fn captures_needing_thumbnail_upgrade(&self, width: u32) -> Vec<(String, String)> {
        self.session
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .filter(|c| c.thumb_size < width)
            .map(|c| (c.id.clone(), c.file.clone()))
            .collect()
    }

    /// Record thumbnails that were written to `thumbs/<id>.png` (id, relative file). Captures deleted meanwhile lose
    /// the file again.
    pub fn record_thumbnails(&mut self, done: &[(String, String)], width: u32) -> StoreResult<()> {
        if done.is_empty() {
            return Ok(());
        }
        let orphans = self.change(|s| {
            let mut orphans = Vec::new();
            for (id, rel) in done {
                match s.find_capture(id) {
                    Some((g, c)) => {
                        let cap = &mut s.groups[g].captures[c];
                        cap.thumbnail = Some(rel.clone());
                        cap.thumb_size = width;
                    }
                    None => orphans.push(rel.clone()),
                }
            }
            Ok(orphans)
        })?;
        for rel in orphans {
            self.remove_file(&rel);
        }
        Ok(())
    }

    /// Replace the annotations of a capture (the editable marks, crop and rotation; see src/annotate/schema.ts).
    /// `Null` removes them. The original image is never touched.
    pub fn set_annotations(&mut self, id: &str, annotations: Value) -> StoreResult<()> {
        if !(annotations.is_null() || annotations.is_object()) {
            return Err(StoreError::Invalid(
                "the annotations must be an object".into(),
            ));
        }
        // A runaway page must not fill the session file.
        if annotations.to_string().len() > MAX_ANNOTATIONS_BYTES {
            return Err(StoreError::Invalid("the annotations are too large".into()));
        }
        // Text recognized before a redaction was added could still contain the redacted text: delete it with the change.
        let redactions = |v: &Value| -> Vec<Value> {
            v.get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|i| i.get("type").and_then(Value::as_str) == Some("redact"))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default()
        };
        let before = self
            .session
            .find_capture(id)
            .map(|(g, c)| redactions(&self.session.groups[g].captures[c].annotations))
            .unwrap_or_default();
        let changed = before != redactions(&annotations);
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            s.groups[g].captures[c].annotations = annotations;
            Ok(())
        })?;
        if changed {
            self.remove_ocr(id);
        }
        Ok(())
    }

    /// Replace the thumbnail of a capture with a picture the page rendered (the image with its annotations).
    /// `width` is the width limit the thumbnail stands for (so the background upgrade leaves it alone). The file is written before the session file
    /// mentions it.
    pub fn set_thumbnail(&mut self, id: &str, png: &[u8], width: u32) -> StoreResult<()> {
        if self.session.find_capture(id).is_none() {
            return Err(StoreError::NotFound(format!("capture {id}")));
        }
        let rel = format!("thumbs/{id}.png");
        let path = self.session_dir().join(&rel);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&path, png)?;
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            let cap = &mut s.groups[g].captures[c];
            cap.thumbnail = Some(rel.clone());
            cap.thumb_size = width;
            cap.thumb_rev = cap.thumb_rev.wrapping_add(1);
            Ok(())
        })
    }

    /// The recognized text of a capture (`ocr/<id>.json`), written by `ocr.rs`.
    pub fn ocr_path(&self, id: &str) -> PathBuf {
        self.session_dir().join("ocr").join(format!("{id}.json"))
    }

    fn remove_ocr(&self, id: &str) {
        if is_safe_id(id) {
            let _ = fs::remove_file(self.ocr_path(id));
        }
    }

    /// Replace the picture of a capture: the new PNG goes next to the old one and is renamed over it, so there is never
    /// half a file, and nothing of the old one is left behind. The thumbnail is replaced too, and the recognized text
    /// (which may be of the old pixels) is deleted. Used to burn redactions into the stored picture, and to undo that.
    pub fn replace_image(&mut self, id: &str, png: &[u8], thumb: Option<&[u8]>) -> StoreResult<()> {
        let capture = self
            .session
            .find_capture(id)
            .map(|(g, c)| self.session.groups[g].captures[c].clone())
            .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
        if !is_safe_relative(&capture.file) {
            return Err(StoreError::Invalid(
                "the capture's file name is not usable".into(),
            ));
        }
        let dir = self.session_dir();
        let path = dir.join(&capture.file);
        let swap = path.with_extension("png.swap");
        fs::write(&swap, png)?;
        if let Err(e) = fs::rename(&swap, &path) {
            let _ = fs::remove_file(&swap);
            return Err(e.into());
        }
        let thumb_rel = format!("thumbs/{id}.png");
        if let Some(t) = thumb {
            fs::create_dir_all(dir.join("thumbs"))?;
            let tpath = dir.join(&thumb_rel);
            let tswap = tpath.with_extension("png.swap");
            fs::write(&tswap, t)?;
            if let Err(e) = fs::rename(&tswap, &tpath) {
                let _ = fs::remove_file(&tswap);
                return Err(e.into());
            }
        }
        self.remove_ocr(id);
        self.change(|s| {
            let (g, c) = s
                .find_capture(id)
                .ok_or_else(|| StoreError::NotFound(format!("capture {id}")))?;
            let cap = &mut s.groups[g].captures[c];
            if thumb.is_some() {
                cap.thumbnail = Some(thumb_rel.clone());
                cap.thumb_size = crate::thumbs::THUMB_MAX.0;
            }
            cap.thumb_rev = cap.thumb_rev.wrapping_add(1);
            Ok(())
        })
    }

    fn remove_file(&self, relative: &str) {
        if is_safe_relative(relative) {
            let _ = fs::remove_file(self.session_dir().join(relative));
        }
    }

    /// A file of a recording (`rec/<capture id>/screen.mp4`, `system.wav`, ...) for the player. `session_id` and `file` come from the
    /// page.
    pub fn recording_file(&self, session_id: &str, file: &str) -> Option<PathBuf> {
        let rest = file.strip_prefix("rec/")?;
        let (capture_id, name) = rest.split_once('/')?;
        // The video, the audio tracks, the cursor track and the info file; the cursor pictures are in `cursors/`.
        let plain = |n: &str, exts: &[&str]| {
            !n.contains('/')
                && is_safe_relative(n)
                && exts.iter().any(|e| n.ends_with(&format!(".{e}")))
        };
        let ok = match name.strip_prefix("cursors/") {
            Some(image) => plain(image, &["png"]),
            None => plain(name, &["mp4", "wav", "m4a", "json", "jsonl"]),
        };
        if session_id != self.session.id || !is_safe_id(capture_id) || !ok {
            return None;
        }
        Some(self.recording_dir(capture_id)?.join(name))
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
        let dir = crate::testdir::new();
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
        // (a second group of screenshots would be merged at the next start: screenshots are one list)
        store.create_group_of(Some("Docs".into()), true).unwrap();
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
        store.delete_group(&g2, None).unwrap();
        assert!(!file.exists());
        assert_eq!(store.session().groups.len(), 1);
        assert!(
            store.delete_group(&g1, None).is_err(),
            "the last group stays"
        );
    }

    #[test]
    fn group_order_is_renumbered_after_a_delete() {
        let (_d, mut store) = store();
        let a = store.create_group(None).unwrap();
        store.create_group(None).unwrap();
        store.delete_group(&a, None).unwrap();
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

        store.new_session(false, None).unwrap();
        assert_ne!(store.session().id, first);
        assert_eq!(store.session().capture_count(), 0);
        assert!(root.join(&first).exists());

        let second = store.session().id.clone();
        store.new_session(true, None).unwrap();
        assert!(!root.join(&second).exists());
        assert!(root.join(&first).exists());
    }

    #[test]
    fn the_newest_session_is_reopened() {
        let (dir, mut store) = store();
        let root = dir.path().join("sessions");
        store.new_session(false, None).unwrap();
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
        store.new_session(false, None).unwrap();
        let current = store.session().id.clone();

        // Nothing is old yet.
        assert_eq!(store.cleanup(30, now_ms()), 0);
        // 31 days later the old one goes, the current one stays however old it is.
        assert_eq!(store.cleanup(30, now_ms() + 31 * DAY_MS), 1);
        assert!(!root.join(&old).exists());
        assert!(root.join(&current).exists());
        // 0 = keep forever.
        store.new_session(false, None).unwrap();
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
        let mut store = SessionStore::open(root.clone());
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

    fn ids(store: &SessionStore, group: usize) -> Vec<String> {
        store.session().groups[group]
            .captures
            .iter()
            .map(|c| c.id.clone())
            .collect()
    }

    #[test]
    fn several_captures_move_together_to_another_group() {
        let (_d, mut store) = store();
        let g1 = store.session().groups[0].id.clone();
        let g2 = store.create_group(None).unwrap();
        let a = add(&mut store, &g1, "a");
        let b = add(&mut store, &g1, "b");
        let c = add(&mut store, &g1, "c");
        add(&mut store, &g2, "x");
        add(&mut store, &g2, "y");

        // In the order given, at a position of the target list.
        store
            .move_captures(&[c.id.clone(), a.id.clone()], &g2, Some(1))
            .unwrap();
        assert_eq!(names(&store, 0), ["b"]);
        assert_eq!(names(&store, 1), ["x", "c", "a", "y"]);
        // To the end.
        store
            .move_captures(std::slice::from_ref(&b.id), &g2, None)
            .unwrap();
        assert_eq!(names(&store, 1), ["x", "c", "a", "y", "b"]);
        assert!(names(&store, 0).is_empty());
    }

    #[test]
    fn moving_within_a_group_is_a_reorder() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = add(&mut store, &g, "a");
        add(&mut store, &g, "b");
        let c = add(&mut store, &g, "c");
        let d = add(&mut store, &g, "d");
        // The position counts in the list without the moved captures: a c d b -> b, then a and c before d.
        store
            .move_captures(&[a.id.clone(), c.id.clone()], &g, Some(1))
            .unwrap();
        assert_eq!(names(&store, 0), ["b", "a", "c", "d"]);
        store
            .move_captures(std::slice::from_ref(&d.id), &g, Some(0))
            .unwrap();
        assert_eq!(names(&store, 0), ["d", "b", "a", "c"]);
    }

    #[test]
    fn a_bad_move_changes_nothing() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = add(&mut store, &g, "a");
        add(&mut store, &g, "b");
        assert!(store
            .move_captures(&[a.id.clone(), "nope".into()], &g, None)
            .is_err());
        assert!(store
            .move_captures(&[a.id.clone(), a.id.clone()], &g, None)
            .is_err());
        assert!(store
            .move_captures(std::slice::from_ref(&a.id), "nope", None)
            .is_err());
        assert_eq!(names(&store, 0), ["a", "b"]);
    }

    #[test]
    fn a_duplicate_sits_right_after_its_original_with_its_own_files() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = store
            .add_capture(
                &g,
                Some("a".into()),
                b"image-a",
                Some(b"thumb-a"),
                3,
                4,
                Some("Notepad".into()),
            )
            .unwrap();
        add(&mut store, &g, "b");
        let c = add(&mut store, &g, "c");

        let new = store
            .duplicate_captures(&[c.id.clone(), a.id.clone()], " copy")
            .unwrap();
        assert_eq!(names(&store, 0), ["a", "a copy", "b", "c", "c copy"]);
        assert_eq!(new.len(), 2);
        assert_eq!(ids(&store, 0)[1], new[1], "the copy of a is second");
        assert_eq!(ids(&store, 0)[4], new[0]);

        let copy = &store.session().groups[0].captures[1];
        assert_eq!(
            copy.created_at, a.created_at,
            "a copy sorts next to its original"
        );
        assert_eq!((copy.width, copy.height), (3, 4));
        assert_eq!(copy.source_window_title.as_deref(), Some("Notepad"));
        assert_ne!(copy.id, a.id);
        let root = dir.path().join("sessions").join(&store.session().id);
        assert_eq!(fs::read(root.join(&copy.file)).unwrap(), b"image-a");
        assert_eq!(
            fs::read(root.join(copy.thumbnail.as_ref().unwrap())).unwrap(),
            b"thumb-a"
        );
        // Deleting the copy leaves the original alone.
        let copy_id = copy.id.clone();
        store.delete_capture(&copy_id).unwrap();
        assert_eq!(fs::read(root.join(&a.file)).unwrap(), b"image-a");
    }

    #[test]
    fn a_duplicate_keeps_the_annotations_and_survives_a_restart() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = add(&mut store, &g, "a");
        store
            .change(|s| {
                s.groups[0].captures[0].annotations = serde_json::json!([{"kind": "pen"}]);
                Ok(())
            })
            .unwrap();
        store
            .duplicate_captures(std::slice::from_ref(&a.id), "!")
            .unwrap();
        assert_eq!(
            store.session().groups[0].captures[1].annotations,
            serde_json::json!([{"kind": "pen"}])
        );
        let before = store.session().clone();
        drop(store);
        assert_eq!(
            SessionStore::open(dir.path().join("sessions")).session(),
            &before
        );
    }

    #[test]
    fn a_failed_duplicate_leaves_no_files_behind() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let a = add(&mut store, &g, "a");
        let dir = store.session_dir();
        // The second capture's image is missing, so the copy fails after the first was copied.
        let b = add(&mut store, &g, "b");
        fs::remove_file(dir.join(&b.file)).unwrap();
        let before = fs::read_dir(dir.join("images")).unwrap().count();
        assert!(store
            .duplicate_captures(&[a.id.clone(), b.id.clone()], " copy")
            .is_err());
        assert_eq!(fs::read_dir(dir.join("images")).unwrap().count(), before);
        assert_eq!(names(&store, 0), ["a", "b"]);
    }

    #[test]
    fn group_tabs_are_reordered_only_with_a_complete_list() {
        let (_d, mut store) = store();
        let a = store.session().groups[0].id.clone();
        let b = store.create_group(None).unwrap();
        let c = store.create_group(None).unwrap();
        store
            .reorder_groups(&[c.clone(), a.clone(), b.clone()])
            .unwrap();
        let order: Vec<_> = store
            .session()
            .groups
            .iter()
            .map(|g| (g.id.clone(), g.order))
            .collect();
        assert_eq!(order, [(c.clone(), 0), (a.clone(), 1), (b.clone(), 2)]);
        assert!(store.reorder_groups(&[a.clone(), b.clone()]).is_err());
        assert!(store
            .reorder_groups(&[a.clone(), a.clone(), b.clone()])
            .is_err());
        assert!(store
            .reorder_groups(&[a.clone(), b.clone(), "nope".into()])
            .is_err());
        assert_eq!(
            store.session().groups[0].id,
            c,
            "a bad list changes nothing"
        );
    }

    #[test]
    fn a_group_has_a_colour_and_an_emoji_from_the_lists() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        store.set_group_color(&g, Some("teal")).unwrap();
        store.set_group_emoji(&g, Some("🔥")).unwrap();
        assert_eq!(store.session().groups[0].color.as_deref(), Some("teal"));
        assert_eq!(store.session().groups[0].emoji.as_deref(), Some("🔥"));
        assert!(store.set_group_color(&g, Some("#ff0000")).is_err());
        assert!(store.set_group_emoji(&g, Some("x")).is_err());
        assert!(store.set_group_color("nope", Some("red")).is_err());
        let before = store.session().clone();
        drop(store);
        let mut again = SessionStore::open(dir.path().join("sessions"));
        assert_eq!(again.session(), &before);
        again.set_group_color(&g, None).unwrap();
        again.set_group_emoji(&g, None).unwrap();
        assert!(
            again.session().groups[0].color.is_none() && again.session().groups[0].emoji.is_none()
        );
    }

    #[test]
    fn the_colour_and_emoji_lists_match_the_page() {
        // src/groupRules.ts lists the same values; a change on one side must be made on the other.
        let page = include_str!("../../src/groupRules.ts");
        for c in GROUP_COLORS {
            assert!(page.contains(&format!("\"{c}\"")), "colour {c}");
        }
        for e in GROUP_EMOJIS {
            assert!(page.contains(e), "emoji {e}");
        }
    }

    #[test]
    fn deleting_a_group_can_move_its_captures_to_another_group() {
        let (_d, mut store) = store();
        let g1 = store.session().groups[0].id.clone();
        let g2 = store.create_group(None).unwrap();
        let g3 = store.create_group(None).unwrap();
        add(&mut store, &g1, "a");
        let b = add(&mut store, &g2, "b");
        let c = add(&mut store, &g2, "c");
        add(&mut store, &g3, "z");
        let file = store.session_dir().join(&b.file);

        // Not onto itself, not onto a group that does not exist; nothing changes.
        assert!(store.delete_group(&g2, Some(&g2)).is_err());
        assert!(store.delete_group(&g2, Some("nope")).is_err());
        assert_eq!(store.session().groups.len(), 3);

        store.delete_group(&g2, Some(&g1)).unwrap();
        assert_eq!(store.session().groups.len(), 2);
        assert_eq!(names(&store, 0), ["a", "b", "c"]);
        assert!(file.exists(), "moved captures keep their files");
        assert_eq!(store.session().groups[0].captures[2].id, c.id);
        let orders: Vec<u32> = store.session().groups.iter().map(|g| g.order).collect();
        assert_eq!(orders, [0, 1]);
    }

    #[test]
    fn deleting_a_group_without_a_target_deletes_its_captures() {
        let (_d, mut store) = store();
        let g2 = store.create_group(None).unwrap();
        let c = add(&mut store, &g2, "gone");
        let file = store.session_dir().join(&c.file);
        store.delete_group(&g2, None).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn the_last_group_cannot_be_deleted_even_with_a_target() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        assert!(store.delete_group(&g, Some(&g)).is_err());
        assert_eq!(store.session().groups.len(), 1);
    }

    #[test]
    fn thumbnails_made_by_earlier_versions_are_found_and_upgraded() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let old = store
            .add_capture(&g, None, b"img", None, 1, 1, None)
            .unwrap();
        let fresh = store
            .add_capture(&g, None, b"img", Some(b"t"), 1, 1, None)
            .unwrap();
        let width = crate::thumbs::THUMB_MAX.0;
        let todo = store.captures_needing_thumbnail_upgrade(width);
        assert_eq!(todo, vec![(old.id.clone(), old.file.clone())]);

        let dir = store.session_dir();
        fs::create_dir_all(dir.join("thumbs")).unwrap();
        let rel = format!("thumbs/{}.png", old.id);
        fs::write(dir.join(&rel), b"new").unwrap();
        // A capture deleted in the meantime loses the file again.
        let ghost = format!("thumbs/{}.png", fresh.id);
        store.delete_capture(&fresh.id).unwrap();
        fs::write(dir.join(&ghost), b"orphan").unwrap();
        store
            .record_thumbnails(
                &[
                    (old.id.clone(), rel.clone()),
                    (fresh.id.clone(), ghost.clone()),
                ],
                width,
            )
            .unwrap();
        assert_eq!(
            store.session().groups[0].captures[0].thumbnail.as_deref(),
            Some(rel.as_str())
        );
        assert!(store.captures_needing_thumbnail_upgrade(width).is_empty());
        assert!(!dir.join(&ghost).exists());
    }

    #[test]
    fn sessions_of_earlier_versions_load_with_defaults() {
        let dir = crate::testdir::new();
        let root = dir.path().join("sessions");
        fs::create_dir_all(root.join("sold")).unwrap();
        fs::write(
            root.join("sold").join("session.json"),
            r#"{"id":"sold","createdAt":1,"updatedAt":2,"groups":[{"id":"g1","name":"Group 1","order":0,
            "captures":[{"id":"c1","name":"x","createdAt":1,"file":"images/c1.png","thumbnail":"thumbs/c1.png",
            "width":10,"height":10,"sourceWindowTitle":null,"annotations":null}]}]}"#,
        )
        .unwrap();
        let store = SessionStore::open(root);
        let g = &store.session().groups[0];
        assert!(g.color.is_none() && g.emoji.is_none());
        let c = &g.captures[0];
        assert_eq!((c.thumb_size, c.source.as_deref()), (0, None));
        assert_eq!(store.captures_needing_thumbnail_upgrade(520).len(), 1);
    }

    #[test]
    fn an_added_capture_remembers_where_it_came_from() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let shot = add(&mut store, &g, "shot");
        assert_eq!(shot.source.as_deref(), Some("screenshot"));
        let imported = store
            .add_capture_with(
                &g,
                NewCapture {
                    name: Some("photo".into()),
                    png: b"png",
                    thumb: None,
                    thumb_size: 0,
                    width: 5,
                    height: 5,
                    source_window_title: None,
                    source: "imported",
                },
            )
            .unwrap();
        assert_eq!(imported.source.as_deref(), Some("imported"));
        assert_eq!(imported.name, "photo");
    }

    fn group(name: &str) -> Group {
        Group {
            name: name.into(),
            ..Group::default()
        }
    }

    #[test]
    fn recordings_in_a_screenshot_group_move_to_a_recording_group_when_the_session_is_opened() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let shot = add(&mut store, &g, "shot");
        let video = add(&mut store, &g, "rec");
        store
            .set_video(&video.id, "recordings/r1/screen.mp4", 1500)
            .unwrap();
        drop(store);
        // An old session: no recording group, a video among the screenshots.
        let reopened = SessionStore::open(dir.path().join("sessions"));
        let groups = &reopened.session().groups;
        assert_eq!(groups.len(), 2);
        assert!(!groups[0].is_recording() && groups[1].is_recording());
        assert_eq!(
            groups[0]
                .captures
                .iter()
                .map(|c| c.id.clone())
                .collect::<Vec<_>>(),
            [shot.id]
        );
        assert_eq!(groups[1].captures.len(), 1);
        assert_eq!(groups[1].captures[0].id, video.id);
        assert_eq!(
            groups[1].captures[0].video_file.as_deref(),
            Some("recordings/r1/screen.mp4")
        );
        assert_eq!(
            groups[1].name, "Group 1",
            "the recording groups are numbered on their own"
        );
        // It was written: opening again changes nothing.
        let again = SessionStore::open(dir.path().join("sessions"));
        assert_eq!(again.session().groups.len(), 2);
    }

    #[test]
    fn sessions_without_recordings_or_recording_groups_load_unchanged() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        add(&mut store, &g, "shot");
        drop(store);
        let reopened = SessionStore::open(dir.path().join("sessions"));
        assert_eq!(reopened.session().groups.len(), 1);
        assert!(reopened.session().groups.iter().all(|g| g.kind.is_none()));
    }

    #[test]
    fn each_kind_of_group_has_its_own_names_and_its_own_last_group() {
        let (_dir, mut store) = store();
        let first_shot = store.session().groups[0].id.clone();
        let rec = store.create_group_of(None, true).unwrap();
        let rec2 = store.create_group_of(None, true).unwrap();
        let names: Vec<_> = store
            .session()
            .groups
            .iter()
            .map(|g| (g.name.clone(), g.is_recording()))
            .collect();
        assert_eq!(
            names,
            [
                ("Group 1".into(), false),
                ("Group 1".into(), true),
                ("Group 2".into(), true)
            ]
        );
        // The only screenshot group stays although there are three groups; a recording group can go while another is left.
        assert!(store.delete_group(&first_shot, None).is_err());
        store.delete_group(&rec2, None).unwrap();
        assert!(store.delete_group(&rec, None).is_err());
        assert_eq!(store.ensure_recording_group().unwrap(), rec);
    }

    fn names_of_groups(store: &SessionStore) -> Vec<String> {
        store
            .session()
            .groups
            .iter()
            .map(|g| g.name.clone())
            .collect()
    }

    #[test]
    fn a_new_group_takes_the_lowest_free_default_number() {
        let (_d, mut store) = store();
        let g1 = store.session().groups[0].id.clone();
        assert_eq!(store.session().groups[0].name, "Group 1");
        let g2 = store.create_group(None).unwrap();
        assert_eq!(store.session().groups[1].name, "Group 2");
        store.create_group(None).unwrap();
        assert_eq!(store.session().groups[2].name, "Group 3");
        // Group 1 and Group 3 exist: the next one is Group 2.
        store.delete_group(&g2, None).unwrap();
        store.create_group(None).unwrap();
        assert_eq!(names_of_groups(&store), ["Group 1", "Group 3", "Group 2"]);
        // Group 1 gone: Group 1 is free again.
        store.delete_group(&g1, None).unwrap();
        store.create_group(None).unwrap();
        assert!(names_of_groups(&store).contains(&"Group 1".to_string()));
    }

    #[test]
    fn renamed_groups_do_not_count_for_the_numbering() {
        let (_d, mut store) = store();
        let g1 = store.session().groups[0].id.clone();
        store.rename_group(&g1, "Bug report").unwrap();
        // "Group 1" is free although a group once had that name.
        let g = store.create_group(None).unwrap();
        assert_eq!(store.session().groups[1].name, "Group 1");
        store.rename_group(&g, "Group 7 (old)").unwrap();
        store.create_group(None).unwrap();
        assert_eq!(store.session().groups[2].name, "Group 1");
    }

    #[test]
    fn the_numbering_rule_reads_only_plain_group_numbers() {
        assert_eq!(default_group_number("Group 12"), Some(12));
        for not in [
            "Group",
            "Group ",
            "Group 0",
            "Group 01",
            "group 2",
            "Group 2b",
            "Group -1",
            " Group 2",
            "Gruppe 2b",
        ] {
            assert_eq!(default_group_number(not), None, "{not}");
        }
        assert_eq!(lowest_free_group_number(&[]), 1);
        assert_eq!(
            lowest_free_group_number(&[group("Group 1"), group("Group 2")]),
            3
        );
        assert_eq!(lowest_free_group_number(&[group("Group 2"), group("x")]), 1);
    }

    #[test]
    fn a_given_name_wins_and_a_new_session_can_name_its_first_group() {
        let (_d, mut store) = store();
        store.create_group(Some("  Gruppe 2 ".into())).unwrap();
        assert_eq!(store.session().groups[1].name, "Gruppe 2");
        store.new_session(false, Some("Gruppe 1".into())).unwrap();
        assert_eq!(store.session().groups[0].name, "Gruppe 1");
    }

    #[test]
    fn annotations_are_saved_with_the_session_and_validated() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = add(&mut store, &g, "a");
        let doc = serde_json::json!({"version": 1, "items": [{"type": "rect", "id": "x"}]});
        store.set_annotations(&c.id, doc.clone()).unwrap();
        assert_eq!(store.session().groups[0].captures[0].annotations, doc);
        let before = store.session().clone();
        drop(store);
        let mut again = SessionStore::open(dir.path().join("sessions"));
        assert_eq!(again.session(), &before);
        assert!(again
            .set_annotations(&c.id, serde_json::json!([1, 2]))
            .is_err());
        assert!(again.set_annotations("nope", Value::Null).is_err());
        let huge = serde_json::json!({"version": 1, "blob": "x".repeat(MAX_ANNOTATIONS_BYTES + 1)});
        assert!(again.set_annotations(&c.id, huge).is_err());
        assert_eq!(
            again.session().groups[0].captures[0].annotations,
            doc,
            "a bad call changes nothing"
        );
        again.set_annotations(&c.id, Value::Null).unwrap();
        assert!(again.session().groups[0].captures[0].annotations.is_null());
    }

    #[test]
    fn a_new_thumbnail_replaces_the_old_one_and_is_not_upgraded_again() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = store
            .add_capture(&g, None, b"img", Some(b"old"), 4, 4, None)
            .unwrap();
        // An old small thumbnail would be upgraded from the original, losing the annotations.
        store
            .change(|s| {
                s.groups[0].captures[0].thumb_size = 0;
                Ok(())
            })
            .unwrap();
        assert_eq!(store.captures_needing_thumbnail_upgrade(520).len(), 1);
        store.set_thumbnail(&c.id, b"annotated", 520).unwrap();
        let cap = &store.session().groups[0].captures[0];
        assert_eq!((cap.thumb_size, cap.thumb_rev), (520, 1));
        let sid = store.session().id.clone();
        assert_eq!(
            store
                .read_image(&sid, cap.thumbnail.as_ref().unwrap())
                .unwrap(),
            b"annotated"
        );
        assert!(store.captures_needing_thumbnail_upgrade(520).is_empty());
        store.set_thumbnail(&c.id, b"again", 520).unwrap();
        assert_eq!(store.session().groups[0].captures[0].thumb_rev, 2);
        assert!(store.set_thumbnail("nope", b"x", 520).is_err());
    }

    #[test]
    fn the_first_group_and_new_groups_are_named_in_the_interface_language() {
        let dir = crate::testdir::new();
        let mut store = SessionStore::open_in(dir.path().join("sessions"), "de");
        assert_eq!(store.session().groups[0].name, "Gruppe 1");
        store.create_group(None).unwrap();
        assert_eq!(store.session().groups[1].name, "Gruppe 2");
        store.new_session(false, None).unwrap();
        assert_eq!(store.session().groups[0].name, "Gruppe 1");
        store.set_language("ar");
        store.new_session(false, None).unwrap();
        assert_eq!(store.session().groups[0].name, "المجموعة 1");
        store.set_language("xx");
        store.new_session(false, None).unwrap();
        assert_eq!(store.session().groups[0].name, "Group 1");
    }

    #[test]
    fn default_names_of_every_language_count_for_the_numbering() {
        assert_eq!(default_group_number("Gruppe 4"), Some(4));
        assert_eq!(default_group_number("分组 2"), Some(2));
        assert_eq!(default_group_number("Gruppe"), None);
        assert_eq!(default_group_number("Gruppe 04"), None);
        assert_eq!(
            lowest_free_group_number(&[group("Gruppe 1"), group("Group 2"), group("Grupo 4")]),
            3
        );
    }

    #[test]
    fn the_group_name_templates_match_the_page() {
        // src/locales/<lang>.ts has the same "groups.defaultName".
        for (lang, template) in GROUP_NAME_TEMPLATES {
            let file = match lang {
                "en" => include_str!("../../src/locales/en.ts"),
                "de" => include_str!("../../src/locales/de.ts"),
                "es" => include_str!("../../src/locales/es.ts"),
                "fr" => include_str!("../../src/locales/fr.ts"),
                "it" => include_str!("../../src/locales/it.ts"),
                "nl" => include_str!("../../src/locales/nl.ts"),
                "pl" => include_str!("../../src/locales/pl.ts"),
                "tr" => include_str!("../../src/locales/tr.ts"),
                "zh-Hans" => include_str!("../../src/locales/zh-Hans.ts"),
                "zh-Hant" => include_str!("../../src/locales/zh-Hant.ts"),
                "ar" => include_str!("../../src/locales/ar.ts"),
                _ => include_str!("../../src/locales/ur.ts"),
            };
            assert!(
                file.contains(&format!("\"groups.defaultName\": \"{template}\"")),
                "{lang}"
            );
        }
    }

    #[test]
    fn replacing_the_picture_leaves_nothing_of_the_old_one() {
        let (dir, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let secret = b"ORIGINAL-PIXELS-with-an-email@example.com".to_vec();
        let c = store
            .add_capture(&g, Some("a".into()), &secret, Some(&secret), 4, 4, None)
            .unwrap();
        let ocr = store.ocr_path(&c.id);
        fs::create_dir_all(ocr.parent().unwrap()).unwrap();
        fs::write(&ocr, "text of the original").unwrap();

        store
            .replace_image(&c.id, b"BAKED", Some(b"BAKED-THUMB"))
            .unwrap();

        let root = dir.path().join("sessions");
        let mut found = Vec::new();
        fn walk(p: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in fs::read_dir(p).unwrap().flatten() {
                if e.path().is_dir() {
                    walk(&e.path(), out);
                } else {
                    out.push(e.path());
                }
            }
        }
        walk(&root, &mut found);
        for f in &found {
            let bytes = fs::read(f).unwrap();
            assert!(
                !bytes.windows(secret.len()).any(|w| w == secret.as_slice()),
                "the old pixels are still in {f:?}"
            );
            assert!(!f.to_string_lossy().ends_with(".swap"), "{f:?}");
        }
        assert_eq!(
            fs::read(store.session_dir().join(&c.file)).unwrap(),
            b"BAKED"
        );
        assert!(
            !ocr.exists(),
            "the recognized text of the old picture is deleted"
        );
        assert_eq!(store.session().groups[0].captures[0].thumb_rev, 1);
        // Putting the old picture back (undo in the same run) restores it.
        store.replace_image(&c.id, &secret, None).unwrap();
        assert_eq!(fs::read(store.session_dir().join(&c.file)).unwrap(), secret);
        assert!(store.replace_image("nope", b"x", None).is_err());
    }

    #[test]
    fn recognized_text_goes_with_its_capture_and_with_a_new_redaction() {
        let (_d, mut store) = store();
        let g = store.session().groups[0].id.clone();
        let c = add(&mut store, &g, "a");
        let ocr = store.ocr_path(&c.id);
        fs::create_dir_all(ocr.parent().unwrap()).unwrap();
        fs::write(&ocr, "{}").unwrap();
        // Marks that are not redactions leave the text alone.
        store
            .set_annotations(
                &c.id,
                serde_json::json!({"version": 1, "items": [{"type": "rect"}]}),
            )
            .unwrap();
        assert!(ocr.exists());
        // A redaction makes the recognized text stale: it may contain what is now covered.
        store
            .set_annotations(
                &c.id,
                serde_json::json!({"version": 1, "items": [{"type": "redact", "x": 1}]}),
            )
            .unwrap();
        assert!(!ocr.exists());
        fs::write(&ocr, "{}").unwrap();
        store.delete_capture(&c.id).unwrap();
        assert!(!ocr.exists());
        let c2 = add(&mut store, &g, "b");
        let ocr2 = store.ocr_path(&c2.id);
        fs::create_dir_all(ocr2.parent().unwrap()).unwrap();
        fs::write(&ocr2, "{}").unwrap();
        let g2 = store.create_group(None).unwrap();
        store
            .move_captures(std::slice::from_ref(&c2.id), &g2, None)
            .unwrap();
        store.delete_group(&g2, None).unwrap();
        assert!(!ocr2.exists());
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
            "thumbSize",
            "thumbRev",
            "source",
        ] {
            assert!(c.get(key).is_some(), "{key}");
        }
    }
}

#[cfg(test)]
mod recording_storage_tests {
    use super::*;

    /// A store whose recordings folder is inside the temp folder; returns it with the id of a new recording group.
    fn store(dir: &Path) -> (SessionStore, String) {
        let mut s = SessionStore::open(dir.join("sessions"));
        s.set_recordings_root(dir.join("Rec"));
        let g = s.ensure_recording_group().unwrap();
        (s, g)
    }

    /// A recording card with a folder that holds a video.
    fn recording(s: &mut SessionStore, group: &str, name: &str) -> (String, PathBuf) {
        let folder = s.new_recording_dir(group, name).unwrap();
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("screen.mp4"), b"video").unwrap();
        let png = image::RgbaImage::new(2, 2);
        let mut bytes = Vec::new();
        png.write_to(&mut io::Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        let c = s
            .add_capture(group, Some(name.into()), &bytes, None, 2, 2, None)
            .unwrap();
        s.set_recording(&c.id, &folder, 1000).unwrap();
        (c.id, folder)
    }

    #[test]
    fn a_recording_lives_in_group_and_recording_folders_with_names_that_do_not_clash() {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        let name = s
            .session()
            .groups
            .iter()
            .find(|x| x.id == g)
            .unwrap()
            .name
            .clone();
        let (a, fa) = recording(&mut s, &g, "Rec 1");
        let (_, fb) = recording(&mut s, &g, "Rec 1");
        assert_eq!(fa, dir.path().join("Rec").join(&name).join("Rec 1"));
        assert_eq!(fb, dir.path().join("Rec").join(&name).join("Rec 1 (2)"));
        assert_eq!(s.recording_dir(&a), Some(fa.clone()));
        let session = s.session().id.clone();
        assert_eq!(
            s.recording_file(&session, &format!("rec/{a}/screen.mp4")),
            Some(fa.join("screen.mp4"))
        );
        assert!(s
            .recording_file(&session, &format!("rec/{a}/../x.mp4"))
            .is_none());
        assert!(s
            .recording_file("other", &format!("rec/{a}/screen.mp4"))
            .is_none());
    }

    #[test]
    fn renaming_or_moving_between_groups_moves_the_folders_and_deleting_deletes_them() {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        let (a, _) = recording(&mut s, &g, "A");
        s.rename_group(&g, "Demo: part 1").unwrap();
        let folder = s.recording_dir(&a).unwrap();
        assert_eq!(
            folder,
            dir.path().join("Rec").join("Demo_ part 1").join("A")
        );
        assert!(folder.join("screen.mp4").exists());
        let g2 = s.create_group_of(Some("Other".into()), true).unwrap();
        s.move_captures(std::slice::from_ref(&a), &g2, None)
            .unwrap();
        let folder = s.recording_dir(&a).unwrap();
        assert_eq!(folder, dir.path().join("Rec").join("Other").join("A"));
        assert!(!dir.path().join("Rec").join("Demo_ part 1").exists());
        s.delete_capture(&a).unwrap();
        assert!(!folder.exists());
        let (b, fb) = recording(&mut s, &g2, "B");
        s.delete_group(&g2, None).unwrap();
        assert!(!fb.exists());
        assert!(s.session().find_capture(&b).is_none());
    }

    #[test]
    fn the_current_recording_is_the_newest_one_in_the_temp_folder_and_a_new_one_replaces_it() {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        assert!(s.current_recording_id().is_none() && !s.current_unsaved());
        let (a, fa) = recording(&mut s, &g, "First");
        assert_eq!(s.current_recording_id(), Some(a.clone()));
        assert!(s.current_unsaved(), "not saved as a project yet");
        s.set_saved_path(&a, &dir.path().join("First.snpr"))
            .unwrap();
        assert!(!s.current_unsaved(), "saved as a project");
        // A newer recording replaces the older one: its folder is deleted.
        let (b, fb) = recording(&mut s, &g, "Second");
        for gr in s.session.groups.iter_mut() {
            for c in gr.captures.iter_mut() {
                c.created_at = if c.id == b { 200 } else { 100 };
            }
        }
        assert_eq!(s.current_recording_id(), Some(b.clone()));
        s.drop_current_except(Some(&b)).unwrap();
        assert!(!fa.exists() && fb.exists());
        assert!(s.session().find_capture(&a).is_none());
        // Recordings of an earlier layout (outside the temp folder) are never the current one and never deleted by this.
        let other = crate::testdir::new();
        s.set_recordings_root(other.path().join("elsewhere"));
        assert!(s.current_recording_id().is_none());
        s.drop_current_except(None).unwrap();
        assert!(fb.exists(), "the old folder is left alone");
        s.set_recordings_root(dir.path().join("Rec"));
        s.drop_current_except(None).unwrap();
        assert!(!fb.exists());
    }

    #[test]
    fn several_screenshot_groups_become_one_list_sorted_by_time_and_recordings_are_left_alone() {
        let dir = crate::testdir::new();
        let (mut s, rec_group) = store(dir.path());
        let png = {
            let mut b = Vec::new();
            image::RgbaImage::new(2, 2)
                .write_to(&mut io::Cursor::new(&mut b), image::ImageFormat::Png)
                .unwrap();
            b
        };
        let g1 = s
            .session()
            .groups
            .iter()
            .find(|g| !g.is_recording())
            .unwrap()
            .id
            .clone();
        let g2 = s.create_group_of(Some("Other".into()), false).unwrap();
        let a = s
            .add_capture(&g2, Some("b second".into()), &png, None, 2, 2, None)
            .unwrap();
        let b = s
            .add_capture(&g1, Some("a first".into()), &png, None, 2, 2, None)
            .unwrap();
        // Make the group 2 capture older.
        for gr in s.session.groups.iter_mut() {
            for c in gr.captures.iter_mut() {
                c.created_at = if c.id == a.id { 100 } else { 200 };
            }
        }
        let (rec, _) = recording(&mut s, &rec_group, "R");
        assert!(s.session.merge_image_groups());
        let images: Vec<&Group> = s
            .session()
            .groups
            .iter()
            .filter(|g| !g.is_recording())
            .collect();
        assert_eq!(images.len(), 1);
        let ids: Vec<&str> = images[0].captures.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, [a.id.as_str(), b.id.as_str()], "oldest first");
        assert!(s.session().find_capture(&rec).is_some(), "recordings stay");
        assert!(!s.session.merge_image_groups(), "nothing left to merge");
    }

    #[test]
    fn show_in_explorer_finds_the_real_path_after_renames_moves_and_a_new_recordings_folder() {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        let (a, _) = recording(&mut s, &g, "Recording 2026-11-20 13-47");
        let at = |s: &SessionStore| s.explorer_path(&a).unwrap();
        assert_eq!(
            at(&s).file_name().unwrap(),
            "screen.mp4",
            "the video is shown"
        );
        s.rename_group(&g, "Renamed").unwrap();
        assert!(at(&s).is_file() && at(&s).to_string_lossy().contains("Renamed"));
        let g2 = s.create_group_of(Some("Other".into()), true).unwrap();
        s.move_captures(std::slice::from_ref(&a), &g2, None)
            .unwrap();
        assert!(at(&s).is_file() && at(&s).to_string_lossy().contains("Other"));
        // The folder setting changed and the recording was moved after the offer.
        s.set_recordings_root(dir.path().join("Elsewhere"));
        assert!(s.relocate_capture(&a));
        assert!(at(&s).is_file() && at(&s).to_string_lossy().contains("Elsewhere"));
        // Deleted in Explorer: nothing to show.
        let video = at(&s);
        std::fs::remove_dir_all(video.parent().unwrap()).unwrap();
        assert!(s.explorer_path(&a).is_none());
    }

    #[test]
    fn recordings_survive_a_new_session_the_retention_setting_and_clear_on_exit() {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        let (a, folder) = recording(&mut s, &g, "Keep me");
        let old_session = s.session().id.clone();
        s.new_session(true, None).unwrap();
        assert_ne!(s.session().id, old_session);
        assert!(!dir.path().join("sessions").join(&old_session).exists());
        assert!(s.session().find_capture(&a).is_some());
        assert!(folder.join("screen.mp4").exists());
        // The recording's card picture came along.
        let (g, c) = s.session().find_capture(&a).unwrap();
        let file = s.session().groups[g].captures[c].file.clone();
        assert!(s.session_dir().join(file).exists());
        // Retention: a session that is old but holds a recording hands it over.
        let g2 = s.ensure_recording_group().unwrap();
        let (b, _) = recording(&mut s, &g2, "Old");
        s.new_session(false, None).unwrap();
        assert!(s.session().find_capture(&b).is_some());
        // Clear on exit: the screenshots go, the recordings stay.
        let shot = s.create_group(None).unwrap();
        let png = {
            let mut bytes = Vec::new();
            image::RgbaImage::new(2, 2)
                .write_to(&mut io::Cursor::new(&mut bytes), image::ImageFormat::Png)
                .unwrap();
            bytes
        };
        let shot_capture = s.add_capture(&shot, None, &png, None, 2, 2, None).unwrap();
        s.delete_current();
        let again = SessionStore::open(dir.path().join("sessions"));
        assert!(again.session().find_capture(&a).is_some());
        assert!(again.session().find_capture(&shot_capture.id).is_none());
    }

    #[test]
    fn recordings_of_an_earlier_version_move_into_the_recordings_folder_and_missing_ones_are_dropped(
    ) {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        let png = {
            let mut bytes = Vec::new();
            image::RgbaImage::new(2, 2)
                .write_to(&mut io::Cursor::new(&mut bytes), image::ImageFormat::Png)
                .unwrap();
            bytes
        };
        let c = s
            .add_capture(&g, Some("Old rec".into()), &png, None, 2, 2, None)
            .unwrap();
        let legacy = s.session_dir().join("recordings").join("r1");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("screen.mp4"), b"v").unwrap();
        s.set_video(&c.id, "recordings/r1/screen.mp4", 500).unwrap();
        assert_eq!(s.migrate_recordings(), 1);
        let folder = s.recording_dir(&c.id).unwrap();
        assert!(folder.starts_with(dir.path().join("Rec")));
        assert!(folder.join("screen.mp4").exists());
        assert!(!legacy.exists());
        assert_eq!(s.migrate_recordings(), 0);
        // Deleted in Explorer: the card goes at the next check.
        fs::remove_dir_all(&folder).unwrap();
        assert_eq!(s.prune_missing_recordings(), 1);
        assert!(s.session().find_capture(&c.id).is_none());
    }

    #[test]
    fn changing_the_recordings_folder_leaves_old_recordings_until_they_are_moved() {
        let dir = crate::testdir::new();
        let (mut s, g) = store(dir.path());
        let (a, old) = recording(&mut s, &g, "A");
        s.set_recordings_root(dir.path().join("New"));
        assert_eq!(s.recording_dir(&a), Some(old.clone()));
        assert_eq!(s.recordings_to_move(), vec![a.clone()]);
        assert!(s.relocate_capture(&a));
        let now = s.recording_dir(&a).unwrap();
        assert!(now.starts_with(dir.path().join("New")) && now.join("screen.mp4").exists());
        assert!(s.recordings_to_move().is_empty());
    }
}
