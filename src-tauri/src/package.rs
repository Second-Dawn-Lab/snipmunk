//! The package format of Snipmunk's project files (`.snpr` now, `.snpd` for documents later): ONE file that is a ZIP container whose
//! entries are all stored without compression, so a media entry can be read by its offset (the player gets it with range
//! requests) without extracting anything. The first entry is `manifest.json`: `{ "format": "<kind>", "version": 1, "appVersion": ...}`.
//!
//! Small things that change (the effects, the trim, the thumbnail) are never rewritten in place: a new version is appended as
//! `meta/<name>.<n>` and the reader takes the highest `n` (`meta()`), so saving a change writes a few kilobytes and a new central
//! directory, not the gigabytes of video. The stale versions are dropped when the project is saved as a new file (`compact`).
//!
//! Crash safety: a new file is written next to its target and renamed (never a half-written project). An append first copies the
//! old tail of the file (the old central directory) to `<file>.tail`; if the program dies in the middle, `repair` puts the tail back
//! at the next open and the project is exactly as it was before the save.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// The `format` of the manifest of a recording project.
pub const KIND_RECORDING: &str = "snipmunk.recording";
pub const MANIFEST: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// What the package is: `snipmunk.recording` (`.snpr`); documents will use their own.
    pub format: String,
    /// The major version of the layout: a reader that does not know it refuses the file.
    pub version: u32,
    /// The minor version: only adds things; a reader of the same major version opens a newer minor version.
    #[serde(default)]
    pub minor: u32,
    /// The version of the program that wrote the file last.
    pub app_version: String,
    /// Any fields this version does not know are kept as they are when the file is saved (see `docs/snpr-format.md`).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// The newest layout this program reads and writes.
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 1;

/// The minor version a recording needs: 1 when its effects use the webcam sync or cuts (added in 1.1), else 0. A 1.0 reader plays
/// such a file with the full video and the webcam where it was recorded, so the minor version is only raised when it is needed.
pub fn minor_needed(recording_json: &[u8]) -> u32 {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(recording_json) else {
        return 0;
    };
    let cuts = v["effects"]["cuts"]
        .as_array()
        .is_some_and(|c| !c.is_empty());
    let sync = v["effects"]["webcam"]["syncMs"]
        .as_i64()
        .is_some_and(|s| s != 0);
    if cuts || sync {
        VERSION_MINOR
    } else {
        0
    }
}

/// A manifest for a new package (the lowest minor version: `create` and `append_meta` raise it when the content needs it).
pub fn new_manifest(kind: &str, version: u32) -> Manifest {
    Manifest {
        format: kind.to_string(),
        version,
        minor: 0,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        extra: serde_json::Map::new(),
    }
}

/// Where the bytes of an entry come from when a package is made.
pub enum Data {
    File(PathBuf),
    Bytes(Vec<u8>),
}

pub struct Source {
    pub name: String,
    pub data: Data,
}

fn zerr(e: zip::result::ZipError) -> io::Error {
    io::Error::other(e.to_string())
}

fn stored() -> SimpleFileOptions {
    // Stored (no compression); `large_file` so an entry may be bigger than 4 GB.
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true)
}

pub(crate) fn tail_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(".tail");
    PathBuf::from(s)
}

/// Make a package at `path`: written to a file next to it and renamed, so there is never a half-written project. The entries are
/// written in the order given, after the manifest.
pub fn create(path: &Path, kind: &str, version: u32, sources: &[Source]) -> io::Result<()> {
    let mut manifest = new_manifest(kind, version);
    for s in sources {
        if let (true, Data::Bytes(b)) = (s.name == "recording.json", &s.data) {
            manifest.minor = manifest.minor.max(minor_needed(b));
        }
    }
    create_streaming(path, &manifest, sources)
}

/// An opened package: its manifest and where every entry lies in the file.
pub struct Package {
    pub path: PathBuf,
    pub manifest: Manifest,
    /// entry name -> (offset of its data in the file, length)
    pub entries: HashMap<String, (u64, u64)>,
}

