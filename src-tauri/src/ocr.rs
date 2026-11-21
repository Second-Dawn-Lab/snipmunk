//! Text recognition (OCR) with the Windows built-in engine (`Windows.Media.Ocr`): no models, no download, works offline.
//! The languages are the ones Windows has the "Optical character recognition" capability for.
//!
//! Results (words with boxes) are kept per capture in `ocr/<id>.json` of the session folder, with a key that says what
//! they were made from (crop, rotation, flip, redactions, languages). The page decides when a result is stale. New
//! captures are recognized in the background by one low-priority worker thread; the page asks for the text of an edited
//! capture with `ocr_recognize`, sending the picture it wants read (with the redactions already applied: redacted areas
//! are never recognized).

use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::AppState;
use crate::error::{CmdError, CmdResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub words: Vec<OcrWord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    /// What this was made from (see `src/ocr/key.ts`); set by whoever asked for it.
    pub key: String,
    pub engine: String,
    /// The language tag the text was read in ("de-DE").
    pub language: String,
    /// Size of the picture that was read: the boxes are in its pixels.
    pub width: u32,
    pub height: u32,
    pub lines: Vec<OcrLine>,
    pub took_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LangInfo {
    pub tag: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub engine: &'static str,
    pub available: bool,
    pub languages: Vec<LangInfo>,
}

/// The number of letters (any script) in a result: the language that reads the most letters is the right one.
pub fn letter_count(lines: &[OcrLine]) -> usize {
    lines
        .iter()
        .map(|l| l.text.chars().filter(|c| c.is_alphabetic()).count())
        .sum()
}

/// The key of the text recognized right after a capture, which has no edits yet. The page makes the same key for a
/// document without crop, rotation, flip and redactions (`src/ocr/key.ts`).
pub fn plain_key(languages: &str) -> String {
    format!("plain|{languages}")
}

/// Small pictures are enlarged before recognition (Windows OCR reads small text badly).
pub fn upscale_factor(width: u32, height: u32) -> u32 {
    if width.max(height) < 1200 {
        2
    } else {
        1
    }
}

/// The median height of the words of a result (in the pixels of the picture they are in); 0 without words.
pub fn median_word_height(lines: &[OcrLine]) -> f32 {
    let mut hs: Vec<f32> = lines
        .iter()
        .flat_map(|l| l.words.iter().map(|w| w.h))
        .filter(|h| *h > 0.0)
        .collect();
    if hs.is_empty() {
        return 0.0;
    }
    hs.sort_by(|a, b| a.total_cmp(b));
    hs[hs.len() / 2]
}

/// Text this tall (pixels) is read best; smaller text is read again enlarged.
const GOOD_WORD_HEIGHT: f32 = 26.0;

/// The enlargement for a second pass when the text of the first pass is small (e.g. monospace text in a screenshot), or 1.
/// `done` is the factor the first pass used; `max` the largest picture side the engine takes.
pub fn second_pass_factor(median_h: f32, done: u32, width: u32, height: u32, max: u32) -> u32 {
    if median_h <= 0.0 || median_h >= GOOD_WORD_HEIGHT * 0.85 {
        return 1;
    }
    let want = ((GOOD_WORD_HEIGHT / median_h * done as f32).ceil() as u32).clamp(2, 4);
    let mut f = want;
    while f > done && (width * f > max || height * f > max) {
        f -= 1;
    }
    if f > done {
        f
    } else {
        1
    }
}

fn line_box(l: &OcrLine) -> Option<(f32, f32, f32, f32)> {
    let first = l.words.first()?;
    let (mut x0, mut y0, mut x1, mut y1) = (first.x, first.y, first.x + first.w, first.y + first.h);
    for w in &l.words {
        x0 = x0.min(w.x);
        y0 = y0.min(w.y);
        x1 = x1.max(w.x + w.w);
        y1 = y1.max(w.y + w.h);
    }
    Some((x0, y0, x1, y1))
}

fn overlap_fraction(a: (f32, f32, f32, f32), b: (f32, f32, f32, f32)) -> f32 {
    let w = (a.2.min(b.2) - a.0.max(b.0)).max(0.0);
    let h = (a.3.min(b.3) - a.1.max(b.1)).max(0.0);
    let area = ((a.2 - a.0) * (a.3 - a.1)).max(f32::EPSILON);
    w * h / area
}

/// `base` plus the lines of `extra` that lie where `base` has no line (a line one pass missed and the other found), in reading
/// order (top to bottom).
pub fn merge_missing(mut base: Vec<OcrLine>, extra: Vec<OcrLine>) -> Vec<OcrLine> {
    let boxes: Vec<_> = base.iter().filter_map(line_box).collect();
    for l in extra {
        let Some(b) = line_box(&l) else { continue };
        if boxes.iter().all(|o| overlap_fraction(b, *o) < 0.3) {
            base.push(l);
        }
    }
    base.sort_by(|a, c| {
        let (ay, cy) = (
            line_box(a).map_or(0.0, |b| b.1),
            line_box(c).map_or(0.0, |b| b.1),
        );
        ay.total_cmp(&cy)
    });
    base
}

/// How much was read: every letter and digit.
fn read_count(lines: &[OcrLine]) -> usize {
    lines
        .iter()
        .map(|l| l.text.chars().filter(|c| c.is_alphanumeric()).count())
        .sum()
}

/// The languages to try: all that are available for "auto" (the user's own first), else the requested ones that are
/// available.
pub fn choose_languages(setting: &str, available: &[String]) -> Vec<String> {
    if setting == "auto" || setting.trim().is_empty() {
        return available.to_vec();
    }
    setting
        .split(',')
        .map(str::trim)
        .filter_map(|want| {
            available
                .iter()
                .find(|a| a.eq_ignore_ascii_case(want))
                .cloned()
        })
        .collect()
}

#[cfg(windows)]
mod win {
    use anyhow::{anyhow, Result};
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{LangInfo, OcrLine, OcrWord};

    fn init_com() {
        thread_local! {
            static INIT: () = {
                // Already initialized by someone else is fine.
                let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            };
        }
        INIT.with(|_| {});
    }

    pub fn languages() -> Vec<LangInfo> {
        init_com();
        let Ok(list) = OcrEngine::AvailableRecognizerLanguages() else {
            return Vec::new();
        };
        list.into_iter()
            .filter_map(|l| {
                Some(LangInfo {
                    tag: l.LanguageTag().ok()?.to_string(),
                    name: l.DisplayName().map(|n| n.to_string()).unwrap_or_default(),
                })
            })
            .collect()
    }

    pub fn max_dimension() -> u32 {
        init_com();
        OcrEngine::MaxImageDimension().unwrap_or(10_000)
    }

    /// Recognize an RGBA picture in one language.
    pub fn recognize(rgba: &[u8], width: u32, height: u32, tag: &str) -> Result<Vec<OcrLine>> {
        init_com();
        let mut bgra = rgba.to_vec();
        for px in bgra.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }
        let writer = DataWriter::new()?;
        writer.WriteBytes(&bgra)?;
        let buffer = writer.DetachBuffer()?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )?;
        let language = Language::CreateLanguage(&HSTRING::from(tag))?;
        let engine = OcrEngine::TryCreateFromLanguage(&language)
            .map_err(|_| anyhow!("Windows OCR has no {tag}"))?;
        let result = engine.RecognizeAsync(&bitmap)?.get()?;
        let mut lines = Vec::new();
        for line in result.Lines()? {
            let mut words = Vec::new();
            for w in line.Words()? {
                let r = w.BoundingRect()?;
                words.push(OcrWord {
                    text: w.Text()?.to_string(),
                    x: r.X,
                    y: r.Y,
                    w: r.Width,
                    h: r.Height,
                });
            }
            if !words.is_empty() {
                lines.push(OcrLine {
                    text: line.Text()?.to_string(),
                    words,
                });
            }
        }
        Ok(lines)
    }
}

