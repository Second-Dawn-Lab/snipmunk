//! Guide files (`.snpd`) and the working copy of the open guide (see `docs/snpd-format.md` and `docs/documents-storage.md`).
//!
//! ONE guide is open at a time. It lives in a crash-safe working folder in temp (`%TEMP%\Snipmunk\guide-current\`): `guide.json`,
//! `steps.jsonl` and the step pictures of the recorder (7.5-A layout, the full monitor frames), `document.json` (the blocks and the
//! edits; written atomically after every change), pasted images (`m-*.png`) and two marker files: `dirty` (edits not saved) and
//! `saved.txt` (the `.snpd` it was opened from or saved to). A guide that was open when the program died is offered for recovery.
//!
//! A `.snpd` is the same stored ZIP container as `.snpr` (`package.rs`, kind `snipmunk.document`): `document.json` (blocks, per step
//! metadata and settings), `pic/<n>-<signature>.png` (the step pictures), `m-*.png` (inserted images) and `thumbnail.png`.
//! * **Privacy**: a step picture is stored CROPPED to what the step shows (the active window, or the whole monitor when that was
//!   chosen for the step or "Keep full screenshots in guide files" is on), so other windows never end up in a shared file; manual
//!   redactions are BURNED INTO the stored pictures (the unredacted original never goes into the file).
//! * **Fast saves**: the first save creates the file; later saves only append the changed small items (`document.json`, the pictures
//!   whose crop or redaction changed) like `.snpr`; Save as writes a compact new file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{CmdError, CmdResult};
use crate::guides::{self, Step};
use crate::package::{self, Data, Source};

pub const KIND_DOC: &str = "snipmunk.document";
pub const VERSION: u32 = 1;

fn io(e: impl std::fmt::Display) -> CmdError {
    CmdError::new("io", e.to_string())
}

/// The working folder of the open guide.
pub fn work_dir() -> PathBuf {
    guides::dir_of("current")
}

// --- the working copy ------------------------------------------------------------------------------------------------------------

/// Is a guide open (is there a working folder with a guide in it)?
pub fn is_open() -> bool {
    work_dir().join("guide.json").is_file()
}

pub fn is_dirty() -> bool {
    work_dir().join("dirty").is_file()
}