/// Undo an append that was cut off: the old tail of the file is put back. Returns whether anything was restored.
pub fn repair(path: &Path) -> io::Result<bool> {
    let tail = tail_path(path);
    let Ok(bytes) = std::fs::read(&tail) else {
        return Ok(false);
    };
    if bytes.len() < 8 {
        let _ = std::fs::remove_file(&tail);
        return Ok(false);
    }
    let cd_start = u64::from_le_bytes(bytes[..8].try_into().unwrap());
    let mut f = OpenOptions::new().write(true).open(path)?;
    f.set_len(cd_start)?;
    f.seek(SeekFrom::Start(cd_start))?;
    f.write_all(&bytes[8..])?;
    f.sync_all()?;
    std::fs::remove_file(&tail)?;
    Ok(true)
}

/// Open a package of the given kind (after `repair`). Only the central directory is read: no media is touched.
pub fn open(path: &Path, kind: &str) -> io::Result<Package> {
    let _ = repair(path);
    let mut zip = ZipArchive::new(io::BufReader::new(File::open(path)?)).map_err(zerr)?;
    // The manifest is the first entry; a newer one (a save raised the minor version) is the newest `meta/manifest.json.<n>`.
    let newest = (0..zip.len())
        .filter_map(|i| {
            let n = zip.name_for_index(i)?;
            n.strip_prefix("meta/manifest.json.")
                .and_then(|v| v.parse::<u64>().ok())
                .map(|v| (v, n.to_string()))
        })
        .max();
    let manifest: Manifest = {
        let mut m = zip
            .by_name(newest.as_ref().map_or(MANIFEST, |n| n.1.as_str()))
            .map_err(zerr)?;
        let mut text = Vec::new();
        m.read_to_end(&mut text)?;
        serde_json::from_slice(&text).map_err(io::Error::other)?
    };
    if manifest.version > VERSION_MAJOR {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "this project was made by a newer version of Snipmunk (format version {}, this one reads {})",
                manifest.version, VERSION_MAJOR
            ),
        ));
    }
    if manifest.format != kind {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("this is a {} file, not a {kind}", manifest.format),
        ));
    }
    let mut entries = HashMap::new();
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(zerr)?;
        entries.insert(f.name().to_string(), (f.data_start(), f.size()));
    }
    Ok(Package {
        path: path.to_path_buf(),
        manifest,
        entries,
    })
}

impl Package {
    /// The bytes of an entry (small entries only: media is read by range from `entries`).
    pub fn read(&self, name: &str) -> io::Result<Vec<u8>> {
        let (offset, len) = *self
            .entries
            .get(name)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, name.to_string()))?;
        read_range(&self.path, offset, len)
    }

    /// The newest version of a small item: `meta/<name>.<n>` with the highest `n`, else the plain entry.
    pub fn meta(&self, name: &str) -> io::Result<Vec<u8>> {
        let prefix = format!("meta/{name}.");
        let newest = self
            .entries
            .keys()
            .filter_map(|k| k.strip_prefix(&prefix).and_then(|n| n.parse::<u64>().ok()))
            .max();
        match newest {
            Some(n) => self.read(&format!("{prefix}{n}")),
            None => self.read(name),
        }
    }

    fn next_version(&self, name: &str) -> u64 {
        let prefix = format!("meta/{name}.");
        self.entries
            .keys()
            .filter_map(|k| k.strip_prefix(&prefix).and_then(|n| n.parse::<u64>().ok()))
            .max()
            .map_or(1, |n| n + 1)
    }
}

/// Read `len` bytes at `offset` of a file.
pub fn read_range(path: &Path, offset: u64, len: u64) -> io::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; len as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