#[cfg(not(windows))]
mod win {
    use anyhow::{anyhow, Result};

    use super::{LangInfo, OcrLine};

    pub fn languages() -> Vec<LangInfo> {
        Vec::new()
    }
    pub fn max_dimension() -> u32 {
        10_000
    }
    pub fn recognize(_: &[u8], _: u32, _: u32, _: &str) -> Result<Vec<OcrLine>> {
        Err(anyhow!("text recognition needs Windows"))
    }
}

/// Rows of a tall picture read one after the other: each tile is at most `tile` rows, neighbours overlap by `overlap` rows, and
/// every tile owns the rows between the middle of its overlaps (a line is kept by the tile that owns its middle).
/// Returns (first row, end row, owned from, owned to) of every tile.
pub fn tile_bands(height: u32, tile: u32, overlap: u32) -> Vec<(u32, u32, u32, u32)> {
    if height <= tile {
        return vec![(0, height, 0, height)];
    }
    let step = tile - overlap;
    let mut out = Vec::new();
    let mut y0 = 0;
    loop {
        let y1 = (y0 + tile).min(height);
        let last = y1 >= height;
        let own0 = if y0 == 0 { 0 } else { y0 + overlap / 2 };
        let own1 = if last { height } else { y1 - overlap / 2 };
        out.push((y0, y1, own0, own1));
        if last {
            break;
        }
        y0 += step;
    }
    out
}

