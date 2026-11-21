//! Everything that leaves the app: rendered pictures staged as temp files, the clipboard (files + HTML + PNG + bitmap),
//! Save (formats are encoded by the web page; BMP and ZIP here), Paint, the Windows share sheet, the native drag and the
//! folder / file pickers.
//!
//! The web page renders the pictures (the one renderer for preview, copy and export) and hands them over as PNG, JPEG or
//! WebP bytes. They are staged in `%AppData%\SecondDawn\snipmunk\temp\<kind>\`, never anywhere else. A kind's folder is emptied
//! by the next export of that kind (`export_begin`) and the whole temp folder when the app quits.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{CmdError, CmdResult};

/// The kinds of staged files: one folder each.
const KINDS: [&str; 6] = ["copy", "drag", "paint", "print", "share", "save"];

pub fn temp_root() -> PathBuf {
    dawn_core::app_dir("snipmunk").join("temp")
}

/// Delete all staged files (at quit, and at the start of the app for what a crash left).
pub fn clear_temp() {
    let _ = fs::remove_dir_all(temp_root());
}

fn kind_dir(kind: &str) -> CmdResult<PathBuf> {
    if !KINDS.contains(&kind) {
        return Err(CmdError::new("bad_request", "unknown kind of export"));
    }
    Ok(temp_root().join(kind))
}

/// A file name without any folder part and without characters Windows does not accept.
pub fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "capture.png".into()
    } else {
        cleaned
    }
}

/// A path inside the temp folder (the web page only names staged files, never other files).
/// Files outside the temp folder that Save, Copy, drag and Share may use as they are: the rendered video of a recording and its
/// picture (a recording is never copied to a temp folder).
static ALLOWED: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

pub fn allow_file(path: &Path) {
    let mut v = ALLOWED.lock().unwrap();
    if !v.iter().any(|p| p == path) {
        v.push(path.to_path_buf());
    }
}

fn staged(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path);
    let root = temp_root();
    let ok = (p.starts_with(&root)
        && !p
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir)))
        || ALLOWED.lock().unwrap().contains(&p);
    if !ok || !p.is_file() {
        return Err(CmdError::new("bad_request", "this file was not staged"));
    }
    Ok(p)
}

/// Empty and create the folder of a kind; returns it. Called before staging a new set of files.
#[tauri::command]
pub fn export_begin(kind: String) -> CmdResult<String> {
    let dir = kind_dir(&kind)?;
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Write one file of a set (raw body) into the kind's folder. `x-convert: bmp` turns a PNG into a BMP on white.
#[tauri::command]
pub async fn export_stage(request: tauri::ipc::Request<'_>) -> CmdResult<String> {
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
    let kind = header("x-kind").ok_or_else(|| CmdError::new("bad_request", "no kind"))?;
    let name = safe_file_name(&header("x-name").unwrap_or_default());
    let dir = kind_dir(&kind)?;
    fs::create_dir_all(&dir)?;
    let data = match header("x-convert").as_deref() {
        Some("bmp") => png_to_bmp(bytes)?,
        _ => bytes.clone(),
    };
    let target = free_path(&dir, &name);
    let mut file = fs::File::create(&target)?;
    file.write_all(&data)?;
    file.sync_all()?;
    Ok(target.to_string_lossy().into_owned())
}

/// A BMP of a picture, transparency flattened onto white.
fn png_to_bmp(png: &[u8]) -> CmdResult<Vec<u8>> {
    let img = image::load_from_memory(png).map_err(|e| CmdError::new("unsupported", e))?;
    let rgb = flatten_on_white(&img.to_rgba8());
    let mut out = Vec::new();
    image::codecs::bmp::BmpEncoder::new(&mut out)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| CmdError::new("io", e))?;
    Ok(out)
}