/// Save small changes: each `(name, bytes)` is appended as a new version `meta/<name>.<n>`; the media is not touched, so this writes
/// kilobytes (plus the new central directory) however large the project is. A cut-off save is undone by `repair`.
pub fn append_meta(path: &Path, kind: &str, items: &[(String, Vec<u8>)]) -> io::Result<()> {
    let pkg = open(path, kind)?;
    let mut items = items.to_vec();
    // Effects that need a newer minor version raise it: a new manifest is saved the same way (the first entry stays as it was).
    let needed = items
        .iter()
        .filter(|(n, _)| n == "recording.json")
        .map(|(_, b)| minor_needed(b))
        .max()
        .unwrap_or(0);
    if needed > pkg.manifest.minor {
        let manifest = Manifest {
            minor: needed,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            ..pkg.manifest.clone()
        };
        items.push((
            "manifest.json".into(),
            serde_json::to_vec_pretty(&manifest).map_err(io::Error::other)?,
        ));
    }
    let versions: Vec<(String, Vec<u8>)> = items
        .iter()
        .map(|(n, b)| (format!("meta/{n}.{}", pkg.next_version(n)), b.clone()))
        .collect();
    // The old tail (central directory + end record) is kept in a side file until the new one is written.
    let cd_start = {
        let zip = ZipArchive::new(io::BufReader::new(File::open(path)?)).map_err(zerr)?;
        zip.central_directory_start()
    };
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(cd_start))?;
    let mut tail = cd_start.to_le_bytes().to_vec();
    file.read_to_end(&mut tail)?;
    drop(file);
    let side = tail_path(path);
    {
        let mut t = File::create(&side)?;
        t.write_all(&tail)?;
        t.sync_all()?;
    }
    let rw = OpenOptions::new().read(true).write(true).open(path)?;
    let mut zip = ZipWriter::new_append(rw).map_err(zerr)?;
    for (name, bytes) in &versions {
        zip.start_file(name, stored()).map_err(zerr)?;
        zip.write_all(bytes)?;
    }
    let out = zip.finish().map_err(zerr)?;
    out.sync_all()?;
    drop(out);
    std::fs::remove_file(&side)
}

/// Write the current content of a package as a new, compact package (the stale versions of small items are left out): "Save as".
pub fn compact(from: &Path, to: &Path, kind: &str) -> io::Result<()> {
    let pkg = open(from, kind)?;
    let mut names: Vec<&String> = pkg
        .entries
        .keys()
        .filter(|n| n.as_str() != MANIFEST && !n.starts_with("meta/"))
        .collect();
    names.sort();
    let mut sources: Vec<Source> = Vec::new();
    // Media entries are copied from the old file as they are; the newest version of every small item becomes the plain entry.
    let mut metas: Vec<String> = pkg
        .entries
        .keys()
        .filter_map(|k| {
            k.strip_prefix("meta/")
                .and_then(|r| r.rsplit_once('.'))
                .map(|(n, _)| n.to_string())
        })
        .collect();
    metas.retain(|n| n != "manifest.json");
    metas.sort();
    metas.dedup();
    for n in names {
        if metas.contains(n) {
            continue;
        }
        let (offset, len) = pkg.entries[n];
        sources.push(Source {
            name: n.clone(),
            data: Data::Bytes(Vec::new()),
        });
        // (large entries are streamed below to keep memory flat)
        let last = sources.last_mut().unwrap();
        last.data = Data::File(PathBuf::from(format!(
            "{}\u{0}{offset}\u{0}{len}",
            from.display()
        )));
    }
    for n in metas {
        sources.push(Source {
            name: n.clone(),
            data: Data::Bytes(pkg.meta(&n)?),
        });
    }
    // The manifest is carried over with every field in it (also those this version does not know); only the writer's version changes.
    let needed = pkg.meta("recording.json").map_or(0, |b| minor_needed(&b));
    let manifest = Manifest {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        minor: pkg.manifest.minor.max(needed),
        ..pkg.manifest.clone()
    };
    create_streaming(to, &manifest, &sources)
}