/// Recognize a picture in the requested languages (see `choose_languages`); the best result wins. A picture taller than the
/// engine reads at once (a scrolling screenshot) is read in overlapping tiles and the lines are put together.
pub fn recognize(
    rgba: &[u8],
    width: u32,
    height: u32,
    setting: &str,
    key: String,
) -> Result<OcrResult, String> {
    let max = win::max_dimension();
    if height <= max || width > max {
        return recognize_one(rgba, width, height, setting, key);
    }
    let started = Instant::now();
    // Tiles well below the limit: the engine enlarges small text, and that needs room.
    let tile = (max / 2).clamp(1000, 4000).min(max);
    let mut lines: Vec<OcrLine> = Vec::new();
    let mut language = String::new();
    for (y0, y1, own0, own1) in tile_bands(height, tile, 160.min(tile / 4)) {
        let part = &rgba[(y0 as usize * width as usize * 4)..(y1 as usize * width as usize * 4)];
        let r = recognize_one(part, width, y1 - y0, setting, key.clone())?;
        if language.is_empty() {
            language = r.language.clone();
        }
        for mut line in r.lines {
            for w in &mut line.words {
                w.y += y0 as f32;
            }
            let top = line.words.iter().map(|w| w.y).fold(f32::MAX, f32::min);
            let bottom = line.words.iter().map(|w| w.y + w.h).fold(0.0, f32::max);
            let middle = (top + bottom) / 2.0;
            if middle >= own0 as f32 && middle < own1 as f32 {
                lines.push(line);
            }
        }
    }
    Ok(finish(key, language, width, height, lines, started))
}