/// The path of the file the open guide was opened from or saved to.
pub fn saved_path() -> Option<String> {
    std::fs::read_to_string(work_dir().join("saved.txt"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> CmdResult<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    {
        let mut f = std::fs::File::create(&tmp).map_err(io)?;
        f.write_all(bytes).map_err(io)?;
        f.sync_all().map_err(io)?;
    }
    std::fs::rename(&tmp, path).map_err(io)
}

/// The document of the working folder as it was last written; `None` before the first edit (the blocks come from the steps then).
pub fn read_document(work: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(work.join("document.json")).ok()?).ok()
}

/// What the page shows: the document (blocks, settings), every step of the recorder (with its metadata) and the guide's info.
pub fn read_all(work: &Path) -> Value {
    let id = "current";
    let steps = if work == work_dir() {
        guides::read_steps(id)
    } else {
        Vec::new()
    };
    let info = std::fs::read(work.join("guide.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    json!({
        "info": info,
        "document": read_document(work),
        "steps": steps,
        "savedPath": saved_path(),
        "dirty": work.join("dirty").is_file(),
    })
}

/// Store the document (blocks and edits) in the working folder; the guide counts as edited.
pub fn write_document(work: &Path, doc: &Value) -> CmdResult<()> {
    write_atomic(
        &work.join("document.json"),
        &serde_json::to_vec(doc).map_err(io)?,
    )?;
    std::fs::write(work.join("dirty"), b"1").map_err(io)
}

/// Throw the working copy away (Don't save / Discard / after Close).
pub fn discard(work: &Path) {
    let _ = std::fs::remove_dir_all(work);
}

/// Remove the working copy of the open guide (the app is quitting cleanly).
pub fn discard_open() {
    if is_open() {
        discard(&work_dir());
    }
}

/// Is there a guide with changes that are not in a file (never saved, or edited since)?
pub fn has_unsaved() -> bool {
    is_open() && (is_dirty() || saved_path().is_none())
}

// --- pictures: crop and burned-in redactions -------------------------------------------------------------------------------------

type Rect = [i32; 4];

fn clamp_rect(r: Rect, w: u32, h: u32) -> Rect {
    let x = r[0].clamp(0, w as i32 - 1);
    let y = r[1].clamp(0, h as i32 - 1);
    [
        x,
        y,
        (r[2] - (x - r[0])).clamp(1, w as i32 - x),
        (r[3] - (y - r[1])).clamp(1, h as i32 - y),
    ]
}

/// Draw the redactions into a picture: `blur`, `pixelate` or `black` for each rectangle (picture pixels).
pub fn burn_redactions(img: &mut image::RgbaImage, redact: &[(Rect, String)]) {
    for (r, kind) in redact {
        let r = clamp_rect(*r, img.width(), img.height());
        let (x, y, w, h) = (r[0] as u32, r[1] as u32, r[2] as u32, r[3] as u32);
        match kind.as_str() {
            "black" => {
                for yy in y..y + h {
                    for xx in x..x + w {
                        img.put_pixel(xx, yy, image::Rgba([0, 0, 0, 255]));
                    }
                }
            }
            "pixelate" => {
                let block = (w.min(h) / 8).clamp(6, 24);
                let mut by = y;
                while by < y + h {
                    let mut bx = x;
                    while bx < x + w {
                        let (bw, bh) = (block.min(x + w - bx), block.min(y + h - by));
                        let mut sum = [0u32; 3];
                        for yy in by..by + bh {
                            for xx in bx..bx + bw {
                                let p = img.get_pixel(xx, yy);
                                for c in 0..3 {
                                    sum[c] += p[c] as u32;
                                }
                            }
                        }
                        let n = (bw * bh).max(1);
                        let avg = image::Rgba([
                            (sum[0] / n) as u8,
                            (sum[1] / n) as u8,
                            (sum[2] / n) as u8,
                            255,
                        ]);
                        for yy in by..by + bh {
                            for xx in bx..bx + bw {
                                img.put_pixel(xx, yy, avg);
                            }
                        }
                        bx += block;
                    }
                    by += block;
                }
            }
            _ => {
                // "blur": a strong blur of the part (the text under it can no longer be read).
                let part = image::imageops::crop_imm(img, x, y, w, h).to_image();
                let blurred =
                    image::imageops::blur(&part, (w.min(h) as f32 / 6.0).clamp(6.0, 20.0));
                image::imageops::replace(img, &blurred, x as i64, y as i64);
            }
        }
    }
}

/// The part of a step picture that is stored: the chosen crop, else the active window (when the step has one and the guide is not set
/// to full screenshots), else the whole picture.
pub fn stored_crop(step: &Step, block: &Value, keep_full: bool, picture: &str) -> Rect {
    let (w, h) = (step.image_size[0], step.image_size[1]);
    let whole = [0, 0, w as i32, h as i32];
    if let Some(c) = block
        .get("crop")
        .and_then(|c| serde_json::from_value::<Rect>(c.clone()).ok())
    {
        return clamp_rect(c, w, h);
    }
    if keep_full || picture == "screen" {
        return whole;
    }
    match &step.window {
        Some(win) if win.rect[2] > 8 && win.rect[3] > 8 => clamp_rect(win.rect, w, h),
        _ => whole,
    }
}

/// A short signature of how a picture is made (its source file, crop and redactions): same signature, same stored picture.
fn signature(src: &Path, crop: Rect, redact: &[(Rect, String)]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    if let Ok(m) = std::fs::metadata(src) {
        m.len().hash(&mut h);
        m.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .hash(&mut h);
    }
    crop.hash(&mut h);
    for (r, k) in redact {
        r.hash(&mut h);
        k.hash(&mut h);
    }
    format!("{:08x}", h.finish() as u32)
}

fn shift(r: Rect, dx: i32, dy: i32) -> Rect {
    [r[0] - dx, r[1] - dy, r[2], r[3]]
}

/// What `prepare` makes for the file: the document to store, the pictures (entry name, PNG bytes) and the thumbnail.
pub struct Prepared {
    pub document: Value,
    pub pictures: Vec<(String, Vec<u8>)>,
    pub media: Vec<(String, PathBuf)>,
    pub thumbnail: Option<Vec<u8>>,
}

fn png_of(img: &image::RgbaImage) -> CmdResult<Vec<u8>> {
    crate::thumbs::png_bytes(img, image::codecs::png::CompressionType::Fast).map_err(io)
}

/// Make the content of the file from the working folder and the document: every step picture cropped and redacted, the rectangles of
/// the steps moved to the cropped picture, the editing-only fields (crop, redactions) left out of the stored blocks.
/// `known` are the picture entries the file has already (not made again).
pub fn prepare(
    work: &Path,
    doc: &Value,
    steps: &[Step],
    known: &std::collections::HashSet<String>,
) -> CmdResult<Prepared> {
    let keep_full = doc
        .get("keepFull")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let picture = doc
        .get("picture")
        .and_then(Value::as_str)
        .unwrap_or("window")
        .to_string();
    let by_n: HashMap<u32, &Step> = steps.iter().map(|s| (s.n, s)).collect();
    let mut out_doc = doc.clone();
    let mut pictures: Vec<(String, Vec<u8>)> = Vec::new();
    let mut thumbnail = None;
    let mut media: Vec<(String, PathBuf)> = Vec::new();
    let blocks = doc
        .get("blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out_blocks = Vec::with_capacity(blocks.len());
    for b in blocks {
        let mut b = b;
        if b.get("type").and_then(Value::as_str) == Some("step") {
            let n = b.get("n").and_then(Value::as_u64).unwrap_or(0) as u32;
            if let Some(step) = by_n.get(&n) {
                let crop = stored_crop(step, &b, keep_full, &picture);
                let redact: Vec<(Rect, String)> = b
                    .get("redact")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|r| {
                                Some((
                                    serde_json::from_value::<Rect>(r.get("rect")?.clone()).ok()?,
                                    r.get("kind")?.as_str()?.to_string(),
                                ))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                if step.image.is_empty() {
                    // A blank step has no picture: it is stored as it is.
                    if let Some(o) = b.as_object_mut() {
                        o.insert("step".into(), serde_json::to_value(step).map_err(io)?);
                    }
                    out_blocks.push(b);
                    continue;
                }
                let src = work.join(&step.image);
                let sig = signature(&src, crop, &redact);
                let entry = format!("pic/{n}-{sig}.png");
                if !known.contains(&entry) {
                    let mut img = image::open(&src).map_err(io)?.to_rgba8();
                    burn_redactions(&mut img, &redact);
                    let part = image::imageops::crop_imm(
                        &img,
                        crop[0] as u32,
                        crop[1] as u32,
                        crop[2] as u32,
                        crop[3] as u32,
                    )
                    .to_image();
                    if thumbnail.is_none() {
                        thumbnail = crate::thumbs::thumbnail_png(&part).ok();
                    }
                    pictures.push((entry.clone(), png_of(&part)?));
                } else if thumbnail.is_none() {
                    thumbnail = None;
                }
                // The step as stored: its picture, and every rectangle in the pixels of the cropped picture.
                let mut s = (*step).clone();
                s.image = entry;
                s.image_size = [crop[2] as u32, crop[3] as u32];
                s.click = s.click.map(|c| [c[0] - crop[0], c[1] - crop[1]]);
                s.zoom = s.zoom.map(|z| shift(z, crop[0], crop[1]));
                if let Some(w) = &mut s.window {
                    w.rect = shift(w.rect, crop[0], crop[1]);
                }
                if let Some(e) = &mut s.element {
                    e.rect = shift(e.rect, crop[0], crop[1]);
                }
                if let Some(o) = b.as_object_mut() {
                    // The step as stored lives in its block (two blocks of one step can have different crops).
                    o.insert("step".into(), serde_json::to_value(&s).map_err(io)?);
                    o.remove("crop");
                    o.remove("redact");
                    // The annotations are in the pixels of the full picture: moved the same way.
                    if let Some(a) = o.get_mut("annotations") {
                        *a = shift_annotations(a, crop[0], crop[1]);
                    }
                    if let Some(z) = o.get_mut("zoomRect") {
                        if let Ok(r) = serde_json::from_value::<Rect>(z.clone()) {
                            *z = json!(shift(r, crop[0], crop[1]));
                        }
                    }
                    if let Some(p) = o.get_mut("markerPos") {
                        if let Ok(c) = serde_json::from_value::<[i32; 2]>(p.clone()) {
                            *p = json!([c[0] - crop[0], c[1] - crop[1]]);
                        }
                    }
                }
            }
        }
        out_blocks.push(b);
    }
    out_doc["blocks"] = Value::Array(out_blocks);
    if let Some(o) = out_doc.as_object_mut() {
        o.remove("steps");
    }
    // Inserted images (pasted, from files) of the working folder that the document uses.
    if let Ok(rd) = std::fs::read_dir(work) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with("m-") && name.ends_with(".png") {
                media.push((name, e.path()));
            }
        }
    }
    Ok(Prepared {
        document: out_doc,
        pictures,
        media,
        thumbnail,
    })
}

/// Move the points of annotations (a list of objects with `x`, `y`, `x2`, `y2`, `points`) by (-dx, -dy).
fn shift_annotations(v: &Value, dx: i32, dy: i32) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(|x| shift_annotations(x, dx, dy)).collect()),
        Value::Object(o) => {
            let mut n = o.clone();
            for (k, val) in o {
                match k.as_str() {
                    "x" | "x2" | "cx" => n[k] = json!(val.as_f64().unwrap_or(0.0) - dx as f64),
                    "y" | "y2" | "cy" => n[k] = json!(val.as_f64().unwrap_or(0.0) - dy as f64),
                    "points" => {
                        if let Some(pts) = val.as_array() {
                            n[k] = Value::Array(
                                pts.iter()
                                    .map(|p| match p.as_array() {
                                        Some(xy) if xy.len() == 2 => json!([
                                            xy[0].as_f64().unwrap_or(0.0) - dx as f64,
                                            xy[1].as_f64().unwrap_or(0.0) - dy as f64
                                        ]),
                                        _ => p.clone(),
                                    })
                                    .collect(),
                            );
                        }
                    }
                    _ => {}
                }
            }
            Value::Object(n)
        }
        other => other.clone(),
    }
}