/// Like `create`, but a `Data::File` whose path holds `<file>\0<offset>\0<len>` is a range of another file.
fn create_streaming(path: &Path, manifest: &Manifest, sources: &[Source]) -> io::Result<()> {
    let tmp = {
        let mut s = path.as_os_str().to_os_string();
        s.push(format!(".part{}", std::process::id()));
        PathBuf::from(s)
    };
    let result = (|| -> io::Result<()> {
        let mut zip = ZipWriter::new(io::BufWriter::new(File::create(&tmp)?));
        zip.start_file(MANIFEST, stored()).map_err(zerr)?;
        zip.write_all(&serde_json::to_vec_pretty(manifest).map_err(io::Error::other)?)?;
        for s in sources {
            zip.start_file(&s.name, stored()).map_err(zerr)?;
            match &s.data {
                Data::Bytes(b) => zip.write_all(b)?,
                Data::File(p) => {
                    let text = p.to_string_lossy().into_owned();
                    let parts: Vec<&str> = text.split('\u{0}').collect();
                    if let [file, offset, len] = parts[..] {
                        let mut f = File::open(file)?;
                        f.seek(SeekFrom::Start(offset.parse().unwrap_or(0)))?;
                        io::copy(&mut f.take(len.parse().unwrap_or(0)), &mut zip)?;
                    } else {
                        io::copy(&mut File::open(p)?, &mut zip)?;
                    }
                }
            }
        }
        let mut out = zip.finish().map_err(zerr)?;
        out.flush()?;
        out.get_ref().sync_all()
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path)
}

// ---- commands -------------------------------------------------------------------------------------------------------------------

/// Save the recording `capture_id` as a project file at `path` (its screen video, sound tracks, cursor track and pictures, webcam
/// video, `recording.json` and the card picture as `thumbnail.png`). The file is written next to its target and renamed.
#[tauri::command]
pub async fn project_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::commands::AppState>,
    capture_id: String,
    path: String,
) -> crate::error::CmdResult<()> {
    let dir = state
        .sessions
        .lock()
        .unwrap()
        .recording_dir(&capture_id)
        .ok_or_else(|| crate::error::CmdError::new("not_found", "this recording does not exist"))?;
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || -> io::Result<()> {
        let mut sources = Vec::new();
        for name in [
            "screen.mp4",
            "system.wav",
            "mic.wav",
            "webcam.mp4",
            "cursor.jsonl",
            "recording.json",
        ] {
            if dir.join(name).is_file() {
                sources.push(Source {
                    name: name.to_string(),
                    data: Data::File(dir.join(name)),
                });
            }
        }
        if dir.join("first.png").is_file() {
            sources.push(Source {
                name: "thumbnail.png".into(),
                data: Data::File(dir.join("first.png")),
            });
        }
        if let Ok(rd) = std::fs::read_dir(dir.join("cursors")) {
            for e in rd.flatten() {
                if e.path().is_file() {
                    sources.push(Source {
                        name: format!("cursors/{}", e.file_name().to_string_lossy()),
                        data: Data::File(e.path()),
                    });
                }
            }
        }
        create(Path::new(&path), KIND_RECORDING, 1, &sources)
    })
    .await
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))?
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))?;
    // The current recording now counts as saved (it stays in temp until it is replaced).
    let session = {
        let mut store = state.sessions.lock().unwrap();
        let _ = store.set_saved_path(&capture_id, Path::new(&target));
        store.session().clone()
    };
    // The page learns that the recording is saved now (its header and the questions depend on it).
    let _ = tauri::Emitter::emit(&app, "session-changed", &session);
    Ok(())
}

/// What a project file holds: its manifest and the length of every entry (nothing is extracted).
#[tauri::command]
pub async fn project_info(path: String) -> crate::error::CmdResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || -> io::Result<serde_json::Value> {
        let p = open(Path::new(&path), KIND_RECORDING)?;
        let mut entries: Vec<(&String, &(u64, u64))> = p.entries.iter().collect();
        entries.sort();
        Ok(serde_json::json!({
            "manifest": p.manifest,
            "entries": entries.iter().map(|(n, (o, l))| serde_json::json!({"name": n, "offset": o, "length": l})).collect::<Vec<_>>(),
            "recording": serde_json::from_slice::<serde_json::Value>(&p.meta("recording.json")?).unwrap_or_default(),
        }))
    })
    .await
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))?
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))
}

/// Save the effects of an open project: appended as a small new version, whatever the size of the project.
#[tauri::command]
pub async fn project_set_effects(
    path: String,
    effects: crate::effects::Effects,
) -> crate::error::CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> io::Result<()> {
        let p = open(Path::new(&path), KIND_RECORDING)?;
        let mut doc: serde_json::Value =
            serde_json::from_slice(&p.meta("recording.json")?).unwrap_or_default();
        doc["effects"] = serde_json::to_value(effects.cleaned()).map_err(io::Error::other)?;
        drop(p);
        append_meta(
            Path::new(&path),
            KIND_RECORDING,
            &[(
                "recording.json".into(),
                serde_json::to_vec_pretty(&doc).map_err(io::Error::other)?,
            )],
        )
    })
    .await
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))?
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))
}