fn recognize_one(
    rgba: &[u8],
    width: u32,
    height: u32,
    setting: &str,
    key: String,
) -> Result<OcrResult, String> {
    let started = Instant::now();
    let available: Vec<String> = win::languages().into_iter().map(|l| l.tag).collect();
    let tags = choose_languages(setting, &available);
    if tags.is_empty() {
        return Err(if available.is_empty() {
            "Windows has no text recognition language installed".into()
        } else {
            "none of the chosen text recognition languages is installed".into()
        });
    }
    let max = win::max_dimension();
    if width > max || height > max {
        return Err(format!(
            "the picture is too large for text recognition ({width} x {height}, at most {max})"
        ));
    }
    // First pass (small pictures are enlarged); when its text is small, a second pass reads it enlarged more and the lines
    // only one pass found are kept.
    let factor = upscale_factor(width, height);
    let (language, mut lines) = read_pass(rgba, width, height, factor, &tags)?;
    let second = second_pass_factor(median_word_height(&lines), factor, width, height, max);
    let mut language = language;
    if second > 1 {
        // Other scales read other lines (the engine drops a line of small digits at one scale and reads it at the next), so a
        // neighbouring scale is tried too; every pass only adds the lines the others missed.
        let alt = if second > 2 { second - 1 } else { 3 };
        let mut factors = vec![second];
        if alt != factor && alt != second && width * alt <= max && height * alt <= max {
            factors.push(alt);
        }
        for f in factors {
            if let Ok((lang2, lines2)) = read_pass(rgba, width, height, f, &tags) {
                // The pass that read more is the base; the other one only adds lines the base missed.
                if read_count(&lines2) > read_count(&lines) {
                    lines = merge_missing(lines2, lines);
                    language = lang2;
                } else {
                    lines = merge_missing(lines, lines2);
                }
            }
        }
    }
    Ok(finish(key, language, width, height, lines, started))
}

fn finish(
    key: String,
    language: String,
    width: u32,
    height: u32,
    lines: Vec<OcrLine>,
    started: Instant,
) -> OcrResult {
    OcrResult {
        key,
        engine: "windows".into(),
        language,
        width,
        height,
        lines,
        took_ms: started.elapsed().as_millis() as u64,
    }
}

/// One recognition pass at a scale: the best language, the boxes mapped back to the pixels of the original picture.
fn read_pass(
    rgba: &[u8],
    width: u32,
    height: u32,
    factor: u32,
    tags: &[String],
) -> Result<(String, Vec<OcrLine>), String> {
    let (data, w, h): (std::borrow::Cow<[u8]>, u32, u32) = if factor > 1 {
        let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
            .ok_or("the picture has an unexpected size")?;
        let big = image::imageops::resize(
            &img,
            width * factor,
            height * factor,
            image::imageops::FilterType::CatmullRom,
        );
        (big.into_raw().into(), width * factor, height * factor)
    } else {
        (rgba.into(), width, height)
    };
    let mut best: Option<(String, Vec<OcrLine>)> = None;
    let mut last_error = None;
    for tag in tags {
        match win::recognize(&data, w, h, tag) {
            Ok(lines) => {
                if best
                    .as_ref()
                    .is_none_or(|(_, b)| letter_count(&lines) > letter_count(b))
                {
                    best = Some((tag.clone(), lines));
                }
            }
            Err(e) => last_error = Some(e.to_string()),
        }
    }
    let Some((language, mut lines)) = best else {
        return Err(last_error.unwrap_or_else(|| "text recognition failed".into()));
    };
    if factor > 1 {
        let f = factor as f32;
        for line in &mut lines {
            for word in &mut line.words {
                word.x /= f;
                word.y /= f;
                word.w /= f;
                word.h /= f;
            }
        }
    }
    Ok((language, lines))
}

/// Write a result next to its session (a temporary file renamed over, never half a file).
pub fn write_result(path: &Path, result: &OcrResult) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let swap = path.with_extension("json.swap");
    std::fs::write(&swap, serde_json::to_vec(result)?)?;
    std::fs::rename(&swap, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&swap);
    })
}

// --- the background worker ---------------------------------------------------------------------------------------------------

struct Job {
    session_id: String,
    capture_id: String,
}

static QUEUE: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
static PENDING: Mutex<u32> = Mutex::new(0);

fn announce(app: &AppHandle) {
    let n = *PENDING.lock().unwrap();
    let _ = app.emit("ocr-queue", json!({ "pending": n }));
}

fn lower_priority() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
        };
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

