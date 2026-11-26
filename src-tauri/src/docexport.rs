//! Export of guides (Documents mode): the pictures as they go into every export (redactions burned in, cut to the shown area),
//! writing the exported files, and the PDF, which the web view prints from the paginated page the app makes (no PDF library).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{CmdError, CmdResult};

fn io(e: impl std::fmt::Display) -> CmdError {
    CmdError::new("io", e.to_string())
}

/// A redaction of a step picture (picture pixels).
#[derive(Debug, Clone, Deserialize)]
pub struct Redact {
    pub rect: [i32; 4],
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPicture {
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

/// The picture an export shows: the redactions are burned into the WHOLE picture first, then the area is cut out; where the area is
/// larger than the picture (a picture frame at the edge of the screen) the background colour pads it. Nothing outside the area and no
/// unredacted pixel is in the result.
pub fn export_image(
    mut img: image::RgbaImage,
    area: Option<[i32; 4]>,
    redact: &[([i32; 4], String)],
    background: [u8; 4],
) -> image::RgbaImage {
    crate::snpd::burn_redactions(&mut img, redact);
    let Some([x, y, w, h]) = area else {
        return img;
    };
    let (w, h) = (w.clamp(1, 16384) as u32, h.clamp(1, 16384) as u32);
    let mut out = image::RgbaImage::from_pixel(w, h, image::Rgba(background));
    // Only the part of the picture inside the area is copied.
    let x0 = x.max(0);
    let y0 = y.max(0);
    let x1 = (x as i64 + w as i64).min(img.width() as i64) as i32;
    let y1 = (y as i64 + h as i64).min(img.height() as i64) as i32;
    if x1 > x0 && y1 > y0 {
        let part = image::imageops::crop_imm(
            &img,
            x0 as u32,
            y0 as u32,
            (x1 - x0) as u32,
            (y1 - y0) as u32,
        )
        .to_image();
        image::imageops::replace(&mut out, &part, (x0 - x) as i64, (y0 - y) as i64);
    }
    out
}

fn colour(text: Option<&str>) -> [u8; 4] {
    let t = text.unwrap_or("").trim_start_matches('#');
    match (t.len(), u32::from_str_radix(t, 16)) {
        (6, Ok(v)) => [(v >> 16) as u8, (v >> 8) as u8, v as u8, 255],
        _ => [255, 255, 255, 255],
    }
}

/// A picture of the open guide's working folder for an export (see `export_image`), as a base64 PNG.
#[tauri::command]
pub async fn doc_export_picture(
    file: String,
    area: Option<[i32; 4]>,
    redact: Option<Vec<Redact>>,
    background: Option<String>,
) -> CmdResult<ExportPicture> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::guides::image_path("current", &file)
            .ok_or_else(|| CmdError::new("not_found", format!("no picture {file}")))?;
        let img = image::open(&path).map_err(io)?.to_rgba8();
        let redact: Vec<([i32; 4], String)> = redact
            .unwrap_or_default()
            .into_iter()
            .map(|r| (r.rect, r.kind))
            .collect();
        let out = export_image(img, area, &redact, colour(background.as_deref()));
        let png = crate::thumbs::png_bytes(&out, image::codecs::png::CompressionType::Default)
            .map_err(io)?;
        Ok(ExportPicture {
            base64: crate::snpd::base64(&png),
            width: out.width(),
            height: out.height(),
        })
    })
    .await
    .map_err(io)?
}

/// The area to read as [x, y, width, height] inside a picture of the given size; the whole picture without one.
fn ocr_area(area: Option<[i32; 4]>, width: u32, height: u32) -> [u32; 4] {
    let Some([x, y, w, h]) = area else {
        return [0, 0, width, height];
    };
    let x0 = (x as i64).clamp(0, (width as i64 - 1).max(0));
    let y0 = (y as i64).clamp(0, (height as i64 - 1).max(0));
    let x1 = (x as i64 + w as i64).clamp(x0 + 1, (width as i64).max(x0 + 1));
    let y1 = (y as i64 + h as i64).clamp(y0 + 1, (height as i64).max(y0 + 1));
    [x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32]
}