fn flatten_on_white(img: &image::RgbaImage) -> image::RgbImage {
    let mut out = image::RgbImage::new(img.width(), img.height());
    for (x, y, p) in img.enumerate_pixels() {
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
        out.put_pixel(x, y, image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])]));
    }
    out
}

/// "name.ext" in `dir`, or "name (2).ext" (and so on) when a file of that name exists. Never overwrites.
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("an unbounded range")
}

/// Create `name` in `dir` for writing, never replacing a file (`create_new`), with " (2)" added when the name is taken.
fn create_unique(dir: &Path, name: &str) -> std::io::Result<(PathBuf, fs::File)> {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1.. {
        let file = if n == 1 {
            name.to_string()
        } else {
            format!("{stem} ({n}){ext}")
        };
        let path = dir.join(file);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(f) => return Ok((path, f)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

fn target_folder(folder: &str) -> CmdResult<PathBuf> {
    let dir = PathBuf::from(folder);
    if !dir.is_absolute() {
        return Err(CmdError::new(
            "bad_request",
            "the folder must be a full path",
        ));
    }
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Copy staged files into a folder under the given names; existing files stay (" (2)" is added). Returns the new paths.
#[tauri::command]
pub fn export_save(
    files: Vec<String>,
    names: Vec<String>,
    folder: String,
) -> CmdResult<Vec<String>> {
    if files.len() != names.len() {
        return Err(CmdError::new(
            "bad_request",
            "names and files differ in number",
        ));
    }
    let dir = target_folder(&folder)?;
    let mut saved = Vec::new();
    for (f, n) in files.iter().zip(&names) {
        let src = staged(f)?;
        let (path, mut out) = create_unique(&dir, &safe_file_name(n))?;
        let result = fs::File::open(&src)
            .and_then(|mut i| std::io::copy(&mut i, &mut out))
            .and_then(|_| out.sync_all());
        if let Err(e) = result {
            drop(out);
            let _ = fs::remove_file(&path);
            return Err(e.into());
        }
        saved.push(path.to_string_lossy().into_owned());
    }
    Ok(saved)
}

/// All staged files in one ZIP (stored: the pictures are compressed already) in a folder.
#[tauri::command]
pub fn export_zip(
    files: Vec<String>,
    names: Vec<String>,
    folder: String,
    zip_name: String,
) -> CmdResult<String> {
    if files.len() != names.len() {
        return Err(CmdError::new(
            "bad_request",
            "names and files differ in number",
        ));
    }
    let dir = target_folder(&folder)?;
    let (path, out) = create_unique(&dir, &safe_file_name(&zip_name))?;
    let result = (|| -> Result<(), String> {
        let mut zip = zip::ZipWriter::new(&out);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .large_file(false);
        for (f, n) in files.iter().zip(&names) {
            let src = staged(f).map_err(|e| e.message)?;
            zip.start_file(safe_file_name(n), options)
                .map_err(|e| e.to_string())?;
            let mut input = fs::File::open(src).map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut zip).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&path);
        return Err(CmdError::new("io", e));
    }
    Ok(path.to_string_lossy().into_owned())
}

// --- clipboard ---------------------------------------------------------------------------

/// The `CF_HDROP` payload: a DROPFILES header, then the wide paths, each ended by 0, and an extra 0.
pub fn hdrop_bytes(paths: &[PathBuf]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&20u32.to_le_bytes()); // offset of the file list
    out.extend_from_slice(&[0u8; 8]); // pt
    out.extend_from_slice(&0u32.to_le_bytes()); // fNC
    out.extend_from_slice(&1u32.to_le_bytes()); // fWide
    for p in paths {
        for u in p.to_string_lossy().encode_utf16() {
            out.extend_from_slice(&u.to_le_bytes());
        }
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

/// The bytes of one row of a 24-bit bitmap: every row is padded to a multiple of 4 bytes.
pub fn dib_stride(width: u32) -> usize {
    (width as usize * 3).div_ceil(4) * 4
}

/// A 24-bit `CF_DIB`: a 40 byte BITMAPINFOHEADER, then the rows bottom-up as BGR, each padded to a multiple of 4 bytes,
/// flattened on white so every program shows it the same. 24 bits and no alpha is what every program reads, and a quarter
/// smaller than 32 bits (a composed Grid of 4K captures is over 100 MB).
pub fn dib_bytes(img: &image::RgbaImage) -> Vec<u8> {
    let (w, h) = (img.width(), img.height());
    let stride = dib_stride(w);
    let size = stride * h as usize;
    let mut out = Vec::with_capacity(40 + size);
    out.extend_from_slice(&40u32.to_le_bytes()); // biSize
    out.extend_from_slice(&(w as i32).to_le_bytes());
    out.extend_from_slice(&(h as i32).to_le_bytes()); // positive: bottom-up
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 16]); // resolution, colours used / important
    for y in (0..h).rev() {
        let start = out.len();
        for x in 0..w {
            let p = img.get_pixel(x, y);
            let a = p[3] as u32;
            let mix = |c: u8| ((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
            out.extend_from_slice(&[mix(p[2]), mix(p[1]), mix(p[0])]);
        }
        out.resize(start + stride, 0);
    }
    out
}

/// Put the staged pictures on the clipboard: the file list (`files`, so they paste as files in Explorer, chats and mail), an
/// HTML fragment (`html`, ready-made "HTML Format" text, for Word, Outlook and Google Docs), and the first picture as PNG and
/// as a bitmap (for programs that take one image only).
#[tauri::command]
pub fn export_clipboard(
    app: AppHandle,
    files: Vec<String>,
    html: Option<String>,
    image: Option<String>,
) -> CmdResult<()> {
    let paths = files
        .iter()
        .map(|f| staged(f))
        .collect::<CmdResult<Vec<_>>>()?;
    let first = match image {
        Some(i) => Some(staged(&i)?),
        None => None,
    };
    let png = first.as_ref().map(fs::read).transpose()?;
    let dib = match &png {
        Some(bytes) => Some(dib_bytes(
            &image::load_from_memory(bytes)
                .map_err(|e| CmdError::new("unsupported", e))?
                .to_rgba8(),
        )),
        None => None,
    };
    set_clipboard(
        &app,
        &paths,
        html.as_deref(),
        png.as_deref(),
        dib.as_deref(),
    )
    .map_err(|e| CmdError::new("clipboard", e))
}

#[cfg(windows)]
fn set_clipboard(
    app: &AppHandle,
    files: &[PathBuf],
    html: Option<&str>,
    png: Option<&[u8]>,
    dib: Option<&[u8]>,
) -> Result<(), String> {
    use windows::core::w;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    unsafe fn put(format: u32, data: &[u8]) -> Result<(), String> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, data.len()).map_err(|e| e.to_string())?;
            let p = GlobalLock(h);
            if p.is_null() {
                return Err("the clipboard memory could not be locked".into());
            }
            std::ptr::copy_nonoverlapping(data.as_ptr(), p as *mut u8, data.len());
            let _ = GlobalUnlock(h);
            SetClipboardData(format, Some(HANDLE(h.0))).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // The clipboard needs an owner window, or SetClipboardData fails after EmptyClipboard.
    let hwnd = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| windows::Win32::Foundation::HWND(h.0))
        .ok_or("no window")?;
    unsafe {
        let mut opened = false;
        for _ in 0..20 {
            if OpenClipboard(Some(hwnd)).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        if !opened {
            return Err("the clipboard is in use by another program".into());
        }
        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| e.to_string())?;
            if !files.is_empty() {
                put(15, &hdrop_bytes(files))?; // CF_HDROP
            }
            if let Some(h) = html {
                let mut b = h.as_bytes().to_vec();
                b.push(0);
                put(RegisterClipboardFormatW(w!("HTML Format")), &b)?;
            }
            if let Some(p) = png {
                put(RegisterClipboardFormatW(w!("PNG")), p)?;
            }
            if let Some(d) = dib {
                put(8, d)?; // CF_DIB
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
fn set_clipboard(
    _app: &AppHandle,
    _files: &[PathBuf],
    _html: Option<&str>,
    png: Option<&[u8]>,
    _dib: Option<&[u8]>,
) -> Result<(), String> {
    let png = png.ok_or("nothing to copy")?;
    let img = image::load_from_memory(png)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    arboard::Clipboard::new()
        .and_then(|mut c| {
            c.set_image(arboard::ImageData {
                width: img.width() as usize,
                height: img.height() as usize,
                bytes: std::borrow::Cow::Owned(img.into_raw()),
            })
        })
        .map_err(|e| e.to_string())
}

/// The formats now on the clipboard, by name (for the tests of this feature).
#[tauri::command]
pub fn clipboard_formats() -> Vec<String> {
    #[cfg(windows)]
    {
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EnumClipboardFormats, GetClipboardFormatNameW, OpenClipboard,
        };
        let mut out = Vec::new();
        unsafe {
            if OpenClipboard(None).is_err() {
                return out;
            }
            let mut f = 0u32;
            loop {
                f = EnumClipboardFormats(f);
                if f == 0 {
                    break;
                }
                let mut buf = [0u16; 128];
                let n = GetClipboardFormatNameW(f, &mut buf);
                out.push(if n > 0 {
                    String::from_utf16_lossy(&buf[..n as usize])
                } else {
                    match f {
                        1 => "CF_TEXT".into(),
                        2 => "CF_BITMAP".into(),
                        8 => "CF_DIB".into(),
                        15 => "CF_HDROP".into(),
                        17 => "CF_DIBV5".into(),
                        13 => "CF_UNICODETEXT".into(),
                        other => other.to_string(),
                    }
                });
            }
            let _ = CloseClipboard();
        }
        out
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

// --- Paint, folders, share, drag, pickers ------------------------------------------------------

/// Open a staged picture in Paint; without Paint, in the default image editor (or viewer).
#[tauri::command]
pub fn export_open_editor(path: String) -> CmdResult<()> {
    let p = staged(&path)?;
    #[cfg(windows)]
    {
        if std::process::Command::new("mspaint.exe")
            .arg(&p)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        if shell_execute("edit", &p) || shell_execute("open", &p) {
            return Ok(());
        }
        Err(CmdError::new("io", "no program could open the picture"))
    }
    #[cfg(not(windows))]
    {
        let cmd = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        std::process::Command::new(cmd)
            .arg(&p)
            .spawn()
            .map(|_| ())
            .map_err(|e| CmdError::new("io", e))
    }
}

#[cfg(windows)]
fn shell_execute(verb: &str, path: &Path) -> bool {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let verb = HSTRING::from(verb);
    let file = HSTRING::from(path.as_os_str());
    let r = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    r.0 as isize > 32
}

/// Open a folder in Explorer, or show a file in its folder (the file selected).
#[tauri::command]
pub fn open_folder(path: String) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(CmdError::new("not_found", "this folder does not exist"));
    }
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        // Explorer wants backslashes and its own quoting: `/select,"C:\a b\c.png"`. Passing it as an ordinary argument
        // quotes the whole thing, and Explorer then opens Documents instead.
        std::process::Command::new("explorer")
            .raw_arg(explorer_arg(&p, p.is_file()))
            .spawn()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&p).spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&p).spawn();
    result
        .map(|_| ())
        .map_err(|e| CmdError::new("io", e.to_string()))
}

/// Open a file with the program Windows has for it (the exported video in the player of the person's choice).
#[tauri::command]
pub fn open_file(path: String) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(CmdError::new("not_found", "this file does not exist"));
    }
    #[cfg(windows)]
    {
        if shell_execute("open", &p) {
            return Ok(());
        }
        Err(CmdError::new("io", "the file could not be opened"))
    }
    #[cfg(not(windows))]
    {
        open_folder(path)
    }
}

/// Show a recording (its video, selected) or an automatically saved screenshot in Explorer. The path is worked out here from the
/// current state of the library, so it is right after a rename, a move to another group or a new recordings folder.
#[tauri::command]
pub fn show_in_explorer(
    state: tauri::State<'_, crate::commands::AppState>,
    capture_id: String,
) -> CmdResult<()> {
    let path = state.sessions.lock().unwrap().explorer_path(&capture_id);
    match path {
        Some(p) => open_folder(p.to_string_lossy().into_owned()),
        None => Err(CmdError::new(
            "not_found",
            "the file or folder is not there any more",
        )),
    }
}

/// The command line argument for Explorer: a folder to open, or `/select,"file"` to show a file in its folder.
pub fn explorer_arg(path: &Path, select: bool) -> String {
    let p = path.to_string_lossy().replace('/', "\\");
    if select {
        format!("/select,\"{p}\"")
    } else {
        format!("\"{p}\"")
    }
}

/// The folder of the current session's images (for "Open screenshots folder" when no export folder is set).
#[tauri::command]
pub fn session_images_folder(state: tauri::State<'_, crate::commands::AppState>) -> String {
    let store = state.sessions.lock().unwrap();
    store
        .session_dir()
        .join("images")
        .to_string_lossy()
        .into_owned()
}

/// The user's Pictures folder (the default of the Save dialog).
#[tauri::command]
pub fn pictures_folder() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Pictures, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        unsafe {
            if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Pictures, KF_FLAG_DEFAULT, None) {
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as *const _));
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|h| format!("{h}{}Pictures", std::path::MAIN_SEPARATOR))
        .unwrap_or_default()
}