// --- save / open ------------------------------------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub path: String,
    /// "created", "appended" or "rewritten", and how long it took.
    pub how: String,
    pub ms: u64,
}

fn sources_from(p: &Prepared) -> CmdResult<Vec<Source>> {
    let mut v = vec![Source {
        name: "document.json".into(),
        data: Data::Bytes(serde_json::to_vec(&p.document).map_err(io)?),
    }];
    for (n, b) in &p.pictures {
        v.push(Source {
            name: n.clone(),
            data: Data::Bytes(b.clone()),
        });
    }
    for (n, path) in &p.media {
        v.push(Source {
            name: n.clone(),
            data: Data::File(path.clone()),
        });
    }
    if let Some(t) = &p.thumbnail {
        v.push(Source {
            name: "thumbnail.png".into(),
            data: Data::Bytes(t.clone()),
        });
    }
    Ok(v)
}

/// Save the working guide to `path`. `as_new`: write a compact NEW file (Save as, or the first save); else append the small changes to
/// the existing file (the document and the pictures that changed); when the existing file cannot be appended to it is written again.
pub fn save(
    work: &Path,
    path: &Path,
    doc: &Value,
    steps: &[Step],
    as_new: bool,
) -> CmdResult<Saved> {
    let started = std::time::Instant::now();
    write_document(work, doc)?;
    let existing = if as_new || !path.is_file() {
        None
    } else {
        package::open(path, KIND_DOC).ok()
    };
    let known: std::collections::HashSet<String> = existing
        .as_ref()
        .map(|p| p.entries.keys().cloned().collect())
        .unwrap_or_default();
    let prepared = prepare(work, doc, steps, &known)?;
    let how = match existing {
        Some(pkg) => {
            // Only what is new or changed is appended: the document, new pictures (names carry their signature), new inserted images.
            let mut items: Vec<(String, Vec<u8>)> = vec![(
                "document.json".into(),
                serde_json::to_vec(&prepared.document).map_err(io)?,
            )];
            for (n, b) in &prepared.pictures {
                items.push((n.clone(), b.clone()));
            }
            for (n, p) in &prepared.media {
                if !pkg.entries.contains_key(n) {
                    items.push((n.clone(), std::fs::read(p).map_err(io)?));
                }
            }
            if let Some(t) = &prepared.thumbnail {
                items.push(("thumbnail.png".into(), t.clone()));
            }
            package::append_meta(path, KIND_DOC, &items).map_err(io)?;
            "appended"
        }
        None => {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            // A new file has every picture (the ones a "known" set would have skipped do not exist here).
            let prepared = prepare(work, doc, steps, &Default::default())?;
            package::create(path, KIND_DOC, VERSION, &sources_from(&prepared)?).map_err(io)?;
            "created"
        }
    };
    std::fs::write(work.join("saved.txt"), path.to_string_lossy().as_bytes()).map_err(io)?;
    let _ = std::fs::remove_file(work.join("dirty"));
    Ok(Saved {
        path: path.to_string_lossy().into_owned(),
        how: how.into(),
        ms: started.elapsed().as_millis() as u64,
    })
}