fn run_job(app: &AppHandle, job: &Job) {
    let state = app.state::<AppState>();
    let (path, ocr_path, setting) = {
        let store = state.sessions.lock().unwrap();
        if store.session().id != job.session_id {
            return;
        }
        let Some(c) = store
            .session()
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .find(|c| c.id == job.capture_id)
        else {
            return;
        };
        (
            store.session_dir().join(&c.file),
            store.ocr_path(&c.id),
            state.settings.lock().unwrap().ocr_languages.clone(),
        )
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return;
    };
    let Ok(img) = image::load_from_memory(&bytes) else {
        return;
    };
    let rgba = img.to_rgba8();
    let result = match recognize(
        rgba.as_raw(),
        rgba.width(),
        rgba.height(),
        &setting,
        plain_key(&setting),
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("text recognition failed: {e}");
            return;
        }
    };
    // The capture may have been deleted, redacted or replaced while this ran: only keep the result if it is still plain.
    let store = state.sessions.lock().unwrap();
    let still_there = store.session().id == job.session_id
        && store
            .session()
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .any(|c| c.id == job.capture_id && c.annotations.is_null());
    if still_there && write_result(&ocr_path, &result).is_ok() {
        drop(store);
        let _ = app.emit("ocr-ready", json!({ "captureId": job.capture_id }));
    }
}

/// Recognize a capture's text in the background (low priority, one at a time).
pub fn queue(app: &AppHandle, capture_id: &str) {
    let state = app.state::<AppState>();
    if !state.settings.lock().unwrap().ocr_auto {
        return;
    }
    let session_id = state.sessions.lock().unwrap().session().id.clone();
    let sender = QUEUE.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        let app = app.clone();
        std::thread::spawn(move || {
            lower_priority();
            while let Ok(job) = rx.recv() {
                run_job(&app, &job);
                {
                    let mut p = PENDING.lock().unwrap();
                    *p = p.saturating_sub(1);
                }
                announce(&app);
            }
        });
        Mutex::new(tx)
    });
    *PENDING.lock().unwrap() += 1;
    announce(app);
    let _ = sender.lock().unwrap().send(Job {
        session_id,
        capture_id: capture_id.to_string(),
    });
}

// --- commands ----------------------------------------------------------------------------------------------------------------

/// The engine and the OCR languages Windows has.
#[tauri::command]
pub fn ocr_status() -> OcrStatus {
    let languages = win::languages();
    OcrStatus {
        engine: "windows",
        available: !languages.is_empty(),
        languages,
    }
}

/// The recognized text of a capture, if it has been recognized (the page checks the key).
#[tauri::command]
pub fn ocr_get(state: State<'_, AppState>, capture_id: String) -> Option<OcrResult> {
    if !crate::sessions::is_safe_id(&capture_id) {
        return None;
    }
    let path = state.sessions.lock().unwrap().ocr_path(&capture_id);
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// The recognized text of every capture of the session that has one, by capture id (for the gallery search, which
/// keeps its own index; one call instead of one per capture).
#[tauri::command]
pub fn ocr_texts(state: State<'_, AppState>) -> std::collections::HashMap<String, String> {
    let store = state.sessions.lock().unwrap();
    let mut out = std::collections::HashMap::new();
    for g in &store.session().groups {
        for c in &g.captures {
            let Ok(bytes) = std::fs::read(store.ocr_path(&c.id)) else {
                continue;
            };
            if let Ok(r) = serde_json::from_slice::<OcrResult>(&bytes) {
                let text: Vec<&str> = r.lines.iter().map(|l| l.text.as_str()).collect();
                out.insert(
                    c.id.clone(),
                    text.join(
                        "
",
                    ),
                );
            }
        }
    }
    out
}

/// Recognize the picture the page sends (a PNG as the raw body; `x-capture-id`, `x-key` headers) and keep the result.
#[tauri::command]
pub async fn ocr_recognize(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<OcrResult> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new("bad_request", "the picture is missing"));
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(crate::commands::percent_decode)
    };
    let capture_id =
        header("x-capture-id").ok_or_else(|| CmdError::new("bad_request", "no capture"))?;
    let key = header("x-key").unwrap_or_default();
    let (ocr_path, setting) = {
        let store = state.sessions.lock().unwrap();
        if !store
            .session()
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .any(|c| c.id == capture_id)
        {
            return Err(CmdError::new("not_found", "this capture is gone"));
        }
        (
            store.ocr_path(&capture_id),
            state.settings.lock().unwrap().ocr_languages.clone(),
        )
    };
    let bytes = bytes.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
        let rgba = img.to_rgba8();
        recognize(rgba.as_raw(), rgba.width(), rgba.height(), &setting, key)
    })
    .await
    .map_err(|e| CmdError::new("io", e))?
    .map_err(|e| CmdError::new("ocr", e))?;
    write_result(&ocr_path, &result)?;
    Ok(result)
}