/// Is the Windows share sheet available?
#[tauri::command]
pub fn share_supported() -> bool {
    cfg!(windows)
}

/// Show the Windows share sheet for staged pictures.
#[tauri::command]
pub async fn export_share(app: AppHandle, files: Vec<String>) -> CmdResult<()> {
    let paths = files
        .iter()
        .map(|f| staged(f))
        .collect::<CmdResult<Vec<_>>>()?;
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = tx.send(share_windows(&handle, paths));
        })
        .map_err(|e| CmdError::new("io", e))?;
        rx.recv()
            .map_err(|e| CmdError::new("io", e))?
            .map_err(|e| CmdError::new("share", e))
    }
    #[cfg(not(windows))]
    {
        let _ = (app, paths);
        Err(CmdError::new("unsupported", "sharing needs Windows"))
    }
}

#[cfg(windows)]
fn share_windows(app: &AppHandle, paths: Vec<PathBuf>) -> Result<(), String> {
    use windows::core::{factory, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;
    use windows_collections::IIterable;

    let hwnd = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| windows::Win32::Foundation::HWND(h.0))
        .ok_or("no window")?;
    let e = |e: windows::core::Error| e.to_string();
    unsafe {
        let interop = factory::<DataTransferManager, IDataTransferManagerInterop>().map_err(e)?;
        let manager: DataTransferManager = interop.GetForWindow(hwnd).map_err(e)?;
        let handler = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
            move |_, args| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                let data = args.Request()?.Data()?;
                data.Properties()?.SetTitle(&HSTRING::from("Snipmunk"))?;
                let mut items: Vec<Option<IStorageItem>> = Vec::new();
                for p in &paths {
                    let file =
                        StorageFile::GetFileFromPathAsync(&HSTRING::from(p.as_os_str()))?.get()?;
                    items.push(Some(file.cast::<IStorageItem>()?));
                }
                data.SetStorageItems(&IIterable::<IStorageItem>::from(items), true)?;
                Ok(())
            },
        );
        manager.DataRequested(&handler).map_err(e)?;
        interop.ShowShareUIForWindow(hwnd).map_err(e)?;
    }
    Ok(())
}

