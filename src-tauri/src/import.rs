//! Images dropped into the capture list: decoded, checked and turned into the same PNG + thumbnail pair a screenshot has.
//! The original file is never touched; only its bytes are read.

use image::codecs::png::CompressionType;

use crate::thumbs::{png_bytes, thumbnail_png};

/// A dropped file larger than this is skipped (it would take seconds and a lot of memory to decode).
pub const MAX_BYTES: usize = 120 * 1024 * 1024;

/// A decoded image, ready to be stored.
pub struct Prepared {
    pub png: Vec<u8>,
    pub thumb: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Decode PNG, JPEG, WebP, BMP or GIF (its first frame) from bytes. What the file is called does not matter: the
/// content decides. Anything else, or a damaged file, is an error.
pub fn prepare(bytes: &[u8]) -> Result<Prepared, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("the file is empty or too large".into());
    }
    let format = image::guess_format(bytes).map_err(|_| "this is not a supported image")?;
    use image::ImageFormat::{Bmp, Gif, Jpeg, Png, WebP};
    if !matches!(format, Png | Jpeg | WebP | Bmp | Gif) {
        return Err("this image type is not supported".into());
    }
    let rgba = image::load_from_memory_with_format(bytes, format)
        .map_err(|e| format!("the image could not be read: {e}"))?
        .to_rgba8();
    Ok(Prepared {
        width: rgba.width(),
        height: rgba.height(),
        png: png_bytes(&rgba, CompressionType::Fast)?,
        thumb: thumbnail_png(&rgba)?,
    })
}

/// The name of a capture made from a dropped file: the file name without its extension (what is left of a
/// folder-less name; an empty result falls back to `fallback`).
pub fn name_from_file(file_name: &str, fallback: &str) -> String {
    let base = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .trim();
    let stem = match base.rfind('.') {
        Some(i) if i > 0 => &base[..i],
        _ => base,
    };
    let stem = stem.trim();
    if stem.is_empty() {
        fallback.to_string()
    } else {
        stem.chars().take(80).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, RgbaImage};
    use std::io::Cursor;

    fn encoded(format: ImageFormat, w: u32, h: u32) -> Vec<u8> {
        let img = RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x * 3 % 256) as u8, (y * 5 % 256) as u8, 120, 255])
        });
        let img = if matches!(format, ImageFormat::Jpeg) {
            DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(img).to_rgb8())
        } else {
            DynamicImage::ImageRgba8(img)
        };
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    #[test]
    fn every_supported_format_becomes_a_png_with_a_thumbnail() {
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::WebP,
            ImageFormat::Bmp,
            ImageFormat::Gif,
        ] {
            let p =
                prepare(&encoded(format, 1200, 800)).unwrap_or_else(|e| panic!("{format:?}: {e}"));
            assert_eq!((p.width, p.height), (1200, 800), "{format:?}");
            assert_eq!(&p.png[1..4], b"PNG");
            let thumb = image::load_from_memory(&p.thumb).unwrap();
            assert_eq!((thumb.width(), thumb.height()), (510, 340), "{format:?}");
        }
    }

    #[test]
    fn the_content_decides_not_the_name() {
        // A JPEG is a JPEG whatever it is called; text is not an image whatever it is called.
        assert!(prepare(&encoded(ImageFormat::Jpeg, 20, 20)).is_ok());
        assert!(prepare(b"just some text, not a picture").is_err());
        assert!(prepare(b"").is_err());
    }

    #[test]
    fn damaged_files_are_an_error_not_a_panic() {
        let mut png = encoded(ImageFormat::Png, 64, 64);
        png.truncate(png.len() / 2);
        assert!(prepare(&png).is_err());
        assert!(prepare(&[0x89, b'P', b'N', b'G']).is_err());
    }

    #[test]
    fn a_format_we_do_not_support_is_refused() {
        // The first bytes of a TIFF file: recognised as an image, but not one we accept.
        assert!(prepare(&[b'I', b'I', b'*', 0, 8, 0, 0, 0, 0, 0, 0, 0]).is_err());
    }

    #[test]
    fn transparency_is_kept() {
        let mut img = RgbaImage::new(4, 4);
        img.put_pixel(1, 1, image::Rgba([10, 20, 30, 0]));
        let mut out = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut out, ImageFormat::Png)
            .unwrap();
        let p = prepare(&out.into_inner()).unwrap();
        let back = image::load_from_memory(&p.png).unwrap().to_rgba8();
        assert_eq!(back.get_pixel(1, 1)[3], 0);
    }

    #[test]
    fn names_are_the_file_name_without_the_extension() {
        assert_eq!(name_from_file("holiday.jpg", "Image"), "holiday");
        assert_eq!(name_from_file("a.b.c.png", "Image"), "a.b.c");
        assert_eq!(name_from_file("C:\\pics\\cat.webp", "Image"), "cat");
        assert_eq!(name_from_file("noextension", "Image"), "noextension");
        assert_eq!(name_from_file(".hidden", "Image"), ".hidden");
        assert_eq!(name_from_file("  .png", "Image"), ".png");
        assert_eq!(name_from_file("", "Image"), "Image");
        assert_eq!(
            name_from_file(&format!("{}.png", "x".repeat(200)), "Image").len(),
            80
        );
    }
}
