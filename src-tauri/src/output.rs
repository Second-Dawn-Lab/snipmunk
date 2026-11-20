//! What happens to a finished capture: clipboard, PNG and thumbnail on disk, the active group, the windows.

use std::borrow::Cow;

use dawn_capture::Frame;
use image::codecs::png::CompressionType;
use image::RgbaImage;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;
use crate::naming;
use crate::popups::{self, ToastInfo};
use crate::thumbs::{png_bytes, thumbnail_png};

/// Local time as (hour, minute), for the fallback name.
#[cfg(windows)]
fn local_hm() -> (u32, u32) {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe { GetLocalTime() };
    (t.wHour as u32, t.wMinute as u32)
}

#[cfg(not(windows))]
fn local_hm() -> (u32, u32) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (((secs / 3600) % 24) as u32, ((secs / 60) % 60) as u32)
}

/// PNG bytes of a frame (fast compression: a 4K screenshot must not take seconds) and a thumbnail PNG.
pub fn encode(frame: &Frame) -> Result<(Vec<u8>, Vec<u8>), String> {
    let image = RgbaImage::from_raw(frame.width, frame.height, frame.rgba.clone())
        .ok_or("the screenshot has an unexpected size")?;
    Ok((
        png_bytes(&image, CompressionType::Fast)?,
        thumbnail_png(&image)?,
    ))
}

/// Put the capture on the clipboard as an image (with its transparency, for a freeform capture).
pub fn copy_to_clipboard(frame: &Frame) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: frame.width as usize,
            height: frame.height as usize,
            bytes: Cow::Borrowed(&frame.rgba),
        })
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureAdded<'a> {
    capture_id: &'a str,
    group_id: &'a str,
}

/// Save a finished capture and tell the user. Runs on its own thread, never on the UI thread.
pub fn deliver(app: &AppHandle, frame: Frame, title: Option<String>) -> Result<(), String> {
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    let copied = settings.auto_copy_to_clipboard && copy_to_clipboard(&frame).is_ok();
    let (png, thumb) = encode(&frame)?;
    let (hour, minute) = local_hm();
    let name = naming::capture_name(title.as_deref(), &settings.language, hour, minute);

    let state = app.state::<AppState>();
    let wanted = state.active_group.lock().unwrap().clone();
    let (capture, group_id, group_name, session_id, session) = {
        let mut store = state.sessions.lock().unwrap();
        // The group the user is looking at; the first one when it is gone.
        let group = store
            .session()
            .groups
            .iter()
            .find(|g| Some(&g.id) == wanted.as_ref() && !g.is_recording())
            .or_else(|| store.session().groups.iter().find(|g| !g.is_recording()))
            .map(|g| (g.id.clone(), g.name.clone()))
            .ok_or("the session has no group")?;
        // The files are on disk before the session file mentions them (see SessionStore::add_capture).
        let capture = store
            .add_capture(
                &group.0,
                Some(name),
                &png,
                Some(&thumb),
                frame.width,
                frame.height,
                title,
            )
            .map_err(|e| crate::error::CmdError::from(e).message)?;
        (
            capture,
            group.0,
            group.1,
            store.session().id.clone(),
            store.session().clone(),
        )
    };

    // Automatic saving: the original goes to <folder><group> as a file (Snipmunk never deletes it again).
    let session = if settings.auto_save_screenshots {
        match auto_save(&settings, &group_name, &capture, &png) {
            Some(path) => {
                let mut store = state.sessions.lock().unwrap();
                let _ = store.set_saved_path(&capture.id, &path);
                store.session().clone()
            }
            None => session,
        }
    } else {
        session
    };
    let _ = app.emit("session-changed", &session);
    // The text of the new capture is read in the background (low priority, one at a time).
    crate::ocr::queue(app, &capture.id);
    let _ = app.emit(
        "capture-added",
        CaptureAdded {
            capture_id: &capture.id,
            group_id: &group_id,
        },
    );

    if settings.after_capture == "background" {
        popups::show_toast(
            app,
            ToastInfo {
                session_id,
                file: capture.thumbnail.clone().unwrap_or(capture.file.clone()),
                group_name,
                copied,
                width: capture.width,
                height: capture.height,
            },
        );
    } else {
        crate::tray::show_main(app);
    }
    Ok(())
}

/// Write a screenshot into the folder of the setting, in a subfolder named like its group. Never replaces a file.
fn auto_save(
    settings: &crate::settings::Settings,
    group_name: &str,
    capture: &crate::sessions::Capture,
    png: &[u8],
) -> Option<std::path::PathBuf> {
    let root = crate::recstore::resolve(
        &settings.auto_save_dir,
        crate::recstore::default_pictures_dir,
    );
    let dir = root.join(crate::recstore::safe_name(group_name));
    std::fs::create_dir_all(&dir).ok()?;
    // The number of the screenshot in its group is the number of files already there plus one.
    let number = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) + 1;
    let stem = crate::recstore::screenshot_file_stem(
        &settings.save_naming,
        &capture.name,
        group_name,
        number,
        naming::screenshot_word(&settings.language),
        &crate::recstore::local_stamp(),
    );
    let path = crate::export::free_path(&dir, &format!("{stem}.png"));
    std::fs::write(&path, png).ok()?;
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thumbs::THUMB_MAX;

    fn frame(w: u32, h: u32) -> Frame {
        Frame {
            width: w,
            height: h,
            rgba: (0..w * h * 4).map(|i| (i % 251) as u8).collect(),
        }
    }

    #[test]
    fn a_capture_becomes_a_png_and_a_smaller_png_thumbnail() {
        let (png, thumb) = encode(&frame(1280, 720)).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        assert_eq!(&thumb[1..4], b"PNG");
        let full = image::load_from_memory(&png).unwrap();
        assert_eq!((full.width(), full.height()), (1280, 720));
        let small = image::load_from_memory(&thumb).unwrap();
        assert!(small.width() <= THUMB_MAX.0 && small.height() <= THUMB_MAX.1);
        assert_eq!(small.width(), 520, "the aspect ratio is kept");
        assert_eq!(small.height(), 293);
    }

    #[test]
    fn transparency_survives_the_png() {
        let mut f = frame(4, 4);
        f.rgba[3] = 0;
        let (png, _) = encode(&f).unwrap();
        let back = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(back.get_pixel(0, 0)[3], 0);
        assert_eq!(back.get_pixel(1, 0)[3], f.rgba[7]);
    }

    #[test]
    fn a_wrong_size_is_an_error_not_a_panic() {
        let bad = Frame {
            width: 10,
            height: 10,
            rgba: vec![0; 12],
        };
        assert!(encode(&bad).is_err());
    }

    #[test]
    fn an_automatic_save_goes_to_a_folder_per_group_and_never_replaces_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let settings = crate::settings::Settings {
            auto_save_dir: dir.path().to_string_lossy().into_owned(),
            save_naming: "capture".into(),
            ..Default::default()
        };
        let capture = crate::sessions::Capture {
            name: "My: shot".into(),
            ..Default::default()
        };
        let a = auto_save(&settings, "Group 1", &capture, b"one").unwrap();
        let b = auto_save(&settings, "Group 1", &capture, b"two").unwrap();
        assert_eq!(a, dir.path().join("Group 1").join("My_ shot.png"));
        assert_eq!(b, dir.path().join("Group 1").join("My_ shot (2).png"));
        assert_eq!(std::fs::read(&a).unwrap(), b"one");
    }
}
