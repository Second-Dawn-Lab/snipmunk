//! Writing an animated GIF: the `gif` crate writes the file (MIT or Apache-2.0) and `color_quant`'s NeuQuant makes the 255-colour
//! palette of each picture (MIT). Only the part of a picture that changed is stored (the rest is a transparent index), which keeps
//! the file of a screen recording small: most of a screen stays the same from one picture to the next.

use std::collections::HashMap;
use std::io::{self, Write};

use color_quant::NeuQuant;

/// The index that means "unchanged" (transparent) in the palette of every picture.
const TRANSPARENT: u8 = 255;
/// A pixel that differs from what is shown by at most this much per channel counts as unchanged.
const TOLERANCE: i32 = 4;

pub struct GifWriter<W: Write> {
    enc: gif::Encoder<W>,
    w: usize,
    h: usize,
    /// The source pixels (RGB) that were last stored: a pixel is stored again only when the picture differs from this by more
    /// than the tolerance (comparing with the quantized colours would store the whole gradient again and again).
    shown: Vec<[u8; 3]>,
    first: bool,
    /// The delay of a picture in hundredths of a second.
    delay: u16,
    /// Bytes of picture data written (for the size estimate).
    pub frames: u32,
}

fn io_err(e: gif::EncodingError) -> io::Error {
    io::Error::other(e.to_string())
}

impl<W: Write> GifWriter<W> {
    pub fn new(out: W, w: u32, h: u32, fps: u32) -> io::Result<Self> {
        let mut enc = gif::Encoder::new(out, w as u16, h as u16, &[]).map_err(io_err)?;
        enc.set_repeat(gif::Repeat::Infinite).map_err(io_err)?;
        Ok(Self {
            enc,
            w: w as usize,
            h: h as usize,
            shown: vec![[0; 3]; w as usize * h as usize],
            first: true,
            delay: (100.0 / fps.max(1) as f32).round().max(2.0) as u16,
            frames: 0,
        })
    }

    /// Add a picture (BGRA, top row first, the size of the GIF).
    pub fn push(&mut self, bgra: &[u8]) -> io::Result<()> {
        let (w, h) = (self.w, self.h);
        if bgra.len() < w * h * 4 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the picture is too small",
            ));
        }
        // Which pixels changed, and the box around them.
        let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
        let mut changed = vec![false; w * h];
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                let p = &bgra[i * 4..i * 4 + 3];
                let s = self.shown[i]; // RGB of the source that was stored last
                let differs = self.first
                    || (p[2] as i32 - s[0] as i32).abs() > TOLERANCE
                    || (p[1] as i32 - s[1] as i32).abs() > TOLERANCE
                    || (p[0] as i32 - s[2] as i32).abs() > TOLERANCE;
                if differs {
                    changed[i] = true;
                    x0 = x0.min(x);
                    x1 = x1.max(x);
                    y0 = y0.min(y);
                    y1 = y1.max(y);
                }
            }
        }
        self.first = false;
        self.frames += 1;
        if x1 < x0 {
            // Nothing changed: a tiny transparent picture that only keeps the time going.
            let frame = gif::Frame {
                width: 1,
                height: 1,
                delay: self.delay,
                dispose: gif::DisposalMethod::Keep,
                transparent: Some(TRANSPARENT),
                palette: Some(vec![0; 256 * 3]),
                buffer: std::borrow::Cow::Owned(vec![TRANSPARENT]),
                ..gif::Frame::default()
            };
            return self.enc.write_frame(&frame).map_err(io_err);
        }
        let (bw, bh) = (x1 - x0 + 1, y1 - y0 + 1);
        // The palette is made from the changed pixels only.
        let mut train = Vec::new();
        for y in y0..=y1 {
            for x in x0..=x1 {
                if changed[y * w + x] {
                    let p = &bgra[(y * w + x) * 4..];
                    train.extend_from_slice(&[p[2], p[1], p[0], 255]);
                }
            }
        }
        let quant = NeuQuant::new(10, 255, &train);
        let mut palette = quant.color_map_rgb();
        palette.resize(256 * 3, 0);
        let mut cache: HashMap<u32, u8> = HashMap::new();
        let mut indices = vec![TRANSPARENT; bw * bh];
        for y in y0..=y1 {
            for x in x0..=x1 {
                let i = y * w + x;
                if !changed[i] {
                    continue;
                }
                let p = &bgra[i * 4..];
                let key = (p[2] as u32 >> 3) << 10 | (p[1] as u32 >> 3) << 5 | (p[0] as u32 >> 3);
                let idx = *cache
                    .entry(key)
                    .or_insert_with(|| quant.index_of(&[p[2], p[1], p[0], 255]) as u8);
                indices[(y - y0) * bw + (x - x0)] = idx;
                self.shown[i] = [p[2], p[1], p[0]];
            }
        }
        let frame = gif::Frame {
            width: bw as u16,
            height: bh as u16,
            left: x0 as u16,
            top: y0 as u16,
            delay: self.delay,
            dispose: gif::DisposalMethod::Keep,
            transparent: Some(TRANSPARENT),
            palette: Some(palette),
            buffer: std::borrow::Cow::Owned(indices),
            ..gif::Frame::default()
        };
        self.enc.write_frame(&frame).map_err(io_err)
    }

    pub fn finish(self) -> io::Result<W> {
        self.enc.into_inner().map_err(io_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(w: usize, h: usize, shift: usize) -> Vec<u8> {
        let mut v = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                // A gradient background, and a red box that moves.
                v[i] = (x * 255 / w) as u8;
                v[i + 1] = (y * 255 / h) as u8;
                v[i + 2] = 80;
                if (shift..shift + 10).contains(&x) && (20..30).contains(&y) {
                    v[i..i + 3].copy_from_slice(&[0, 0, 255]);
                }
            }
        }
        v
    }

    #[test]
    fn a_gif_is_written_that_reads_back_with_the_pictures_and_only_stores_what_changed() {
        let (w, h) = (80usize, 50usize);
        let mut out = Vec::new();
        {
            let mut g = GifWriter::new(&mut out, w as u32, h as u32, 10).unwrap();
            for k in 0..6 {
                g.push(&picture(w, h, k * 8)).unwrap();
            }
            g.push(&picture(w, h, 40)).unwrap(); // no change at all
            assert_eq!(g.frames, 7);
            g.finish().unwrap();
        }
        assert_eq!(&out[..6], b"GIF89a");
        // Read back with the decoder of the image crate: all pictures there, 80 x 50.
        let mut opts = gif::DecodeOptions::new();
        opts.set_color_output(gif::ColorOutput::RGBA);
        let mut dec = opts.read_info(&out[..]).unwrap();
        assert_eq!((dec.width(), dec.height()), (80, 50));
        let mut frames = Vec::new();
        while let Some(f) = dec.read_next_frame().unwrap() {
            frames.push((f.width, f.height, f.delay, f.transparent));
        }
        assert_eq!(frames.len(), 7);
        assert_eq!(
            (frames[0].0, frames[0].1),
            (80, 50),
            "the first picture is whole"
        );
        assert!(
            frames[1].0 < 40 && frames[1].1 <= 10 + 1,
            "{:?}: only the moved box is stored",
            frames[1]
        );
        assert_eq!(frames[0].2, 10, "10 pictures a second = 10 hundredths");
        assert_eq!(
            (frames[6].0, frames[6].1),
            (1, 1),
            "an unchanged picture is a dot"
        );
        // A moving box makes a file much smaller than 7 whole pictures would be.
        assert!(out.len() < 7 * w * h / 2, "{} bytes", out.len());
    }
}
