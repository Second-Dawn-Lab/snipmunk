//! Pixel loops that run on large pictures. They live in their own crate because a development build leaves Snipmunk itself
//! unoptimized: a generic function of the `image` crate is compiled where it is used, so enlarging a screenshot for text
//! recognition took seconds there. This crate is always optimized (see the workspace `Cargo.toml`).

use image::{imageops, ImageBuffer, Rgba};

mod writing;
pub use writing::{ink_after, unread_writing};

/// Enlarge an RGBA picture by a whole factor (Catmull-Rom). `None` when the buffer does not have the size it says.
pub fn upscale_rgba(rgba: &[u8], width: u32, height: u32, factor: u32) -> Option<Vec<u8>> {
    let (w, h) = (width.checked_mul(factor)?, height.checked_mul(factor)?);
    let img: ImageBuffer<Rgba<u8>, &[u8]> = ImageBuffer::from_raw(width, height, rgba)?;
    Some(imageops::resize(&img, w, h, imageops::FilterType::CatmullRom).into_raw())
}

/// The part of an RGBA picture inside the rectangle (which must lie inside the picture).
pub fn crop_rgba(rgba: &[u8], width: u32, x: u32, y: u32, w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(w as usize * h as usize * 4);
    for row in y..y + h {
        let at = (row as usize * width as usize + x as usize) * 4;
        out.extend_from_slice(&rgba[at..at + w as usize * 4]);
    }
    out
}

/// The same picture with the red and blue channels exchanged (RGBA to BGRA).
pub fn swap_red_blue(rgba: &[u8]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for px in out.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_is_cut_and_enlarged() {
        // 3 x 2 pixels, each with its own red value.
        let rgba: Vec<u8> = (0..6u8).flat_map(|i| [i * 10, 0, 0, 255]).collect();
        assert_eq!(
            crop_rgba(&rgba, 3, 1, 1, 2, 1),
            [40, 0, 0, 255, 50, 0, 0, 255]
        );
        let big = upscale_rgba(&rgba, 3, 2, 2).unwrap();
        assert_eq!(big.len(), 6 * 4 * 4);
        assert!(upscale_rgba(&rgba, 4, 4, 2).is_none());
        assert_eq!(swap_red_blue(&[1, 2, 3, 4]), [3, 2, 1, 4]);
    }
}