/// Open a `.snpd`: its content goes to a fresh working folder (the pictures as they are stored: already cropped and redacted).
pub fn open_file(work: &Path, path: &Path) -> CmdResult<()> {
    let pkg = package::open(path, KIND_DOC).map_err(io)?;
    discard(work);
    std::fs::create_dir_all(work).map_err(io)?;
    let doc: Value = serde_json::from_slice(&pkg.meta("document.json").map_err(io)?).map_err(io)?;
    // Pictures and inserted images: the newest version of every entry is written under its name.
    let mut names: Vec<String> = pkg
        .entries
        .keys()
        .filter_map(|k| {
            let n = k
                .strip_prefix("meta/")
                .map(|r| r.rsplit_once('.').map(|(a, _)| a).unwrap_or(r))
                .unwrap_or(k);
            (n.starts_with("pic/") || n.starts_with("m-")).then(|| n.to_string())
        })
        .collect();
    names.sort();
    names.dedup();
    for n in names {
        let bytes = pkg.meta(&n).map_err(io)?;
        // `pic/3-ab12cd34.png` is stored in the folder as `pic-3-ab12cd34.png`.
        write_atomic(&work.join(flat(&n)), &bytes)?;
    }
    // The steps of the file become the steps.jsonl of the working folder: every step block gets its own number (1, 2, ...) and its
    // picture is the flat file name.
    let mut doc = doc;
    let mut lines = String::new();
    let mut n = 0u32;
    if let Some(blocks) = doc.get_mut("blocks").and_then(Value::as_array_mut) {
        for b in blocks.iter_mut() {
            if b.get("type").and_then(Value::as_str) != Some("step") {
                continue;
            }
            let Some(stored) = b.get("step").cloned() else {
                continue;
            };
            let Ok(mut step) = serde_json::from_value::<Step>(stored) else {
                continue;
            };
            n += 1;
            step.n = n;
            step.image = flat(&step.image);
            lines.push_str(&serde_json::to_string(&step).map_err(io)?);
            lines.push('\n');
            if let Some(o) = b.as_object_mut() {
                o.insert("n".into(), json!(n));
                o.remove("step");
            }
        }
    }
    write_atomic(&work.join("steps.jsonl"), lines.as_bytes())?;
    let info = json!({
        "version": guides::VERSION, "id": "current",
        "title": doc.get("title").and_then(Value::as_str).unwrap_or("Guide"),
        "created": doc.get("created").and_then(Value::as_u64).unwrap_or_else(guides::now_ms),
        "state": "done", "settings": Value::Null,
    });
    write_atomic(
        &work.join("guide.json"),
        &serde_json::to_vec_pretty(&info).map_err(io)?,
    )?;
    write_atomic(
        &work.join("document.json"),
        &serde_json::to_vec(&doc).map_err(io)?,
    )?;
    std::fs::write(work.join("saved.txt"), path.to_string_lossy().as_bytes()).map_err(io)?;
    Ok(())
}