/// Start the native drag of staged pictures (the files, to Explorer, chats, Word, mail). `preview` is a staged picture shown
/// under the pointer.
#[tauri::command]
pub async fn export_drag(app: AppHandle, files: Vec<String>, preview: String) -> CmdResult<()> {
    let paths = files
        .iter()
        .map(|f| staged(f))
        .collect::<CmdResult<Vec<_>>>()?;
    let icon = staged(&preview)?;
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = match handle.get_webview_window("main") {
            Some(w) => drag::start_drag(
                &w,
                drag::DragItem::Files(paths),
                drag::Image::File(icon),
                |_, _| {},
                drag::Options::default(),
            )
            .map_err(|e| e.to_string()),
            None => Err("no window".to_string()),
        };
        let _ = tx.send(result);
    })
    .map_err(|e| CmdError::new("io", e))?;
    rx.recv()
        .map_err(|e| CmdError::new("io", e))?
        .map_err(|e| CmdError::new("drag", e))
}

/// A folder picker (starts in `start` when it exists). `None` when the user cancels.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, start: Option<String>) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file();
    if let Some(s) = start.filter(|s| Path::new(s).is_dir()) {
        dialog = dialog.set_directory(s);
    }
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.pick_folder(move |f| {
        let _ = tx.send(f);
    });
    let chosen = rx.recv().map_err(|e| CmdError::new("io", e))?;
    Ok(chosen
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

/// A file picker with several choices for the image types Snipmunk can import. Returns the chosen paths (empty = cancelled).
#[tauri::command]
pub async fn pick_images(app: AppHandle) -> CmdResult<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp", "gif"]);
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.pick_files(move |f| {
        let _ = tx.send(f);
    });
    let chosen = rx.recv().map_err(|e| CmdError::new("io", e))?;
    Ok(chosen
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// Read a file the user picked, for the import (the web page cannot read it). Only image files up to 200 MB.
#[tauri::command]
pub fn read_picked_file(path: String) -> CmdResult<tauri::ipc::Response> {
    let p = PathBuf::from(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !["png", "jpg", "jpeg", "webp", "bmp", "gif"].contains(&ext.as_str()) {
        return Err(CmdError::new("unsupported", "this is not an image file"));
    }
    if p.metadata()?.len() > 200 * 1024 * 1024 {
        return Err(CmdError::new("unsupported", "this file is too big"));
    }
    Ok(tauri::ipc::Response::new(fs::read(p)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_lose_folders_and_invalid_characters() {
        assert_eq!(safe_file_name("a/b\\c.png"), "c.png");
        assert_eq!(safe_file_name("a:b*c?.png"), "a_b_c_.png");
        assert_eq!(safe_file_name("  "), "capture.png");
        assert_eq!(safe_file_name("x."), "x");
        assert_eq!(safe_file_name("..\\..\\evil.png"), "evil.png");
    }

    #[test]
    fn a_taken_name_gets_a_number_and_nothing_is_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.png"), b"1").unwrap();
        assert_eq!(free_path(dir.path(), "a.png"), dir.path().join("a (2).png"));
        let (p1, _f1) = create_unique(dir.path(), "a.png").unwrap();
        let (p2, _f2) = create_unique(dir.path(), "a.png").unwrap();
        assert_eq!(p1.file_name().unwrap(), "a (2).png");
        assert_eq!(p2.file_name().unwrap(), "a (3).png");
        assert_eq!(fs::read(dir.path().join("a.png")).unwrap(), b"1");
    }

    #[test]
    fn the_file_list_format_has_the_header_and_a_double_zero_end() {
        let b = hdrop_bytes(&[PathBuf::from("C:\\a.png"), PathBuf::from("C:\\b.png")]);
        assert_eq!(u32::from_le_bytes(b[0..4].try_into().unwrap()), 20);
        assert_eq!(u32::from_le_bytes(b[16..20].try_into().unwrap()), 1, "wide");
        assert_eq!(&b[b.len() - 4..], &[0, 0, 0, 0]);
        let units: Vec<u16> = b[20..]
            .chunks(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let text = String::from_utf16(&units).unwrap();
        assert_eq!(text, "C:\\a.png\0C:\\b.png\0\0");
    }

    /// Read a pixel (x, y of the picture, top-left origin) out of the bytes of a 24-bit bottom-up DIB.
    fn dib_pixel(d: &[u8], w: u32, h: u32, x: u32, y: u32) -> [u8; 3] {
        let stride = dib_stride(w);
        let at = 40 + (h - 1 - y) as usize * stride + x as usize * 3;
        [d[at + 2], d[at + 1], d[at]] // BGR -> RGB
    }

    fn header(d: &[u8]) -> (u32, i32, i32, u16, u16, u32, u32) {
        let u32at = |i: usize| u32::from_le_bytes(d[i..i + 4].try_into().unwrap());
        (
            u32at(0),
            u32at(4) as i32,
            u32at(8) as i32,
            u16::from_le_bytes(d[12..14].try_into().unwrap()),
            u16::from_le_bytes(d[14..16].try_into().unwrap()),
            u32at(16),
            u32at(20),
        )
    }

    #[test]
    fn the_bitmap_is_bottom_up_bgr_on_white_with_padded_rows() {
        let mut img = image::RgbaImage::new(2, 2);
        img.put_pixel(0, 0, image::Rgba([255, 0, 0, 255])); // top left red
        img.put_pixel(1, 0, image::Rgba([0, 0, 0, 0])); // top right transparent
        img.put_pixel(0, 1, image::Rgba([0, 0, 255, 255])); // bottom left blue
        img.put_pixel(1, 1, image::Rgba([0, 255, 0, 255]));
        let d = dib_bytes(&img);
        // 2 pixels * 3 bytes = 6, padded to 8 per row.
        assert_eq!(d.len(), 40 + 2 * 8);
        assert_eq!(header(&d), (40, 2, 2, 1, 24, 0, 16));
        assert_eq!(dib_pixel(&d, 2, 2, 0, 0), [255, 0, 0]);
        assert_eq!(
            dib_pixel(&d, 2, 2, 1, 0),
            [255, 255, 255],
            "transparent -> white"
        );
        assert_eq!(dib_pixel(&d, 2, 2, 0, 1), [0, 0, 255]);
        assert_eq!(dib_pixel(&d, 2, 2, 1, 1), [0, 255, 0]);
        // The bottom row of the picture is the first row in the file.
        assert_eq!(&d[40..43], &[255, 0, 0]);
        assert_eq!(&d[46..48], &[0, 0], "row padding is zero");
    }

    #[test]
    fn odd_sizes_have_the_right_stride_and_every_pixel_in_place() {
        for (w, h) in [
            (1u32, 1u32),
            (3, 5),
            (2417, 637),
            (4, 4),
            (5, 2),
            (2416, 636),
        ] {
            let mut img = image::RgbaImage::new(w, h);
            for (x, y, p) in img.enumerate_pixels_mut() {
                *p = image::Rgba([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8, 255]);
            }
            let d = dib_bytes(&img);
            let stride = dib_stride(w);
            assert_eq!(stride % 4, 0, "{w}x{h}");
            assert!(stride >= w as usize * 3 && stride < w as usize * 3 + 4);
            assert_eq!(d.len(), 40 + stride * h as usize, "{w}x{h}");
            assert_eq!(
                header(&d),
                (
                    40,
                    w as i32,
                    h as i32,
                    1,
                    24,
                    0,
                    (stride * h as usize) as u32
                )
            );
            for (x, y) in [
                (0, 0),
                (w - 1, 0),
                (0, h - 1),
                (w - 1, h - 1),
                (w / 2, h / 2),
            ] {
                let p = img.get_pixel(x, y);
                assert_eq!(
                    dib_pixel(&d, w, h, x, y),
                    [p[0], p[1], p[2]],
                    "{w}x{h} at {x},{y}"
                );
            }
        }
    }

    #[test]
    fn the_stride_of_24_bit_rows() {
        assert_eq!(dib_stride(1), 4);
        assert_eq!(dib_stride(2), 8);
        assert_eq!(dib_stride(3), 12);
        assert_eq!(dib_stride(4), 12);
        assert_eq!(dib_stride(2417), 7252);
    }

    #[test]
    fn a_bmp_is_made_from_a_png_on_white() {
        let mut img = image::RgbaImage::new(3, 2);
        for p in img.pixels_mut() {
            *p = image::Rgba([10, 20, 30, 0]);
        }
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let bmp = png_to_bmp(&png).unwrap();
        assert_eq!(&bmp[0..2], b"BM");
        let back = image::load_from_memory(&bmp).unwrap().to_rgb8();
        assert_eq!((back.width(), back.height()), (3, 2));
        assert_eq!(back.get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    fn a_zip_holds_every_file_and_a_second_zip_gets_a_new_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = temp_root().join("save");
        fs::create_dir_all(&root).unwrap();
        let a = root.join("zt_a.png");
        let b = root.join("zt_b.png");
        fs::write(&a, b"AAAA").unwrap();
        fs::write(&b, b"BBBBBB").unwrap();
        let files = vec![
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        ];
        let names = vec!["one.png".to_string(), "two.png".to_string()];
        let folder = dir.path().to_string_lossy().into_owned();
        let z1 = export_zip(files.clone(), names.clone(), folder.clone(), "x.zip".into()).unwrap();
        let z2 = export_zip(files, names, folder, "x.zip".into()).unwrap();
        assert!(z1.ends_with("x.zip") && z2.ends_with("x (2).zip"));
        let mut archive = zip::ZipArchive::new(fs::File::open(&z1).unwrap()).unwrap();
        assert_eq!(archive.len(), 2);
        let mut s = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("two.png").unwrap(), &mut s).unwrap();
        assert_eq!(s, "BBBBBB");
        let _ = fs::remove_file(a);
        let _ = fs::remove_file(b);
    }

    #[test]
    fn explorer_gets_backslashes_and_its_own_quoting() {
        assert_eq!(
            explorer_arg(Path::new("C:/Users/Me/My Pictures/a b.png"), true),
            "/select,\"C:\\Users\\Me\\My Pictures\\a b.png\""
        );
        assert_eq!(
            explorer_arg(Path::new("C:/Users/Me/Pictures"), false),
            "\"C:\\Users\\Me\\Pictures\""
        );
    }

    #[test]
    fn only_staged_files_can_be_used() {
        assert!(staged("C:\\Windows\\win.ini").is_err());
        assert!(staged(
            &temp_root()
                .join("..")
                .join("settings.json")
                .to_string_lossy()
        )
        .is_err());
    }

    #[test]
    fn saving_never_replaces_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = temp_root().join("save");
        fs::create_dir_all(&root).unwrap();
        let a = root.join("st_a.png");
        fs::write(&a, b"NEW").unwrap();
        fs::write(dir.path().join("x.png"), b"OLD").unwrap();
        let out = export_save(
            vec![a.to_string_lossy().into_owned()],
            vec!["x.png".into()],
            dir.path().to_string_lossy().into_owned(),
        )
        .unwrap();
        assert!(out[0].ends_with("x (2).png"));
        assert_eq!(fs::read(dir.path().join("x.png")).unwrap(), b"OLD");
        assert_eq!(fs::read(&out[0]).unwrap(), b"NEW");
        let _ = fs::remove_file(a);
    }
}