/// "Save as": a compact copy of a project (stale versions of small items are left out).
#[tauri::command]
pub async fn project_save_as(from: String, to: String) -> crate::error::CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        compact(Path::new(&from), Path::new(&to), KIND_RECORDING)
    })
    .await
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))?
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(dir: &Path) -> PathBuf {
        let video = dir.join("v.bin");
        std::fs::write(&video, vec![7u8; 100_000]).unwrap();
        let path = dir.join("p.snpr");
        create(
            &path,
            KIND_RECORDING,
            1,
            &[
                Source {
                    name: "screen.mp4".into(),
                    data: Data::File(video),
                },
                Source {
                    name: "recording.json".into(),
                    data: Data::Bytes(b"{\"v\":1}".to_vec()),
                },
            ],
        )
        .unwrap();
        path
    }

    #[test]
    fn a_package_is_one_stored_zip_with_a_manifest_and_media_that_can_be_read_by_offset() {
        let dir = tempfile::tempdir().unwrap();
        let path = sample(dir.path());
        let p = open(&path, KIND_RECORDING).unwrap();
        assert_eq!(p.manifest.format, "snipmunk.recording");
        assert_eq!(p.manifest.version, 1);
        let (offset, len) = p.entries["screen.mp4"];
        assert_eq!(len, 100_000);
        // The bytes in the file at that offset are the entry (stored, not compressed).
        let raw = read_range(&path, offset, 16).unwrap();
        assert_eq!(raw, vec![7u8; 16]);
        assert!(
            open(&path, "snipmunk.document").is_err(),
            "another kind is refused"
        );
        assert!(
            !dir.path().read_dir().unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".part")),
            "no temp file is left"
        );
    }

    #[test]
    fn a_small_change_appends_a_new_version_and_leaves_the_media_where_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let path = sample(dir.path());
        let before = open(&path, KIND_RECORDING).unwrap().entries["screen.mp4"];
        let size_before = std::fs::metadata(&path).unwrap().len();
        append_meta(
            &path,
            KIND_RECORDING,
            &[("recording.json".into(), b"{\"v\":2}".to_vec())],
        )
        .unwrap();
        append_meta(
            &path,
            KIND_RECORDING,
            &[("recording.json".into(), b"{\"v\":3}".to_vec())],
        )
        .unwrap();
        let p = open(&path, KIND_RECORDING).unwrap();
        assert_eq!(p.entries["screen.mp4"], before, "the video did not move");
        assert_eq!(p.meta("recording.json").unwrap(), b"{\"v\":3}");
        let grew = std::fs::metadata(&path).unwrap().len() - size_before;
        assert!(grew < 2_000, "two small saves added {grew} bytes");
        // Save as: the compact copy has the newest content and no stale versions.
        let copy = dir.path().join("copy.snpr");
        compact(&path, &copy, KIND_RECORDING).unwrap();
        let c = open(&copy, KIND_RECORDING).unwrap();
        assert_eq!(c.read("recording.json").unwrap(), b"{\"v\":3}");
        assert!(!c.entries.keys().any(|k| k.starts_with("meta/")));
        assert_eq!(c.read("screen.mp4").unwrap(), vec![7u8; 100_000]);
    }

    /// A package as a future version might make it: an extra manifest field, an extra entry, an extra small item.
    fn future_package(dir: &Path, major: u32, minor: u32) -> PathBuf {
        let path = dir.join("future.snpr");
        let manifest = serde_json::json!({
            "format": "snipmunk.recording", "version": major, "minor": minor, "appVersion": "9.9.9",
            "futureField": {"keep": [1, 2, 3]}
        });
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        for (name, bytes) in [
            (MANIFEST, serde_json::to_vec(&manifest).unwrap()),
            ("screen.mp4", vec![5u8; 300]),
            ("recording.json", b"{\"v\":1}".to_vec()),
            ("future/notes.bin", vec![1, 2, 3, 4]),
            ("meta/future.json.1", b"{\"f\":1}".to_vec()),
        ] {
            zip.start_file(name, stored()).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn unknown_manifest_fields_and_unknown_entries_survive_a_save_and_a_save_as() {
        let dir = tempfile::tempdir().unwrap();
        let path = future_package(dir.path(), 1, 7);
        // A newer minor version opens.
        let p = open(&path, KIND_RECORDING).unwrap();
        assert_eq!(p.manifest.minor, 7);
        drop(p);
        append_meta(
            &path,
            KIND_RECORDING,
            &[("recording.json".into(), b"{\"v\":2}".to_vec())],
        )
        .unwrap();
        let copy = dir.path().join("copy.snpr");
        compact(&path, &copy, KIND_RECORDING).unwrap();
        for file in [&path, &copy] {
            let p = open(file, KIND_RECORDING).unwrap();
            assert_eq!(
                p.manifest.extra["futureField"]["keep"],
                serde_json::json!([1, 2, 3]),
                "the unknown manifest field is kept"
            );
            assert_eq!(p.manifest.minor, 7, "the minor version of the file is kept");
            assert_eq!(
                p.read("future/notes.bin").unwrap(),
                vec![1, 2, 3, 4],
                "the unknown entry is kept"
            );
            assert_eq!(
                p.meta("future.json").unwrap(),
                b"{\"f\":1}",
                "an unknown small item is kept"
            );
            assert_eq!(p.meta("recording.json").unwrap(), b"{\"v\":2}");
        }
    }

    #[test]
    fn a_newer_major_version_is_refused_with_a_clear_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = future_package(dir.path(), 2, 0);
        let e = open(&path, KIND_RECORDING).err().unwrap();
        assert_eq!(e.kind(), io::ErrorKind::Unsupported);
        assert!(e.to_string().contains("newer version of Snipmunk"), "{e}");
    }

    #[test]
    fn a_save_that_was_cut_off_is_undone_at_the_next_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = sample(dir.path());
        // The start of an append: the side file is written and the old central directory is overwritten with garbage.
        let cd_start = {
            let zip = ZipArchive::new(File::open(&path).unwrap()).unwrap();
            zip.central_directory_start()
        };
        let mut tail = cd_start.to_le_bytes().to_vec();
        let mut f = File::open(&path).unwrap();
        f.seek(SeekFrom::Start(cd_start)).unwrap();
        f.read_to_end(&mut tail).unwrap();
        std::fs::write(tail_path(&path), &tail).unwrap();
        let mut w = OpenOptions::new().write(true).open(&path).unwrap();
        w.seek(SeekFrom::Start(cd_start)).unwrap();
        w.write_all(&[0xAB; 50]).unwrap();
        drop(w);
        assert!(
            ZipArchive::new(File::open(&path).unwrap()).is_err(),
            "the file is broken"
        );
        let p = open(&path, KIND_RECORDING).unwrap();
        assert_eq!(
            p.read("recording.json").unwrap(),
            b"{\"v\":1}",
            "the project is as it was"
        );
        assert!(!tail_path(&path).exists());
    }

    #[test]
    fn cuts_and_the_webcam_sync_raise_the_minor_version_when_they_are_saved() {
        let dir = tempfile::tempdir().unwrap();
        let path = sample(dir.path());
        assert_eq!(
            open(&path, KIND_RECORDING).unwrap().manifest.minor,
            0,
            "plain: 1.0"
        );
        let with_cuts = br#"{"effects":{"cuts":[{"startMs":1000,"endMs":2000}]}}"#.to_vec();
        append_meta(
            &path,
            KIND_RECORDING,
            &[("recording.json".into(), with_cuts.clone())],
        )
        .unwrap();
        let p = open(&path, KIND_RECORDING).unwrap();
        assert_eq!(p.manifest.minor, 1, "the saved manifest says 1.1");
        assert_eq!(p.meta("recording.json").unwrap(), with_cuts);
        // Save as keeps it, and a project that only has a sync is 1.1 too.
        let copy = dir.path().join("copy.snpr");
        compact(&path, &copy, KIND_RECORDING).unwrap();
        let c = open(&copy, KIND_RECORDING).unwrap();
        assert_eq!(c.manifest.minor, 1);
        assert!(
            !c.entries.keys().any(|k| k.contains("manifest.json.")),
            "no stale manifest versions in the copy"
        );
        assert_eq!(minor_needed(br#"{"effects":{"webcam":{"syncMs":-40}}}"#), 1);
        assert_eq!(
            minor_needed(br#"{"effects":{"webcam":{"syncMs":0},"cuts":[]}}"#),
            0
        );
        // A new package made from a recording with cuts starts at 1.1.
        let video = dir.path().join("v2.bin");
        std::fs::write(&video, [1u8; 10]).unwrap();
        let fresh = dir.path().join("fresh.snpr");
        create(
            &fresh,
            KIND_RECORDING,
            1,
            &[Source {
                name: "recording.json".into(),
                data: Data::Bytes(with_cuts),
            }],
        )
        .unwrap();
        assert_eq!(open(&fresh, KIND_RECORDING).unwrap().manifest.minor, 1);
    }
}