/// What a kept reading was made from: the picture file (size and time of change), the area and the languages.
fn ocr_key(path: &Path, area: Option<[i32; 4]>, languages: &str) -> String {
    let (len, changed) = std::fs::metadata(path)
        .map(|m| {
            let changed = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos());
            (m.len(), changed)
        })
        .unwrap_or_default();
    format!("guide3|{len}|{changed}|{area:?}|{languages}")
}

/// The reading of a picture, kept in the folder `ocr` next to it (never part of a saved guide) and used again while the
/// picture, the area and the languages are the same.
fn read_guide_picture(
    path: &Path,
    area: Option<[i32; 4]>,
    languages: &str,
) -> CmdResult<crate::ocr::OcrResult> {
    let key = ocr_key(path, area, languages);
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let kept = path.with_file_name("ocr").join(format!("{name}.json"));
    if let Some(r) = std::fs::read(&kept)
        .ok()
        .and_then(|b| serde_json::from_slice::<crate::ocr::OcrResult>(&b).ok())
        .filter(|r| r.key == key)
    {
        return Ok(r);
    }
    let img = image::open(path).map_err(io)?.into_rgba8();
    let (w, h) = img.dimensions();
    let r = crate::ocr::recognize_area(img.as_raw(), w, h, ocr_area(area, w, h), languages, key)
        .map_err(|e| CmdError::new("ocr", e))?;
    // Keeping it is a convenience: a full disk does not fail the scan.
    if let Err(e) = crate::ocr::write_result(&kept, &r) {
        eprintln!("[guide] the reading of {name} was not kept: {e}");
    }
    Ok(r)
}

/// Read the text of a picture of the open guide's working folder for Quick redact: the part `area` (what the step shows and
/// can save, with a margin), or the whole picture. Runs on a worker thread.
#[tauri::command]
pub async fn doc_ocr(
    state: tauri::State<'_, crate::commands::AppState>,
    file: String,
    area: Option<[i32; 4]>,
) -> CmdResult<crate::ocr::OcrResult> {
    let setting = state.settings.lock().unwrap().ocr_languages.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::guides::image_path("current", &file)
            .ok_or_else(|| CmdError::new("not_found", format!("no picture {file}")))?;
        read_guide_picture(&path, area, &setting)
    })
    .await
    .map_err(io)?
}

/// What stands after labels ("IBAN:") on a picture of the open guide, for Quick redact: for every label box ([x, y, width,
/// height]) the box of the ink that follows it on its row, or nothing. Runs on a worker thread.
#[tauri::command]
pub async fn doc_ink(file: String, labels: Vec<[u32; 4]>) -> CmdResult<Vec<Option<[u32; 4]>>> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::guides::image_path("current", &file)
            .ok_or_else(|| CmdError::new("not_found", format!("no picture {file}")))?;
        let img = image::open(&path).map_err(io)?.into_rgba8();
        let (w, h) = img.dimensions();
        Ok(labels
            .into_iter()
            .take(200)
            .map(|label| snipmunk_pixels::ink_after(img.as_raw(), w, h, label))
            .collect())
    })
    .await
    .map_err(io)?
}

/// The kinds of file an export writes.
const KINDS: &[&str] = &["pdf", "docx", "md", "html", "zip", "png", "jpg", "snpt"];

fn allowed(path: &Path) -> bool {
    path.is_absolute()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| KINDS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Write a file completely (a temporary file beside it, then renamed): never half a file under the chosen name.
pub fn write_file(path: &Path, bytes: &[u8]) -> CmdResult<()> {
    use std::io::Write;
    if !allowed(path) {
        return Err(CmdError::new(
            "bad_request",
            "this is not a file an export writes",
        ));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let tmp = path.with_extension("part");
    {
        let mut f = std::fs::File::create(&tmp).map_err(io)?;
        f.write_all(bytes).map_err(io)?;
        f.sync_all().map_err(io)?;
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        io(e)
    })
}

#[tauri::command]
pub async fn export_write(path: String, base64: String) -> CmdResult<u64> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::snpd::unbase64(&base64);
        if bytes.is_empty() {
            return Err(CmdError::new("bad_request", "nothing to write"));
        }
        write_file(Path::new(&path), &bytes)?;
        Ok(bytes.len() as u64)
    })
    .await
    .map_err(io)?
}

