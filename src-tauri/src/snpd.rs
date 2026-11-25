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

/// The part of the picture a framed step shows (the template's ratio, the step's `frame` {cx, cy, w}), clipped to the picture;
/// `None` when the guide has no frame or the step has no place of its own. The same rules as `src/docs/template/frame.ts`.
pub fn framed_area(doc: &Value, block: &Value, size: [u32; 2]) -> Option<Rect> {
    let f = &doc["template"]["frame"];
    let ratio = match f["ratio"].as_str()? {
        "original" => return None,
        "custom" => f["w"].as_f64()? / f["h"].as_f64()?,
        other => {
            let (w, h) = other.split_once(':')?;
            w.parse::<f64>().ok()? / h.parse::<f64>().ok()?
        }
    };
    if !ratio.is_finite() || ratio <= 0.0 {
        return None;
    }
    let place = &block["frame"];
    // A zoom made in a picture without a frame is no place in this one.
    if place["own"] == json!(true) {
        return None;
    }
    let (cx, cy, w) = (
        place["cx"].as_f64()?,
        place["cy"].as_f64()?,
        place["w"].as_f64()?.max(16.0),
    );
    let h = w / ratio;
    let (iw, ih) = (size[0] as f64, size[1] as f64);
    let axis = |centre: f64, len: f64, max: f64| {
        if len <= max {
            (centre - len / 2.0).clamp(0.0, max - len)
        } else {
            (max - len) / 2.0
        }
    };
    let (x, y) = (axis(cx, w, iw).round(), axis(cy, h, ih).round());
    let (x0, y0) = (x.max(0.0), y.max(0.0));
    let (x1, y1) = ((x + w.round()).min(iw), (y + h.round()).min(ih));
    (x1 - x0 >= 1.0 && y1 - y0 >= 1.0).then_some([
        x0 as i32,
        y0 as i32,
        (x1 - x0) as i32,
        (y1 - y0) as i32,
    ])
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

/// Take out of a step what Quick redact hid, so that none of it goes into the file. Typed text that was masked is left out
/// (the step's own words show dots). A masked step is stored with the words of its block and without the names of the
/// control and the window.
fn scrub(s: &mut Step, block: &Value) {
    let flag = |name: &str| block.get(name).and_then(Value::as_bool) == Some(true);
    if flag("maskTyped") {
        if let Some(typed) = s.typed.take().filter(|t| !t.is_empty()) {
            for part in &mut s.text {
                part.t = part.t.replace(&typed, "••••••");
            }
        }
    }
    if flag("masked") {
        if let Some(text) = block
            .get("text")
            .and_then(|t| serde_json::from_value::<Vec<crate::steptext::Part>>(t.clone()).ok())
        {
            s.text = text;
        }
        if let Some(e) = &mut s.element {
            e.name.clear();
            e.parents.clear();
        }
        if let Some(w) = &mut s.window {
            w.title.clear();
        }
    }
}

/// The area a magnifier of a step shows (`None` for every other mark).
fn magnified_area(a: &Value) -> Option<Rect> {
    if a.get("kind")?.as_str()? != "magnify" {
        return None;
    }
    let n = |k: &str| a.get(k).and_then(Value::as_f64);
    let (x, y, x2, y2) = (n("x")?, n("y")?, n("x2")?, n("y2")?);
    let (x0, y0) = (x.min(x2).floor() as i32, y.min(y2).floor() as i32);
    let (x1, y1) = (x.max(x2).ceil() as i32, y.max(y2).ceil() as i32);
    (x1 > x0 && y1 > y0).then_some([x0, y0, x1 - x0, y1 - y0])
}

/// The part two rectangles share.
fn overlap(a: Rect, b: Rect) -> Option<Rect> {
    let (x0, y0) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x1, y1) = (
        (a[0] + a[2]).min(b[0] + b[2]),
        (a[1] + a[3]).min(b[1] + b[3]),
    );
    (x1 > x0 && y1 > y0).then_some([x0, y0, x1 - x0, y1 - y0])
}