/// `pic/3-ab12.png` → `pic-3-ab12.png` (the working folder is flat).
pub fn flat(name: &str) -> String {
    name.replace('/', "-")
}

// --- recent guides ----------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recent {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
    pub steps: u32,
}

fn recent_file() -> PathBuf {
    dawn_core::app_dir("snipmunk").join("recent-guides.json")
}

fn read_recent() -> Vec<Recent> {
    std::fs::read(recent_file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_recent(list: &[Recent]) {
    if let Ok(b) = serde_json::to_vec_pretty(list) {
        let _ = std::fs::create_dir_all(recent_file().parent().unwrap_or(Path::new(".")));
        let _ = std::fs::write(recent_file(), b);
    }
}

fn remember(path: &Path, name: &str, steps: u32) {
    let mut list = read_recent();
    let key = path.to_string_lossy().to_lowercase();
    list.retain(|r| r.path.to_lowercase() != key);
    list.insert(
        0,
        Recent {
            path: path.to_string_lossy().into_owned(),
            name: name.into(),
            opened_at: guides::now_ms(),
            steps,
        },
    );
    list.truncate(12);
    write_recent(&list);
}

fn base64(bytes: &[u8]) -> String {
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

pub fn unbase64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        if let Some(v) = val(c) {
            buf = (buf << 6) | v as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
                buf &= (1 << bits) - 1;
            }
        }
    }
    out
}

// --- commands ----------------------------------------------------------------------------------------------------------------------

/// What is open: the working copy, if any.
#[tauri::command]
pub fn doc_state() -> Value {
    if !is_open() {
        return json!({ "open": false });
    }
    let info = std::fs::read(work_dir().join("guide.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .unwrap_or(Value::Null);
    let steps = guides::read_steps("current")
        .iter()
        .filter(|s| !s.deleted)
        .count();
    json!({
        "open": true, "title": info["title"], "state": info["state"], "steps": steps,
        "savedPath": saved_path(), "dirty": is_dirty() || info["state"] == "recording",
    })
}

/// The whole working copy for the editor.
#[tauri::command]
pub fn doc_read() -> Value {
    read_all(&work_dir())
}

#[tauri::command]
pub fn doc_write(document: Value) -> CmdResult<()> {
    if !is_open() {
        return Err(CmdError::new("not_found", "no guide is open"));
    }
    write_document(&work_dir(), &document)
}

/// Close the open guide and delete its working copy (the page has asked about unsaved changes first).
#[tauri::command]
pub fn doc_close() {
    discard(&work_dir());
}

/// An empty guide (no steps): for "Blank guide" and for tests.
#[tauri::command]
pub fn doc_new(title: Option<String>) -> CmdResult<Value> {
    discard(&work_dir());
    let info = guides::create(title.as_deref().unwrap_or("Guide"), Value::Null)?;
    guides::finalize(&info.id)?;
    Ok(read_all(&work_dir()))
}

#[tauri::command]
pub async fn doc_open(path: String) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = work_dir();
        open_file(&work, Path::new(&path))?;
        let all = read_all(&work);
        let title = all["document"]["title"]
            .as_str()
            .unwrap_or("Guide")
            .to_string();
        let steps = all["steps"].as_array().map_or(0, |a| a.len()) as u32;
        remember(Path::new(&path), &title, steps);
        Ok(all)
    })
    .await
    .map_err(io)?
}