/// A save dialog for an export of one kind. `None` when cancelled.
#[tauri::command]
pub async fn pick_export_save(
    app: AppHandle,
    start: Option<String>,
    name: String,
    kind: String,
) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    if !KINDS.contains(&kind.as_str()) {
        return Err(CmdError::new("bad_request", "unknown kind of file"));
    }
    // A measurement run has no one to answer a file dialog: it names the file.
    if let Some(path) = crate::capture::picked_by_the_test(&kind) {
        return Ok(Some(path));
    }
    let mut dialog = app
        .dialog()
        .file()
        .add_filter(kind.to_uppercase(), &[kind.as_str()])
        .set_file_name(format!("{}.{kind}", crate::recstore::safe_name(&name)));
    if let Some(s) = start.filter(|s| Path::new(s).is_dir()) {
        dialog = dialog.set_directory(s);
    }
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.save_file(move |f| {
        let _ = tx.send(f);
    });
    let chosen = rx.recv().map_err(io)?;
    Ok(chosen.and_then(|f| f.into_path().ok()).map(|p| {
        let mut s = p.to_string_lossy().into_owned();
        if !s.to_lowercase().ends_with(&format!(".{kind}")) {
            s.push('.');
            s.push_str(&kind);
        }
        s
    }))
}

/// The person cancelled the export that runs.
static CANCEL: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn export_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Print a page to PDF with the web view: the page is written to a temporary file, loaded in a hidden window of our own (it has a
/// content security policy that allows no network and no script) and printed with no margins, so every `.page` of it is one page.
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    html: String,
    path: String,
    width_mm: f64,
    height_mm: f64,
) -> CmdResult<u64> {
    let target = PathBuf::from(&path);
    if !allowed(&target) || !path.to_lowercase().ends_with(".pdf") {
        return Err(CmdError::new("bad_request", "not a PDF file name"));
    }
    if !(20.0..=2000.0).contains(&width_mm) || !(20.0..=2000.0).contains(&height_mm) {
        return Err(CmdError::new(
            "bad_request",
            "this page size is not possible",
        ));
    }
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        print_pdf(&app, &html, &target, width_mm, height_mm)
    })
    .await
    .map_err(io)?
}

/// Runs on a worker thread: it waits for the page and for the printer, which work on the main thread.
#[cfg(windows)]
fn print_pdf(
    app: &AppHandle,
    html: &str,
    target: &Path,
    width_mm: f64,
    height_mm: f64,
) -> CmdResult<u64> {
    use std::sync::mpsc::channel;
    use tauri::webview::PageLoadEvent;
    let dir = crate::projects::temp_base().join("export");
    std::fs::create_dir_all(&dir).map_err(io)?;
    let page = dir.join(format!("print-{}.html", crate::guides::now_ms()));
    std::fs::write(&page, html).map_err(io)?;
    let url = tauri::Url::from_file_path(&page)
        .map_err(|()| CmdError::new("io", "the print page has no address"))?;
    if let Some(old) = app.get_webview_window("exportprint") {
        let _ = old.close();
        std::thread::sleep(Duration::from_millis(300));
    }
    let (loaded_tx, loaded_rx) = channel();
    let window = crate::webview::window(app, "exportprint", tauri::WebviewUrl::External(url))
        .title("Snipmunk – Export")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(900.0, 1200.0)
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = loaded_tx.send(());
            }
        })
        .build()
        .map_err(io)?;
    let finish = |window: &tauri::WebviewWindow| {
        let _ = window.close();
        let _ = std::fs::remove_file(&page);
    };
    let result = (|| -> CmdResult<u64> {
        loaded_rx
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| CmdError::new("export", "the page did not load"))?;
        // Fonts and pictures of the page settle.
        std::thread::sleep(Duration::from_millis(400));
        let part = target.with_extension("part.pdf");
        let _ = std::fs::remove_file(&part);
        let (done_tx, done_rx) = channel::<Result<bool, String>>();
        let out = part.clone();
        window
            .with_webview(move |webview| {
                if let Err(e) = start_print(&webview, &out, width_mm, height_mm, done_tx.clone()) {
                    let _ = done_tx.send(Err(e.to_string()));
                }
            })
            .map_err(io)?;
        let start = Instant::now();
        let ok = loop {
            if CANCEL.load(Ordering::SeqCst) {
                return Err(CmdError::new("cancelled", "the export was cancelled"));
            }
            match done_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(r) => break r.map_err(|e| CmdError::new("export", e))?,
                Err(_) if start.elapsed() > Duration::from_secs(300) => {
                    return Err(CmdError::new("export", "printing took too long"))
                }
                Err(_) => {}
            }
        };
        if !ok || !part.is_file() {
            return Err(CmdError::new("export", "the PDF could not be written"));
        }
        let _ = std::fs::remove_file(target);
        std::fs::rename(&part, target).map_err(io)?;
        Ok(std::fs::metadata(target).map_err(io)?.len())
    })();
    finish(&window);
    result
}