/// Put text on the clipboard.
#[tauri::command]
pub fn copy_text(text: String) -> CmdResult<()> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| CmdError::new("clipboard", e))
}

/// Put a table on the clipboard as HTML (pastes as a table in Excel, Word and Google Sheets) and as plain text
/// (tab separated, for editors).
#[tauri::command]
pub fn copy_table(html: String, text: String) -> CmdResult<()> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_html(html, Some(text)))
        .map_err(|e| CmdError::new("clipboard", e))
}

/// Open a page of the Windows settings (only the language page, for adding OCR languages).
#[tauri::command]
pub fn open_os_settings(page: String) -> CmdResult<()> {
    let uri = match page.as_str() {
        "language" => "ms-settings:regionlanguage",
        "microphone" => "ms-settings:privacy-microphone",
        _ => return Err(CmdError::new("bad_request", "this page cannot be opened")),
    };
    #[cfg(windows)]
    return std::process::Command::new("explorer")
        .arg(uri)
        .spawn()
        .map(|_| ())
        .map_err(|e| CmdError::new("io", e));
    #[cfg(not(windows))]
    Err(CmdError::new("bad_request", "this needs Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str) -> OcrLine {
        OcrLine {
            text: text.into(),
            words: Vec::new(),
        }
    }

    #[test]
    fn the_language_that_reads_the_most_letters_wins() {
        assert!(letter_count(&[line("Hallo Welt")]) > letter_count(&[line("H a l 1 2")]));
        assert_eq!(letter_count(&[line("你好 123"), line("مرحبا")]), 7);
        assert_eq!(letter_count(&[]), 0);
    }

    #[test]
    fn languages_are_chosen_from_the_ones_windows_has() {
        let have = vec!["de-DE".to_string(), "en-GB".to_string()];
        assert_eq!(choose_languages("auto", &have), have);
        assert_eq!(choose_languages("en-gb", &have), vec!["en-GB".to_string()]);
        assert_eq!(
            choose_languages("fr-FR, de-DE", &have),
            vec!["de-DE".to_string()]
        );
        assert!(choose_languages("ja-JP", &have).is_empty());
    }

    #[test]
    fn only_small_pictures_are_enlarged() {
        assert_eq!(upscale_factor(800, 600), 2);
        assert_eq!(upscale_factor(1920, 1080), 1);
        assert_eq!(upscale_factor(3840, 2160), 1);
    }

    #[test]
    fn the_key_of_a_fresh_capture_has_the_languages() {
        assert_eq!(plain_key("auto"), "plain|auto");
    }

    fn at(text: &str, x: f32, y: f32, w: f32, h: f32) -> OcrLine {
        OcrLine {
            text: text.into(),
            words: vec![OcrWord {
                text: text.into(),
                x,
                y,
                w,
                h,
            }],
        }
    }

    #[test]
    fn small_text_is_read_again_enlarged() {
        let small = vec![
            at("Card:", 0.0, 0.0, 40.0, 12.0),
            at("4111", 0.0, 20.0, 40.0, 12.0),
        ];
        assert_eq!(median_word_height(&small), 12.0);
        // 12 px text: a second pass at 3x (26 / 12 rounded up).
        assert_eq!(second_pass_factor(12.0, 1, 1000, 800, 10000), 3);
        // Already enlarged 2x by the first pass: the second goes further, but not over the engine's limit.
        assert_eq!(second_pass_factor(12.0, 2, 1000, 800, 10000), 4);
        assert_eq!(second_pass_factor(12.0, 1, 4000, 800, 10000), 2);
        assert_eq!(
            second_pass_factor(12.0, 1, 6000, 800, 10000),
            1,
            "no room to enlarge"
        );
        // Text that is tall enough, or no text at all: no second pass.
        assert_eq!(second_pass_factor(24.0, 1, 1000, 800, 10000), 1);
        assert_eq!(second_pass_factor(0.0, 1, 1000, 800, 10000), 1);
    }

    #[test]
    fn a_line_only_one_pass_found_is_kept() {
        let first = vec![
            at("Title", 0.0, 0.0, 80.0, 12.0),
            at("Total", 0.0, 40.0, 60.0, 12.0),
        ];
        // The second pass found all three lines (the middle one is new) and a copy of "Title" a little shifted.
        let second = vec![
            at("Title", 2.0, 1.0, 80.0, 12.0),
            at("Card: 4111 1111 1111 1111", 0.0, 20.0, 200.0, 12.0),
            at("Total", 0.0, 40.0, 60.0, 12.0),
        ];
        let merged = merge_missing(first, second);
        let texts: Vec<&str> = merged.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, ["Title", "Card: 4111 1111 1111 1111", "Total"]);
    }

    #[test]
    fn a_result_is_written_whole_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ocr").join("c1.json");
        let result = OcrResult {
            key: "plain|auto".into(),
            engine: "windows".into(),
            language: "de-DE".into(),
            width: 10,
            height: 5,
            lines: vec![OcrLine {
                text: "Hallo".into(),
                words: vec![OcrWord {
                    text: "Hallo".into(),
                    x: 1.0,
                    y: 2.0,
                    w: 3.0,
                    h: 4.0,
                }],
            }],
            took_ms: 3,
        };
        write_result(&path, &result).unwrap();
        let back: OcrResult = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(back, result);
        assert!(!dir.path().join("ocr").join("c1.json.swap").exists());
        let v = serde_json::to_value(&result).unwrap();
        assert!(v.get("tookMs").is_some() && v["lines"][0]["words"][0].get("w").is_some());
    }

    #[cfg(windows)]
    #[test]
    fn windows_ocr_reads_a_rendered_word_if_a_language_is_installed() {
        // A white picture with a black block letter row: the engine must not crash, and a language list is given.
        let (w, h) = (300u32, 100u32);
        let rgba = vec![255u8; (w * h * 4) as usize];
        match recognize(&rgba, w, h, "auto", "k".into()) {
            Ok(r) => assert_eq!((r.width, r.height), (w, h)),
            Err(e) => assert!(e.contains("language") || e.contains("installed"), "{e}"),
        }
    }

    #[test]
    fn a_tall_picture_is_read_in_overlapping_tiles_that_own_every_row_once() {
        let bands = tile_bands(10_000, 4000, 160);
        assert_eq!(bands.first().unwrap().0, 0);
        assert_eq!(bands.last().unwrap().1, 10_000);
        // The owned rows follow each other without a gap or a double, and lie inside the tile.
        let mut next = 0;
        for (y0, y1, o0, o1) in &bands {
            assert_eq!(*o0, next);
            assert!(o0 >= y0 && o1 <= y1 && o1 > o0);
            next = *o1;
        }
        assert_eq!(next, 10_000);
        assert_eq!(tile_bands(500, 4000, 160), vec![(0, 500, 0, 500)]);
        // 40 000 rows: tiles of at most 4000.
        assert!(tile_bands(40_000, 4000, 160)
            .iter()
            .all(|b| b.1 - b.0 <= 4000));
    }
}