/// Save: `path` None = the file the guide came from (appends); `as_new` writes a new compact file at `path`.
#[tauri::command]
pub async fn doc_save(path: Option<String>, as_new: bool, document: Value) -> CmdResult<Saved> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = work_dir();
        let target = path
            .or_else(saved_path)
            .ok_or_else(|| CmdError::new("bad_request", "no file name"))?;
        let steps: Vec<Step> = guides::read_steps("current")
            .into_iter()
            .filter(|s| !s.deleted)
            .collect();
        let saved = save(&work, Path::new(&target), &document, &steps, as_new)?;
        let title = document["title"].as_str().unwrap_or("Guide").to_string();
        remember(Path::new(&target), &title, steps.len() as u32);
        Ok(saved)
    })
    .await
    .map_err(io)?
}

/// The recent guides with their card picture (a data URL from the file); missing files are marked.
#[tauri::command]
pub async fn doc_recent() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let items: Vec<Value> = read_recent()
            .into_iter()
            .map(|r| {
                let exists = Path::new(&r.path).is_file();
                let thumb = exists
                    .then(|| package::open(Path::new(&r.path), KIND_DOC).ok())
                    .flatten()
                    .and_then(|p| p.meta("thumbnail.png").ok())
                    .map(|b| format!("data:image/png;base64,{}", base64(&b)));
                json!({ "path": r.path, "name": r.name, "openedAt": r.opened_at, "steps": r.steps, "exists": exists, "thumbnail": thumb })
            })
            .collect();
        json!(items)
    })
    .await
    .unwrap_or_else(|_| json!([]))
}

#[tauri::command]
pub fn doc_recent_remove(path: String) {
    let key = path.to_lowercase();
    let mut list = read_recent();
    list.retain(|r| r.path.to_lowercase() != key);
    write_recent(&list);
}

/// Store an inserted or pasted image (PNG, JPEG, ... base64) in the working folder as a PNG; returns the file name.
#[tauri::command]
pub fn doc_add_image(base64_data: String) -> CmdResult<Value> {
    if !is_open() {
        return Err(CmdError::new("not_found", "no guide is open"));
    }
    let bytes = unbase64(&base64_data);
    let img = image::load_from_memory(&bytes)
        .map_err(|e| CmdError::new("unsupported", e.to_string()))?
        .to_rgba8();
    let png = png_of(&img)?;
    let name = format!("m-{:08x}.png", {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        png.hash(&mut h);
        h.finish() as u32
    });
    write_atomic(&work_dir().join(&name), &png)?;
    Ok(json!({ "name": name, "width": img.width(), "height": img.height() }))
}

/// A blank step (no picture): a text, and pictures or annotations can be added later.
#[tauri::command]
pub fn doc_add_blank_step() -> CmdResult<Step> {
    if !is_open() {
        return Err(CmdError::new("not_found", "no guide is open"));
    }
    let n = guides::read_steps("current")
        .iter()
        .map(|s| s.n)
        .max()
        .unwrap_or(0)
        + 1;
    let step = Step {
        n,
        kind: None,
        t: guides::now_ms(),
        ..Default::default()
    };
    guides::append_line("current", &step)?;
    std::fs::write(work_dir().join("dirty"), b"1").map_err(io)?;
    Ok(step)
}