#[cfg(windows)]
fn start_print(
    webview: &tauri::webview::PlatformWebview,
    out: &Path,
    width_mm: f64,
    height_mm: f64,
    done: std::sync::mpsc::Sender<Result<bool, String>>,
) -> windows_core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING, PCWSTR};
    const INCH: f64 = 25.4;
    // SAFETY: COM calls on the main thread of the web view, on interfaces that belong to it.
    unsafe {
        let core = webview.controller().CoreWebView2()?;
        let seven: ICoreWebView2_7 = core.cast()?;
        let env: ICoreWebView2Environment6 = webview.environment().cast()?;
        let settings = env.CreatePrintSettings()?;
        settings.SetPageWidth(width_mm / INCH)?;
        settings.SetPageHeight(height_mm / INCH)?;
        settings.SetMarginTop(0.0)?;
        settings.SetMarginBottom(0.0)?;
        settings.SetMarginLeft(0.0)?;
        settings.SetMarginRight(0.0)?;
        settings.SetScaleFactor(1.0)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            let _ = done.send(result.map(|()| ok).map_err(|e| e.to_string()));
            Ok(())
        }));
        let file = HSTRING::from(out.as_os_str());
        seven.PrintToPdf(PCWSTR(file.as_ptr()), &settings, &handler)
    }
}

#[cfg(not(windows))]
fn print_pdf(_: &AppHandle, _: &str, _: &Path, _: f64, _: f64) -> CmdResult<u64> {
    Err(CmdError::new(
        "unavailable",
        "PDF export is available on Windows",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_picture_is_cut_to_the_area_with_redactions_burned_in_and_padding_outside() {
        // A red 20x10 area at (10,10) in a grey 100x50 picture, and a "secret" blue area at (60,20).
        let mut img = image::RgbaImage::from_pixel(100, 50, image::Rgba([200, 200, 200, 255]));
        for y in 10..20 {
            for x in 10..30 {
                img.put_pixel(x, y, image::Rgba([255, 0, 0, 255]));
            }
        }
        for y in 20..30 {
            for x in 60..80 {
                img.put_pixel(x, y, image::Rgba([0, 0, 255, 255]));
            }
        }
        let out = export_image(
            img.clone(),
            Some([40, 0, 80, 50]),
            &[([60, 20, 20, 10], "black".into())],
            [9, 8, 7, 255],
        );
        assert_eq!((out.width(), out.height()), (80, 50));
        assert!(
            !out.pixels().any(|p| p.0 == [255, 0, 0, 255]),
            "outside the area"
        );
        assert!(
            !out.pixels().any(|p| p.0 == [0, 0, 255, 255]),
            "no unredacted pixel"
        );
        assert_eq!(out.get_pixel(25, 25).0, [0, 0, 0, 255]);
        // The area goes 20 px past the right edge of the picture: padded with the background.
        assert_eq!(out.get_pixel(79, 10).0, [9, 8, 7, 255]);
        assert_eq!(out.get_pixel(10, 10).0, [200, 200, 200, 255]);
        // Without an area the whole picture, still redacted.
        let whole = export_image(img, None, &[([60, 20, 20, 10], "pixelate".into())], [0; 4]);
        assert_eq!((whole.width(), whole.height()), (100, 50));
    }

    #[test]
    fn only_export_files_are_written() {
        let base = std::env::var("SNIPMUNK_TEST_DIR").unwrap_or_else(|_| ".".into());
        let d = tempfile::tempdir_in(base).unwrap();
        let d = std::fs::canonicalize(d.path()).unwrap();
        write_file(&d.join("a/guide.html"), b"x").unwrap();
        assert_eq!(std::fs::read(d.join("a/guide.html")).unwrap(), b"x");
        assert!(write_file(&d.join("a/run.exe"), b"x").is_err());
        assert!(write_file(Path::new("relative.pdf"), b"x").is_err());
    }
}