/// A magnified area that the step's stored picture does not hold is stored as a small picture of its own: exactly the area, with
/// the redactions burned in. Its pixels come from the working picture of the step, or (in a guide opened from a file, whose
/// picture was cut already) from the piece the file kept. Returns its entry and its rectangle in working picture pixels.
fn keep_patch(
    work: &Path,
    step: &Step,
    mark: &Value,
    area: Rect,
    redact: &[(Rect, String)],
    known: &std::collections::HashSet<String>,
    pictures: &mut Vec<(String, Vec<u8>)>,
) -> CmdResult<Option<(String, Rect)>> {
    let whole = [0, 0, step.image_size[0] as i32, step.image_size[1] as i32];
    let kept = || {
        let p = &mark["patch"];
        let file = p["file"].as_str()?;
        // Only a step picture of the working folder, never a path.
        if !file.starts_with("pic-") || file.contains(['/', '\\']) {
            return None;
        }
        let n = |k: &str| p[k].as_f64().map(|v| v.round() as i32);
        let (x, y, x2, y2) = (n("x")?, n("y")?, n("x2")?, n("y2")?);
        Some((work.join(file), [x, y, x2 - x, y2 - y]))
    };
    let inside = overlap(area, whole) == Some(area);
    let (src, bounds) = match kept() {
        Some(piece) if !inside => piece,
        _ => (work.join(&step.image), whole),
    };
    let Some(part) = overlap(area, bounds) else {
        return Ok(None);
    };
    let entry = format!("pic/{}-m{}.png", step.n, signature(&src, part, redact));
    if !known.contains(&entry) && !pictures.iter().any(|(n, _)| *n == entry) {
        // (a piece that is gone: the magnifier shows nothing, the guide is saved)
        let Ok(img) = image::open(&src) else {
            return Ok(None);
        };
        let mut img = img.to_rgba8();
        let moved: Vec<(Rect, String)> = redact
            .iter()
            .filter(|(r, _)| overlap(*r, bounds).is_some())
            .map(|(r, k)| (shift(*r, bounds[0], bounds[1]), k.clone()))
            .collect();
        burn_redactions(&mut img, &moved);
        let local = clamp_rect(shift(part, bounds[0], bounds[1]), img.width(), img.height());
        let cut = image::imageops::crop_imm(
            &img,
            local[0] as u32,
            local[1] as u32,
            local[2] as u32,
            local[3] as u32,
        )
        .to_image();
        pictures.push((entry.clone(), png_of(&cut)?));
    }
    Ok(Some((entry, part)))
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
                // A step in a picture frame stores what the frame shows (as far as the screen goes), also when that is more than the
                // window; "keep full screenshots" keeps everything.
                let framed = if keep_full {
                    None
                } else {
                    framed_area(doc, &b, step.image_size)
                };
                let crop = framed.unwrap_or_else(|| stored_crop(step, &b, keep_full, &picture));
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
                    let mut s = (*step).clone();
                    scrub(&mut s, &b);
                    if let Some(o) = b.as_object_mut() {
                        o.insert("step".into(), serde_json::to_value(&s).map_err(io)?);
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
                // Magnified areas outside what the step stores get a piece of their own (by the place of their mark).
                let mut patches: Vec<(usize, Option<Value>)> = Vec::new();
                if let Some(list) = b.get("annotations").and_then(Value::as_array) {
                    for (i, mark) in list.iter().enumerate() {
                        let Some(area) = magnified_area(mark) else {
                            continue;
                        };
                        let patch = if overlap(area, crop) == Some(area) {
                            None
                        } else {
                            keep_patch(work, step, mark, area, &redact, known, &mut pictures)?.map(
                                |(file, r)| {
                                    let (x, y) = (r[0] - crop[0], r[1] - crop[1]);
                                    json!({ "file": file, "x": x, "y": y, "x2": x + r[2], "y2": y + r[3] })
                                },
                            )
                        };
                        patches.push((i, patch));
                    }
                }
                // The step as stored: its picture, and every rectangle in the pixels of the cropped picture.
                let mut s = (*step).clone();
                scrub(&mut s, &b);
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
                    for (i, patch) in patches {
                        if let Some(mark) = o
                            .get_mut("annotations")
                            .and_then(Value::as_array_mut)
                            .and_then(|list| list.get_mut(i))
                            .and_then(Value::as_object_mut)
                        {
                            match patch {
                                Some(p) => mark.insert("patch".into(), p),
                                None => mark.remove("patch"),
                            };
                        }
                    }
                    // The frame's centre is in picture pixels too.
                    if let Some(f) = o.get_mut("frame") {
                        *f = shift_annotations(f, crop[0], crop[1]);
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

/// The entry an item of a package stands for: `meta/pic/3-ab.png.2` is a version of `pic/3-ab.png`.
fn plain_name(entry: &str) -> &str {
    entry
        .strip_prefix("meta/")
        .map(|r| r.rsplit_once('.').map_or(r, |(name, _)| name))
        .unwrap_or(entry)
}

/// The step pictures a stored document shows, with the pieces its magnifiers keep.
fn pictures_of(doc: &Value) -> std::collections::HashSet<String> {
    doc["blocks"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|b| {
            let pieces = b["annotations"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| a["patch"]["file"].as_str());
            b["step"]["image"].as_str().into_iter().chain(pieces)
        })
        .map(str::to_string)
        .collect()
}

/// How much of a document is hidden: the masks in its texts and the steps whose recorded names are left out.
fn hidden(doc: &Value) -> usize {
    let masks = doc.to_string().matches("••••••").count();
    let steps = doc["blocks"].as_array().map_or(0, |a| {
        a.iter()
            .filter(|b| b["masked"] == json!(true) || b["maskTyped"] == json!(true))
            .count()
    });
    masks + steps
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
            // An appended save leaves the earlier versions in the file. When this one hides something that an earlier one holds
            // (a picture is cut or redacted anew, texts were masked), the file is written again without them.
            let shown = pictures_of(&prepared.document);
            let superseded = pkg
                .entries
                .keys()
                .map(|k| plain_name(k))
                .any(|n| n.starts_with("pic/") && !shown.contains(n));
            let before = pkg
                .meta("document.json")
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .map_or(0, |d| hidden(&d));
            let hides = superseded || hidden(&prepared.document) > before;
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
            if hides {
                package::compact_keeping(path, path, KIND_DOC, |n| {
                    !n.starts_with("pic/") || shown.contains(n)
                })
                .map_err(io)?;
                "rewritten"
            } else {
                "appended"
            }
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
                // The pieces of magnified areas are under their flat names too.
                if let Some(list) = o.get_mut("annotations").and_then(Value::as_array_mut) {
                    for mark in list {
                        if let Some(file) = mark["patch"]["file"].as_str().map(flat) {
                            mark["patch"]["file"] = json!(file);
                        }
                    }
                }
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

pub fn base64(bytes: &[u8]) -> String {
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
    fn a_magnified_area_outside_the_stored_picture_is_kept_as_a_redacted_piece_of_its_own() {
        let (d, steps, mut doc) = work_with_steps(1);
        let work = d.path().join("work");
        // The window is (50,20) 100x60. One magnifier on the red area outside it (with a black box over its left half), one
        // inside the window. A callout box and a bubble are in frame units: they are not moved with the picture.
        doc["blocks"][0]["redact"] = json!([{ "rect": [10, 10, 10, 20], "kind": "black" }]);
        doc["blocks"][0]["annotations"] = json!([
            { "id": "m1", "kind": "magnify", "x": 10, "y": 10, "x2": 30, "y2": 30, "at": { "x": 600, "y": -40 }, "zoom": 3 },
            { "id": "m2", "kind": "magnify", "x": 60, "y": 30, "x2": 80, "y2": 50, "at": { "x": 100, "y": 100 } },
            { "id": "c1", "kind": "callout", "x": 60, "y": 30, "x2": 70, "y2": 40, "box": { "x": -120, "y": 5, "w": 190, "h": 40 }, "text": "Here\nnow", "shape": "cloud", "fill": "#101010", "color": "#202020", "textColor": "#F0F0F0", "size": 22, "bold": true, "width": 4 },
            { "id": "s1", "kind": "spot", "x": 60, "y": 30, "x2": 90, "y2": 50, "shape": "ellipse" }
        ]);
        doc["spotlight"] = json!({ "dim": 40, "tone": "light", "soft": true });
        doc["blocks"][0]["spotlight"] = json!({ "dim": 70 });
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let read = |file: &Path| {
            let pkg = package::open(file, KIND_DOC).unwrap();
            let stored: Value =
                serde_json::from_slice(&pkg.meta("document.json").unwrap()).unwrap();
            (pkg, stored)
        };
        let (pkg, stored) = read(&file);
        let marks = &stored["blocks"][0]["annotations"];
        // Moved with the picture: the areas and tips; kept: what is in frame units.
        assert_eq!(marks[0]["x"], json!(-40.0));
        assert_eq!(marks[0]["at"], json!({ "x": 600, "y": -40 }));
        assert_eq!(marks[2]["box"]["x"], json!(-120));
        assert_eq!(marks[2]["x2"], json!(20.0));
        assert_eq!(marks[3]["x"], json!(10.0));
        let piece = marks[0]["patch"]["file"].as_str().unwrap().to_string();
        assert_eq!(
            marks[0]["patch"],
            json!({ "file": piece, "x": -40, "y": -10, "x2": -20, "y2": 10 })
        );
        assert!(marks[1].get("patch").is_none(), "inside the stored picture");
        let img = image::load_from_memory(&pkg.meta(&piece).unwrap())
            .unwrap()
            .to_rgba8();
        // Exactly the area, and nothing that was redacted.
        assert_eq!((img.width(), img.height()), (20, 20));
        assert_eq!(img.get_pixel(4, 4).0, [0, 0, 0, 255]);
        assert_eq!(img.get_pixel(15, 4).0, [255, 0, 0, 255]);
        // Opened again the piece is in the working folder, and the next save keeps it from there.
        let work2 = d.path().join("work2");
        open_file(&work2, &file).unwrap();
        let doc2 = read_document(&work2).unwrap();
        let name = doc2["blocks"][0]["annotations"][0]["patch"]["file"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(name, flat(&piece));
        assert!(work2.join(&name).is_file());
        // The callout with every option, the spotlight and both spotlight styles come back as they were saved.
        assert_eq!(doc2["blocks"][0]["annotations"][2], marks[2]);
        assert_eq!(doc2["blocks"][0]["annotations"][3], marks[3]);
        assert_eq!(doc2["blocks"][0]["spotlight"], json!({ "dim": 70 }));
        assert_eq!(doc2["spotlight"], doc["spotlight"]);
        let lines = std::fs::read_to_string(work2.join("steps.jsonl")).unwrap();
        let steps2: Vec<Step> = lines
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        let copy = d.path().join("copy.snpd");
        save(&work2, &copy, &doc2, &steps2, true).unwrap();
        let (pkg2, stored2) = read(&copy);
        let again = &stored2["blocks"][0]["annotations"][0]["patch"];
        let kept = image::load_from_memory(&pkg2.meta(again["file"].as_str().unwrap()).unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!(kept.dimensions(), (20, 20));
        assert_eq!(kept.get_pixel(15, 4).0, [255, 0, 0, 255]);
        // A later save without the magnifier takes its piece out of the file.
        let mut without = doc.clone();
        without["blocks"][0]["annotations"] = json!([]);
        assert_eq!(
            save(&work, &file, &without, &steps, false).unwrap().how,
            "rewritten"
        );
        assert!(!package::open(&file, KIND_DOC)
            .unwrap()
            .entries
            .keys()
            .any(|k| k.contains(&piece)));
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
    fn a_save_that_was_cut_off_is_undone_and_a_changed_crop_replaces_its_picture() {
        let (d, steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let good = std::fs::read(&file).unwrap();
        // A new crop of step 2: the file holds the new picture only (the old one may show what was cut away).
        doc["blocks"][1]["crop"] = json!([0, 0, 120, 80]);
        save(&work, &file, &doc, &steps, false).unwrap();
        let p = package::open(&file, KIND_DOC).unwrap();
        assert_eq!(
            p.entries.keys().filter(|k| k.contains("pic/2-")).count(),
            1,
            "only the new picture of step 2"
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

    /// The attributes of images and tables in text blocks (size, alignment, crop, alt text, column widths) are part of the content
    /// JSON: they survive Save as, an appended save and opening again, and a guide without them (7.5-B) opens as before.
    #[test]
    fn image_and_table_attributes_of_text_blocks_survive_save_and_open() {
        let (d, steps, mut doc) = work_with_steps(1);
        let work = d.path().join("work");
        let content = json!({ "type": "doc", "content": [
            { "type": "image", "attrs": { "src": "x", "alt": "A diagram", "file": "m-0001.png", "width": 320, "height": null, "align": "center", "crop": [0.1, 0.2, 0.5, 0.6], "nw": 800, "nh": 600 } },
            { "type": "table", "attrs": { "align": "end" }, "content": [ { "type": "tableRow", "content": [
                { "type": "tableHeader", "attrs": { "colspan": 1, "rowspan": 1, "colwidth": [140] }, "content": [ { "type": "paragraph" } ] },
                { "type": "tableCell", "attrs": { "colspan": 1, "rowspan": 1, "colwidth": [220] }, "content": [ { "type": "paragraph" } ] } ] } ] },
            { "type": "image", "attrs": { "src": "y", "alt": null, "file": "m-0002.png" } }
        ] });
        doc["blocks"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "id": "c1", "type": "content", "doc": content.clone() }));
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        doc["title"] = json!("Again");
        save(&work, &file, &doc, &steps, false).unwrap(); // appended
        let work2 = d.path().join("work2");
        open_file(&work2, &file).unwrap();
        let back = read_document(&work2).unwrap();
        let block = back["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["id"] == "c1")
            .unwrap();
        assert_eq!(block["doc"], content, "every attribute is kept exactly");
        // The old image node (no new attributes) is still just that.
        assert!(block["doc"]["content"][2]["attrs"].get("align").is_none());
    }

    /// "Expand area": a step whose area was dragged OUTSIDE its window is stored with exactly that area (the stored picture has
    /// the size of the new area and the click moved with it); an area dragged inwards stores less. Only the shown area is stored.
    #[test]
    fn an_expanded_or_reduced_area_is_what_is_stored() {
        let (d, steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        // The window of the steps is (50,20)-(150,80) of a 200x100 picture. Step 1 is expanded to (10,10)-(190,95), step 2 reduced.
        doc["blocks"][0]["crop"] = json!([10, 10, 180, 85]);
        doc["blocks"][1]["crop"] = json!([60, 30, 40, 20]);
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let pkg = package::open(&file, KIND_DOC).unwrap();
        let stored: Value = serde_json::from_slice(&pkg.meta("document.json").unwrap()).unwrap();
        let s1: Step = serde_json::from_value(stored["blocks"][0]["step"].clone()).unwrap();
        let s2: Step = serde_json::from_value(stored["blocks"][1]["step"].clone()).unwrap();
        assert_eq!(s1.image_size, [180, 85]);
        assert_eq!(
            s1.click,
            Some([60, 30]),
            "the click (70,40) moved with the area"
        );
        assert_eq!(s2.image_size, [40, 20]);
        let img = image::load_from_memory(&pkg.meta(&s1.image).unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!((img.width(), img.height()), (180, 85));
        // The red area (10..50, 10..30) of the screenshot is inside the expanded area: it is in the picture now.
        assert!(img.pixels().any(|p| p.0 == [255, 0, 0, 255]));
    }

    /// 7.5-C: a step in a picture frame stores the area its frame shows (more than the window here), nothing else; the frame's centre
    /// moves with it, the file asks for minor version 1, and a guide without template stays at minor 0.
    #[test]
    fn a_framed_step_stores_what_its_frame_shows_and_the_file_says_so() {
        let (d, steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        let plain = d.path().join("plain.snpd");
        save(&work, &plain, &doc, &steps, true).unwrap();
        assert_eq!(package::open(&plain, KIND_DOC).unwrap().manifest.minor, 0);
        // 200x100 picture, window (50,20 100x60). A 2:1 frame, 180 px wide, centred at (100,50): (10,5) 180x90.
        doc["template"] = json!({ "frame": { "ratio": "custom", "w": 2, "h": 1 } });
        doc["blocks"][0]["frame"] = json!({ "cx": 100, "cy": 50, "w": 180 });
        // Step 2: a frame wider than the picture: clipped to the picture (the rest is padding when shown).
        doc["blocks"][1]["frame"] = json!({ "cx": 100, "cy": 50, "w": 400 });
        let file = d.path().join("f.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let pkg = package::open(&file, KIND_DOC).unwrap();
        assert_eq!(pkg.manifest.minor, 1);
        let stored: Value = serde_json::from_slice(&pkg.meta("document.json").unwrap()).unwrap();
        let s1: Step = serde_json::from_value(stored["blocks"][0]["step"].clone()).unwrap();
        assert_eq!(s1.image_size, [180, 90]);
        assert_eq!(stored["blocks"][0]["frame"]["cx"], json!(90.0));
        assert_eq!(stored["blocks"][0]["frame"]["cy"], json!(45.0));
        let s2: Step = serde_json::from_value(stored["blocks"][1]["step"].clone()).unwrap();
        assert_eq!(s2.image_size, [200, 100]);
        assert_eq!(stored["template"]["frame"]["ratio"], "custom");
        // What came with 7.5-C2 asks for minor version 2.
        let mut newer = doc.clone();
        newer["template"]["header"] = json!({ "left": "text", "texts": { "left": "Internal" } });
        let two = d.path().join("two.snpd");
        save(&work, &two, &newer, &steps, true).unwrap();
        assert_eq!(package::open(&two, KIND_DOC).unwrap().manifest.minor, 2);
        // "Keep full screenshots" ignores the frame for what is stored.
        doc["keepFull"] = json!(true);
        let full = d.path().join("full.snpd");
        save(&work, &full, &doc, &steps, true).unwrap();
        let p = package::open(&full, KIND_DOC).unwrap();
        let st: Value = serde_json::from_slice(&p.meta("document.json").unwrap()).unwrap();
        assert_eq!(st["blocks"][0]["step"]["imageSize"], json!([200, 100]));
    }

    #[test]
    fn masked_typed_text_is_not_in_the_saved_file() {
        let (d, mut steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        for s in &mut steps {
            s.typed = Some("hunter2secret".into());
            s.text = vec![crate::steptext::Part {
                t: "Type 'hunter2secret'".into(),
                b: false,
            }];
        }
        doc["blocks"][0]["maskTyped"] = json!(true);
        doc["blocks"][0]["text"] = json!([{ "t": "Type '••••••'" }]);
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let pkg = package::open(&file, KIND_DOC).unwrap();
        let stored: Value = serde_json::from_slice(&pkg.meta("document.json").unwrap()).unwrap();
        let first = stored["blocks"][0].to_string();
        assert!(!first.contains("hunter2secret"), "{first}");
        assert!(first.contains("••••••"));
        assert!(
            stored["blocks"][1].to_string().contains("hunter2secret"),
            "only what was ticked"
        );
    }

    #[test]
    fn a_zoom_made_without_a_frame_is_no_place_in_a_frame() {
        let doc = json!({ "template": { "frame": { "ratio": "1:1" } } });
        let mut block = json!({ "frame": { "cx": 100, "cy": 50, "w": 40 } });
        assert_eq!(
            framed_area(&doc, &block, [200, 100]),
            Some([80, 30, 40, 40])
        );
        // The zoom stays a view of the step: the file keeps the step's area.
        block["frame"]["own"] = json!(true);
        assert_eq!(framed_area(&doc, &block, [200, 100]), None);
        let plain = json!({ "template": { "frame": { "ratio": "original" } } });
        assert_eq!(framed_area(&plain, &block, [200, 100]), None);
    }

    #[test]
    fn hiding_something_after_a_save_leaves_no_earlier_version_in_the_file() {
        let (d, mut steps, mut doc) = work_with_steps(2);
        let work = d.path().join("work");
        let secret = "s3cretValue";
        steps[0].text = vec![crate::steptext::Part {
            t: format!("Click {secret}"),
            b: false,
        }];
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let pictures = |file: &Path| {
            let p = package::open(file, KIND_DOC).unwrap();
            p.entries
                .keys()
                .filter(|k| plain_name(k).starts_with("pic/"))
                .count()
        };
        // An ordinary change is appended.
        doc["title"] = json!("Renamed");
        assert_eq!(
            save(&work, &file, &doc, &steps, false).unwrap().how,
            "appended"
        );
        assert_eq!(pictures(&file), 2);
        // A masked text: the earlier versions that hold it are gone.
        doc["blocks"][0]["masked"] = json!(true);
        doc["blocks"][0]["text"] = json!([{ "t": "Click ••••••" }]);
        assert_eq!(
            save(&work, &file, &doc, &steps, false).unwrap().how,
            "rewritten"
        );
        let bytes = std::fs::read(&file).unwrap();
        assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()));
        // A new redaction: the earlier picture is gone.
        doc["blocks"][1]["redact"] = json!([{ "rect": [60, 30, 20, 20], "kind": "black" }]);
        assert_eq!(
            save(&work, &file, &doc, &steps, false).unwrap().how,
            "rewritten"
        );
        assert_eq!(pictures(&file), 2);
        let p = package::open(&file, KIND_DOC).unwrap();
        assert!(!p.entries.keys().any(|k| k.starts_with("meta/")));
        // Saving the same again only appends.
        assert_eq!(
            save(&work, &file, &doc, &steps, false).unwrap().how,
            "appended"
        );
        open_file(&d.path().join("again"), &file).unwrap();
    }

    #[test]
    fn a_masked_step_is_stored_with_its_blocks_words_and_without_control_and_window_names() {
        let (d, mut steps, mut doc) = work_with_steps(1);
        let work = d.path().join("work");
        let secret = "s3cretValue";
        steps[0].text = vec![crate::steptext::Part {
            t: format!("Click password: {secret}"),
            b: false,
        }];
        steps[0].window = Some(crate::guides::WindowInfo {
            rect: [50, 20, 100, 60],
            title: format!("{secret} - Editor"),
            process: "editor".into(),
        });
        steps[0].element = Some(crate::guides::ElementInfo {
            name: format!("password: {secret}"),
            control_type: "Edit".into(),
            localized_control_type: "edit".into(),
            automation_id: String::new(),
            toggle: None,
            selected: None,
            rect: [1, 1, 5, 5],
            parents: vec![format!("{secret} tab")],
        });
        doc["blocks"][0]["masked"] = json!(true);
        doc["blocks"][0]["text"] = json!([{ "t": "Click password: ••••••" }]);
        let file = d.path().join("g.snpd");
        save(&work, &file, &doc, &steps, true).unwrap();
        let pkg = package::open(&file, KIND_DOC).unwrap();
        let stored = String::from_utf8(pkg.meta("document.json").unwrap()).unwrap();
        assert!(!stored.contains(secret), "{stored}");
        assert!(stored.contains("••••••"));
    }
}