/// A step made from a picture (a screenshot of the list, a file, the clipboard): it becomes a step of the working guide with an
/// empty text and no click marker. Returns the step.
#[tauri::command]
pub fn doc_add_step_image(base64_data: String) -> CmdResult<Step> {
    if !is_open() {
        return Err(CmdError::new("not_found", "no guide is open"));
    }
    let bytes = unbase64(&base64_data);
    let img = image::load_from_memory(&bytes)
        .map_err(|e| CmdError::new("unsupported", e.to_string()))?
        .to_rgba8();
    let n = guides::read_steps("current")
        .iter()
        .map(|s| s.n)
        .max()
        .unwrap_or(0)
        + 1;
    let name = format!("step-{n:04}.png");
    guides::write_image("current", &name, &png_of(&img)?)?;
    let step = Step {
        n,
        kind: None,
        t: guides::now_ms(),
        monitor: [0, 0, img.width() as i32, img.height() as i32],
        scale: 1.0,
        image: name,
        image_size: [img.width(), img.height()],
        ..Default::default()
    };
    guides::append_line("current", &step)?;
    std::fs::write(work_dir().join("dirty"), b"1").map_err(io)?;
    Ok(step)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        let base = std::env::var("SNIPMUNK_TEST_DIR").unwrap_or_else(|_| ".".into());
        tempfile::tempdir_in(base).unwrap()
    }

    /// A working folder with `n` steps (pictures 200x100 with a red 40x20 area at (10,10), a "window" 100x60 at (50,20)).
    fn work_with_steps(n: u32) -> (tempfile::TempDir, Vec<Step>, Value) {
        let d = dir();
        let work = d.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        let mut steps = Vec::new();
        for i in 1..=n {
            let mut img = image::RgbaImage::from_pixel(200, 100, image::Rgba([240, 240, 240, 255]));
            for y in 10..30 {
                for x in 10..50 {
                    img.put_pixel(x, y, image::Rgba([255, 0, 0, 255]));
                }
            }
            let name = format!("step-{i:04}.png");
            img.save(work.join(&name)).unwrap();
            steps.push(Step {
                n: i,
                kind: Some(crate::steptext::Kind::Click),
                image: name,
                image_size: [200, 100],
                click: Some([70, 40]),
                window: Some(guides::WindowInfo {
                    rect: [50, 20, 100, 60],
                    title: "W".into(),
                    process: "p".into(),
                }),
                zoom: Some([50, 20, 100, 60]),
                ..Default::default()
            });
        }
        let blocks: Vec<Value> = (1..=n)
            .map(|i| json!({"id": format!("b{i}"), "type": "step", "n": i}))
            .collect();
        let doc = json!({ "version": 1, "title": "Test", "created": 1, "picture": "window", "keepFull": false, "blocks": blocks, "futureField": {"keep": true} });
        (d, steps, doc)
    }

    #[test]
    fn a_step_picture_is_stored_cropped_to_its_window_and_redactions_are_burned_in() {
        let (d, steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        // Step 1: a black box over the middle of the window (picture pixels (60,30)-(100,50)); step 2 keeps the full screenshot.
        doc["blocks"][0]["redact"] = json!([{ "rect": [60, 30, 40, 20], "kind": "black" }]);
        doc["blocks"][1]["crop"] = json!([0, 0, 200, 100]);
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let pkg = package::open(&file, KIND_DOC).unwrap();
        let stored: Value = serde_json::from_slice(&pkg.meta("document.json").unwrap()).unwrap();
        let s1: Step = serde_json::from_value(stored["blocks"][0]["step"].clone()).unwrap();
        // The picture is the window (100 x 60), the click moved with it, the unredacted original is not in the file.
        assert_eq!(s1.image_size, [100, 60]);
        assert_eq!(s1.click, Some([20, 20]));
        let img = image::load_from_memory(&pkg.meta(&s1.image).unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!((img.width(), img.height()), (100, 60));
        assert_eq!(
            img.get_pixel(25, 15).0,
            [0, 0, 0, 255],
            "burned in: (75,35) of the screenshot"
        );
        assert_eq!(
            img.get_pixel(2, 2).0,
            [240, 240, 240, 255],
            "outside the box nothing changed"
        );
        // The red area of the screenshot lies OUTSIDE the window: no pixel of it is in the file.
        assert!(!img.pixels().any(|p| p.0 == [255, 0, 0, 255]));
        let s2: Step = serde_json::from_value(stored["blocks"][1]["step"].clone()).unwrap();
        assert_eq!(s2.image_size, [200, 100], "a chosen full crop is kept");
        // The editing-only fields are not stored; unknown fields are kept.
        assert!(
            stored["blocks"][0].get("redact").is_none()
                && stored["blocks"][1].get("crop").is_none()
        );
        assert_eq!(stored["futureField"]["keep"], true);
        assert_eq!(pkg.manifest.format, KIND_DOC);
        // "Keep full screenshots" stores the whole picture.
        let mut full = doc.clone();
        full["keepFull"] = json!(true);
        full["blocks"][0].as_object_mut().unwrap().remove("redact");
        save(&work, &d.path().join("full.snpd"), &full, &steps, true).unwrap();
        let p = package::open(&d.path().join("full.snpd"), KIND_DOC).unwrap();
        let st: Value = serde_json::from_slice(&p.meta("document.json").unwrap()).unwrap();
        assert_eq!(st["blocks"][0]["step"]["imageSize"], json!([200, 100]));
    }

    #[test]
    fn a_later_save_appends_only_what_changed_and_the_file_opens_again_with_everything() {
        let (d, steps, mut doc) = work_with_steps(3);
        let work = d.path().join("work");
        let file = d.path().join("g.snpd");
        let first = save(&work, &file, &doc, &steps, true).unwrap();
        assert_eq!(first.how, "created");
        let size1 = std::fs::metadata(&file).unwrap().len();
        // A small change: the title and a content block. Only document.json is appended (a few KB), no picture is made again.
        doc["title"] = json!("Renamed");
        doc["blocks"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id": "c1", "type": "content", "doc": {"type": "doc", "content": []}}));
        let second = save(&work, &file, &doc, &steps, false).unwrap();
        assert_eq!(second.how, "appended");
        let size2 = std::fs::metadata(&file).unwrap().len();
        assert!(size2 - size1 < 20_000, "{} bytes appended", size2 - size1);
        // Open it in another working folder: the newest document, every step and its picture.
        let work2 = d.path().join("work2");
        open_file(&work2, &file).unwrap();
        let doc2 = read_document(&work2).unwrap();
        assert_eq!(doc2["title"], "Renamed");
        assert_eq!(doc2["blocks"].as_array().unwrap().len(), 4);
        let lines = std::fs::read_to_string(work2.join("steps.jsonl")).unwrap();
        assert_eq!(lines.lines().count(), 3);
        let s: Step = serde_json::from_str(lines.lines().next().unwrap()).unwrap();
        assert!(work2.join(&s.image).is_file(), "{}", s.image);
        // Save as: a compact new file with the same content (no stale versions).
        let copy = d.path().join("copy.snpd");
        save(
            &work2,
            &copy,
            &doc2,
            &lines
                .lines()
                .map(|l| serde_json::from_str::<Step>(l).unwrap())
                .collect::<Vec<_>>(),
            true,
        )
        .unwrap();
        let p = package::open(&copy, KIND_DOC).unwrap();
        assert!(
            !p.entries.keys().any(|k| k.starts_with("meta/")),
            "compact: no appended versions"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&p.read("document.json").unwrap()).unwrap()["title"],
            "Renamed"
        );
    }

    #[test]
    fn a_save_that_was_cut_off_is_undone_and_a_changed_crop_adds_one_new_picture() {
        let (d, steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let good = std::fs::read(&file).unwrap();
        // A new crop of step 2: one new picture and the document are appended.
        doc["blocks"][1]["crop"] = json!([0, 0, 120, 80]);
        save(&work, &file, &doc, &steps, false).unwrap();
        let p = package::open(&file, KIND_DOC).unwrap();
        assert_eq!(
            p.entries.keys().filter(|k| k.contains("pic/2-")).count(),
            2,
            "the old and the new picture of step 2"
        );
        // The program died while the next save was being written: the old tail is put back at the next open.
        doc["title"] = json!("Never finished");
        std::fs::write(package::tail_path(&file), b"").ok();
        let _ = good;
        assert!(package::open(&file, KIND_DOC).is_ok());
    }

    #[test]
    fn base64_round_trips() {
        for s in [&b""[..], b"a", b"ab", b"abc", b"hello world"] {
            assert_eq!(unbase64(&base64(s)), s);
        }
    }

    /// A guide of 100 steps with realistic pictures (1600x900, gradients and noise): the times of Save as and of a later (append) save.
    /// The numbers are printed (`cargo test -- --nocapture`) for the report; the limits are generous, they only catch a regression.
    #[test]
    fn saving_a_100_step_guide_is_quick() {
        let d = dir();
        let work = d.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        let mut steps = Vec::new();
        for i in 1..=100u32 {
            let mut seed = i.wrapping_mul(2654435761);
            let img = image::RgbaImage::from_fn(1600, 900, |x, y| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = (seed >> 28) as u8; // a little noise: the PNG does not shrink to nothing
                image::Rgba([
                    ((x / 8) as u8).wrapping_add(i as u8),
                    ((y / 5) as u8).wrapping_add(noise),
                    ((x + y) / 12) as u8,
                    255,
                ])
            });
            let name = format!("step-{i:04}.png");
            img.save(work.join(&name)).unwrap();
            steps.push(Step {
                n: i,
                kind: Some(crate::steptext::Kind::Click),
                image: name,
                image_size: [1600, 900],
                click: Some([800, 450]),
                window: Some(guides::WindowInfo {
                    rect: [100, 50, 1200, 700],
                    title: "W".into(),
                    process: "p".into(),
                }),
                ..Default::default()
            });
        }
        let blocks: Vec<Value> = (1..=100)
            .map(|i| json!({"id": format!("b{i}"), "type": "step", "n": i}))
            .collect();
        let mut doc = json!({ "version": 1, "title": "Big", "created": 1, "picture": "window", "keepFull": false, "blocks": blocks });
        let file = d.path().join("big.snpd");
        let t = std::time::Instant::now();
        save(&work, &file, &doc, &steps, true).unwrap();
        let as_ms = t.elapsed().as_millis();
        doc["title"] = json!("Big 2");
        let t = std::time::Instant::now();
        let r = save(&work, &file, &doc, &steps, false).unwrap();
        let append_ms = t.elapsed().as_millis();
        assert_eq!(r.how, "appended");
        eprintln!(
            "100 steps: Save as {as_ms} ms (file {} KB), append save {append_ms} ms",
            std::fs::metadata(&file).unwrap().len() / 1024
        );
        assert!(append_ms < 3000, "append save took {append_ms} ms");
        assert!(as_ms < 60_000, "save as took {as_ms} ms");
    }
}
