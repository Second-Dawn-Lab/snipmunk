//! Thumbnails of captures: made when a capture is added, and upgraded in the background for sessions that were saved
//! with the small ones of earlier versions.

use std::io::Cursor;
use std::time::Duration;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ImageEncoder, RgbaImage};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;

/// The size a thumbnail fits into. The largest gallery view shows them at 260 CSS pixels, so this is sharp at 200 %
/// scaling. (Earlier versions used 192 pixels: those are upgraded lazily, see `spawn_upgrade`.)
pub const THUMB_MAX: (u32, u32) = (520, 340);

/// PNG bytes of an image. `Fast` for the full-size file (a 4K screenshot must not take seconds), `Default` for thumbnails.
pub fn png_bytes(img: &RgbaImage, quality: CompressionType) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    PngEncoder::new_with_quality(&mut out, quality, FilterType::Sub)
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// A thumbnail PNG that fits `THUMB_MAX`; a smaller image is kept as it is (never enlarged).
pub fn thumbnail_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    if image.width() <= THUMB_MAX.0 && image.height() <= THUMB_MAX.1 {
        return png_bytes(image, CompressionType::Default);
    }
    let small = DynamicImage::ImageRgba8(image.clone())
        .thumbnail(THUMB_MAX.0, THUMB_MAX.1)
        .to_rgba8();
    png_bytes(&small, CompressionType::Default)
}

/// How many thumbnails are written before the session file is updated (and the windows told) once.
const BATCH: usize = 12;

/// Upgrade the thumbnails of the current session that are smaller than `THUMB_MAX`, newest first, on a background
/// thread. The store is locked only to read the list and to record each batch, never while images are decoded.
pub fn spawn_upgrade(app: AppHandle) {
    std::thread::spawn(move || {
        // Let the window open and the first pictures load before this starts to compete for the disk.
        std::thread::sleep(Duration::from_millis(1500));
        let state = app.state::<AppState>();
        let (session_id, dir, mut todo) = {
            let store = state.sessions.lock().unwrap();
            (
                store.session().id.clone(),
                store.session_dir(),
                store.captures_needing_thumbnail_upgrade(THUMB_MAX.0),
            )
        };
        // The newest captures are the ones on screen first.
        todo.reverse();
        for chunk in todo.chunks(BATCH) {
            let mut done = Vec::new();
            for (id, file) in chunk {
                let Ok(bytes) = std::fs::read(dir.join(file)) else {
                    continue;
                };
                let Ok(img) = image::load_from_memory(&bytes) else {
                    continue;
                };
                let Ok(thumb) = thumbnail_png(&img.to_rgba8()) else {
                    continue;
                };
                let rel = format!("thumbs/{id}.png");
                let path = dir.join(&rel);
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if std::fs::write(&path, thumb).is_ok() {
                    done.push((id.clone(), rel));
                }
            }
            let session = {
                let mut store = state.sessions.lock().unwrap();
                if store.session().id != session_id {
                    return; // a new session was started meanwhile
                }
                match store.record_thumbnails(&done, THUMB_MAX.0) {
                    Ok(()) => store.session().clone(),
                    Err(e) => {
                        eprintln!("could not record upgraded thumbnails: {e:?}");
                        return;
                    }
                }
            };
            let _ = app.emit("session-changed", &session);
            std::thread::sleep(Duration::from_millis(30));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x % 251) as u8, (y % 241) as u8, 90, 255])
        })
    }

    #[test]
    fn a_large_picture_is_scaled_down_with_its_aspect_ratio() {
        let png = thumbnail_png(&picture(1920, 1080)).unwrap();
        let t = image::load_from_memory(&png).unwrap();
        assert_eq!((t.width(), t.height()), (520, 293));
    }

    #[test]
    fn a_small_picture_is_never_enlarged() {
        let png = thumbnail_png(&picture(100, 60)).unwrap();
        let t = image::load_from_memory(&png).unwrap();
        assert_eq!((t.width(), t.height()), (100, 60));
    }

    #[test]
    fn a_tall_picture_is_limited_by_its_height() {
        let png = thumbnail_png(&picture(400, 2000)).unwrap();
        let t = image::load_from_memory(&png).unwrap();
        assert_eq!(t.height(), 340);
        assert!(t.width() <= 520);
    }
}
