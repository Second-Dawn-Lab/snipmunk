//! Drawing for the export of a recording: the cursor halo, the click effects, the webcam overlay, and the scaling of a picture to
//! the size, aspect ratio and resolution that were chosen. All of it works on BGRA pictures (top row first) in memory, so the tests
//! can look at single pixels. The same shapes are drawn by the player (`src/recording/drawFx.ts`) with the same numbers.

#![allow(clippy::chunks_exact_to_as_chunks)]

use serde::{Deserialize, Serialize};

/// "#RRGGBB" as red, green, blue (a bad value gives white).
pub fn parse_hex(s: &str) -> [u8; 3] {
    let v = |i: usize| u8::from_str_radix(s.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
    if s.len() == 7 && s.starts_with('#') {
        [v(1), v(3), v(5)]
    } else {
        [255, 255, 255]
    }
}

/// Put `rgb` over the pixel (x, y) with the opacity `alpha` (0..1); outside the picture nothing happens.
#[inline]
pub fn blend_px(buf: &mut [u8], w: usize, h: usize, x: i32, y: i32, rgb: [u8; 3], alpha: f32) {
    if x < 0 || y < 0 || x as usize >= w || y as usize >= h || alpha <= 0.0 {
        return;
    }
    let a = alpha.min(1.0);
    let at = (y as usize * w + x as usize) * 4;
    let d = &mut buf[at..at + 4];
    d[0] = (rgb[2] as f32 * a + d[0] as f32 * (1.0 - a)) as u8;
    d[1] = (rgb[1] as f32 * a + d[1] as f32 * (1.0 - a)) as u8;
    d[2] = (rgb[0] as f32 * a + d[2] as f32 * (1.0 - a)) as u8;
    d[3] = 255;
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A soft circle around the cursor: opaque-ish in the middle, fading out towards the edge.
pub fn draw_halo(buf: &mut [u8], w: usize, h: usize, cx: f32, cy: f32, radius: f32, rgb: [u8; 3]) {
    let (x0, x1) = ((cx - radius).floor() as i32, (cx + radius).ceil() as i32);
    let (y0, y1) = ((cy - radius).floor() as i32, (cy + radius).ceil() as i32);
    for y in y0.max(0)..=y1.min(h as i32 - 1) {
        for x in x0.max(0)..=x1.min(w as i32 - 1) {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let a = 0.42 * (1.0 - smoothstep(radius * 0.5, radius, d));
            blend_px(buf, w, h, x, y, rgb, a);
        }
    }
}

/// The click effect "ripple" at time `t` (0 = the click, 1 = gone): a ring that grows, with a soft fill, fading out.
#[allow(clippy::too_many_arguments)]
pub fn draw_ripple(
    buf: &mut [u8],
    w: usize,
    h: usize,
    cx: f32,
    cy: f32,
    max: f32,
    t: f32,
    rgb: [u8; 3],
) {
    let ease = 1.0 - (1.0 - t).powi(3);
    let r = max * (0.25 + 0.75 * ease);
    let fade = (1.0 - t).clamp(0.0, 1.0);
    let thick = (max * 0.14).max(2.0);
    let (x0, x1) = (
        (cx - r - thick).floor() as i32,
        (cx + r + thick).ceil() as i32,
    );
    let (y0, y1) = (
        (cy - r - thick).floor() as i32,
        (cy + r + thick).ceil() as i32,
    );
    for y in y0.max(0)..=y1.min(h as i32 - 1) {
        for x in x0.max(0)..=x1.min(w as i32 - 1) {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let ring = 1.0 - smoothstep(thick * 0.5, thick, (d - r).abs());
            let fill = if d < r { 0.22 } else { 0.0 };
            blend_px(buf, w, h, x, y, rgb, (ring * 0.9 + fill) * fade);
        }
    }
}

/// The click effect "burst" at time `t`: short lines around the click point that move outwards and fade.
#[allow(clippy::too_many_arguments)]
pub fn draw_burst(
    buf: &mut [u8],
    w: usize,
    h: usize,
    cx: f32,
    cy: f32,
    max: f32,
    t: f32,
    rgb: [u8; 3],
) {
    let ease = 1.0 - (1.0 - t).powi(2);
    let fade = (1.0 - t).clamp(0.0, 1.0);
    let thick = (max * 0.08).max(2.0);
    for k in 0..8 {
        let ang = k as f32 * std::f32::consts::TAU / 8.0;
        let (dx, dy) = (ang.cos(), ang.sin());
        let r0 = max * (0.35 + 0.65 * ease);
        let len = max * 0.38 * (1.0 - 0.5 * t);
        let steps = (len * 2.0).ceil() as i32;
        for s in 0..=steps {
            let d = r0 + len * s as f32 / steps.max(1) as f32;
            let (px, py) = (cx + dx * d, cy + dy * d);
            let rad = thick / 2.0;
            for oy in -(rad.ceil() as i32)..=(rad.ceil() as i32) {
                for ox in -(rad.ceil() as i32)..=(rad.ceil() as i32) {
                    let dist = ((ox * ox + oy * oy) as f32).sqrt();
                    if dist <= rad {
                        blend_px(buf, w, h, px as i32 + ox, py as i32 + oy, rgb, 0.95 * fade);
                    }
                }
            }
        }
    }
}

/// An RGBA picture (the cursor) drawn at `scale` times its size with its top left corner at (x, y), smoothly resampled.
pub fn blend_scaled(
    buf: &mut [u8],
    w: usize,
    h: usize,
    img: &image::RgbaImage,
    x: f32,
    y: f32,
    scale: f32,
) {
    if scale <= 0.0 {
        return;
    }
    let (iw, ih) = (img.width() as f32, img.height() as f32);
    let (dw, dh) = ((iw * scale).ceil() as i32, (ih * scale).ceil() as i32);
    for oy in 0..dh {
        for ox in 0..dw {
            // The source position of the middle of this pixel, bilinear between the four nearest source pixels.
            let sx = ((ox as f32 + 0.5) / scale - 0.5).clamp(0.0, iw - 1.0);
            let sy = ((oy as f32 + 0.5) / scale - 0.5).clamp(0.0, ih - 1.0);
            let (x0, y0) = (sx.floor() as u32, sy.floor() as u32);
            let (x1, y1) = (
                (x0 + 1).min(img.width() - 1),
                (y0 + 1).min(img.height() - 1),
            );
            let (fx, fy) = (sx - x0 as f32, sy - y0 as f32);
            let mut acc = [0.0f32; 4];
            for (px, py, wgt) in [
                (x0, y0, (1.0 - fx) * (1.0 - fy)),
                (x1, y0, fx * (1.0 - fy)),
                (x0, y1, (1.0 - fx) * fy),
                (x1, y1, fx * fy),
            ] {
                let p = img.get_pixel(px, py).0;
                let a = p[3] as f32 / 255.0 * wgt;
                acc[0] += p[0] as f32 * a;
                acc[1] += p[1] as f32 * a;
                acc[2] += p[2] as f32 * a;
                acc[3] += a;
            }
            if acc[3] > 0.003 {
                let rgb = [
                    (acc[0] / acc[3]).round() as u8,
                    (acc[1] / acc[3]).round() as u8,
                    (acc[2] / acc[3]).round() as u8,
                ];
                blend_px(
                    buf,
                    w,
                    h,
                    x.round() as i32 + ox,
                    y.round() as i32 + oy,
                    rgb,
                    acc[3],
                );
            }
        }
    }
}

/// How the webcam picture is cut out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    Circle,
    Rounded,
    Rect,
}

/// How many pixels the point (px, py) is inside the edge of the shape in a `w` x `h` rectangle (negative outside).
fn shape_depth(shape: Shape, px: f32, py: f32, w: f32, h: f32) -> f32 {
    match shape {
        Shape::Rect => px.min(w - px).min(py).min(h - py),
        Shape::Circle => w.min(h) / 2.0 - ((px - w / 2.0).powi(2) + (py - h / 2.0).powi(2)).sqrt(),
        Shape::Rounded => {
            let r = w.min(h) * 0.22;
            let qx = ((px - w / 2.0).abs() - (w / 2.0 - r)).max(0.0);
            let qy = ((py - h / 2.0).abs() - (h / 2.0 - r)).max(0.0);
            (r - (qx * qx + qy * qy).sqrt()).min(px.min(w - px).min(py).min(h - py))
        }
    }
}

/// The opacity at that point: 1 inside, 0 outside, a one pixel soft edge.
fn shape_coverage(shape: Shape, px: f32, py: f32, w: f32, h: f32) -> f32 {
    (shape_depth(shape, px, py, w, h) + 0.5).clamp(0.0, 1.0)
}

/// Lay the webcam picture `cam` (BGRA, top row first, `cw` x `ch`) over `buf` in the rectangle (rx, ry, rw, rh), cut to `shape`
/// (the picture is scaled to cover the rectangle and cut in the middle), with an optional thin white border.
#[allow(clippy::too_many_arguments)]
pub fn draw_webcam(
    buf: &mut [u8],
    w: usize,
    h: usize,
    cam: &[u8],
    cw: usize,
    ch: usize,
    rect: (i32, i32, i32, i32),
    shape: Shape,
    border: bool,
) {
    let (rx, ry, rw, rh) = rect;
    if rw <= 0 || rh <= 0 || cw == 0 || ch == 0 || cam.len() < cw * ch * 4 {
        return;
    }
    // Cover: the part of the camera picture that has the rectangle's shape.
    let scale = (rw as f32 / cw as f32).max(rh as f32 / ch as f32);
    let (vw, vh) = (rw as f32 / scale, rh as f32 / scale);
    let (vx, vy) = ((cw as f32 - vw) / 2.0, (ch as f32 - vh) / 2.0);
    let bw = if border {
        (rw.min(rh) as f32 * 0.02).clamp(2.0, 6.0)
    } else {
        0.0
    };
    for oy in 0..rh {
        for ox in 0..rw {
            let (fx, fy) = (ox as f32 + 0.5, oy as f32 + 0.5);
            let cover = shape_coverage(shape, fx, fy, rw as f32, rh as f32);
            if cover <= 0.0 {
                continue;
            }
            let sx = ((vx + fx / scale) as usize).min(cw - 1);
            let sy = ((vy + fy / scale) as usize).min(ch - 1);
            let s = &cam[(sy * cw + sx) * 4..(sy * cw + sx) * 4 + 3];
            blend_px(buf, w, h, rx + ox, ry + oy, [s[2], s[1], s[0]], cover);
            if bw > 0.0 {
                // The border lies on the inside of the edge.
                let inner = shape_depth(shape, fx, fy, rw as f32, rh as f32);
                if inner < bw {
                    blend_px(buf, w, h, rx + ox, ry + oy, [255, 255, 255], cover * 0.95);
                }
            }
        }
    }
}

// ---- the size of the exported picture --------------------------------------------------------------------------------------

/// The aspect ratio of the exported video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Aspect {
    #[serde(rename = "original")]
    Original,
    #[serde(rename = "16:9")]
    Wide,
    #[serde(rename = "9:16")]
    Tall,
    #[serde(rename = "1:1")]
    Square,
}

/// What to do when the picture does not have the aspect ratio: bars, or cut the edges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Bars,
    Crop,
}

/// Where the source picture goes in the output picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    /// The size of the output picture (even).
    pub w: u32,
    pub h: u32,
    /// The part of the source that is shown (x, y, width, height).
    pub src: (u32, u32, u32, u32),
    /// The rectangle of the output it is scaled into (x, y, width, height); the rest is black.
    pub dst: (u32, u32, u32, u32),
}

fn even(v: f64) -> u32 {
    ((v.round() as u32).max(2)) & !1
}

/// Work out the output for a source of `sw` x `sh`. `short_side` limits the shorter side of the output (None = original size);
/// nothing is ever scaled up.
pub fn plan_output(sw: u32, sh: u32, aspect: Aspect, fit: Fit, short_side: Option<u32>) -> Plan {
    let target = match aspect {
        Aspect::Original => sw as f64 / sh as f64,
        Aspect::Wide => 16.0 / 9.0,
        Aspect::Tall => 9.0 / 16.0,
        Aspect::Square => 1.0,
    };
    let src_aspect = sw as f64 / sh as f64;
    // The canvas at the source's own scale.
    let (mut cw, mut ch, src) = if aspect == Aspect::Original || (target - src_aspect).abs() < 0.002
    {
        (sw as f64, sh as f64, (0, 0, sw, sh))
    } else if fit == Fit::Bars {
        if target > src_aspect {
            (sh as f64 * target, sh as f64, (0, 0, sw, sh))
        } else {
            (sw as f64, sw as f64 / target, (0, 0, sw, sh))
        }
    } else if target > src_aspect {
        // Wider than the source: cut the top and bottom.
        let ch2 = sw as f64 / target;
        let y = ((sh as f64 - ch2) / 2.0).round() as u32;
        (sw as f64, ch2, (0, y, sw, ch2.round() as u32))
    } else {
        let cw2 = sh as f64 * target;
        let x = ((sw as f64 - cw2) / 2.0).round() as u32;
        (cw2, sh as f64, (x, 0, cw2.round() as u32, sh))
    };
    // The resolution: never larger than the source scale.
    let mut k = 1.0;
    if let Some(short) = short_side {
        let s = cw.min(ch);
        if s > short as f64 {
            k = short as f64 / s;
        }
    }
    cw *= k;
    ch *= k;
    let (w, h) = (even(cw), even(ch));
    // Where the source part goes: all of the canvas, or centred with bars.
    let dst =
        if fit == Fit::Bars && aspect != Aspect::Original && (target - src_aspect).abs() >= 0.002 {
            let scale = (w as f64 / sw as f64).min(h as f64 / sh as f64);
            let (dw, dh) = (
                even(sw as f64 * scale).min(w),
                even(sh as f64 * scale).min(h),
            );
            (((w - dw) / 2) & !1, ((h - dh) / 2) & !1, dw, dh)
        } else {
            (0, 0, w, h)
        };
    Plan { w, h, src, dst }
}

/// Scale the part `src` (x, y, w, h) of a BGRA picture `sw` x `sh` into the rectangle `dst` of the output `ow` x `oh` (the rest
/// of the output stays as it is: black bars are the caller's `vec![0; ..]` with alpha 255). Averages the covered source pixels
/// when making the picture smaller, interpolates when making it larger. Rows are done on several threads.
#[allow(
    clippy::too_many_arguments,
    clippy::needless_range_loop,
    clippy::chunks_exact_to_as_chunks
)]
pub fn scale_into(
    source: &[u8],
    sw: usize,
    src: (u32, u32, u32, u32),
    out: &mut [u8],
    ow: usize,
    dst: (u32, u32, u32, u32),
) {
    let (sx, sy, sww, shh) = (
        src.0 as usize,
        src.1 as usize,
        src.2 as usize,
        src.3 as usize,
    );
    let (dx, dy, dw, dh) = (
        dst.0 as usize,
        dst.1 as usize,
        dst.2 as usize,
        dst.3 as usize,
    );
    if dw == 0 || dh == 0 || sww == 0 || shh == 0 {
        return;
    }
    if (sww, shh) == (dw, dh) {
        for y in 0..dh {
            let from = ((sy + y) * sw + sx) * 4;
            let to = ((dy + y) * ow + dx) * 4;
            out[to..to + dw * 4].copy_from_slice(&source[from..from + dw * 4]);
        }
        return;
    }
    let (kx, ky) = (sww as f32 / dw as f32, shh as f32 / dh as f32);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 8);
    let band = dh.div_ceil(threads).max(1);
    let rows = &mut out[dy * ow * 4..(dy + dh) * ow * 4];
    std::thread::scope(|scope| {
        for (bi, chunk) in rows.chunks_mut(band * ow * 4).enumerate() {
            scope.spawn(move || {
                for (ry, row) in chunk.chunks_exact_mut(ow * 4).enumerate() {
                    let y = bi * band + ry;
                    let (fy0, fy1) = (y as f32 * ky, (y + 1) as f32 * ky);
                    for x in 0..dw {
                        let (fx0, fx1) = (x as f32 * kx, (x + 1) as f32 * kx);
                        let px = &mut row[(dx + x) * 4..(dx + x) * 4 + 4];
                        if kx > 1.0 || ky > 1.0 {
                            // Smaller: the mean of the covered pixels.
                            let (x0, x1) = (fx0 as usize, (fx1.ceil() as usize).min(sww));
                            let (y0, y1) = (fy0 as usize, (fy1.ceil() as usize).min(shh));
                            let (mut b, mut g, mut r, mut n) = (0u32, 0u32, 0u32, 0u32);
                            for yy in y0..y1.max(y0 + 1) {
                                let base = ((sy + yy.min(shh - 1)) * sw + sx) * 4;
                                for xx in x0..x1.max(x0 + 1) {
                                    let s = &source[base + xx.min(sww - 1) * 4..];
                                    b += s[0] as u32;
                                    g += s[1] as u32;
                                    r += s[2] as u32;
                                    n += 1;
                                }
                            }
                            px[0] = (b / n) as u8;
                            px[1] = (g / n) as u8;
                            px[2] = (r / n) as u8;
                        } else {
                            // Larger or equal: bilinear.
                            let cx = ((fx0 + fx1) / 2.0 - 0.5).clamp(0.0, sww as f32 - 1.0);
                            let cy = ((fy0 + fy1) / 2.0 - 0.5).clamp(0.0, shh as f32 - 1.0);
                            let (x0, y0) = (cx as usize, cy as usize);
                            let (x1, y1) = ((x0 + 1).min(sww - 1), (y0 + 1).min(shh - 1));
                            let (tx, ty) = (cx - x0 as f32, cy - y0 as f32);
                            let at = |xx: usize, yy: usize, c: usize| {
                                source[((sy + yy) * sw + sx + xx) * 4 + c] as f32
                            };
                            for c in 0..3 {
                                let top = at(x0, y0, c) * (1.0 - tx) + at(x1, y0, c) * tx;
                                let bottom = at(x0, y1, c) * (1.0 - tx) + at(x1, y1, c) * tx;
                                px[c] = (top * (1.0 - ty) + bottom * ty) as u8;
                            }
                        }
                        px[3] = 255;
                    }
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(buf: &[u8], w: usize, x: usize, y: usize) -> [u8; 3] {
        let i = (y * w + x) * 4;
        [buf[i + 2], buf[i + 1], buf[i]]
    }

    fn black(w: usize, h: usize) -> Vec<u8> {
        let mut v = vec![0u8; w * h * 4];
        for p in v.chunks_exact_mut(4) {
            p[3] = 255;
        }
        v
    }

    #[test]
    fn colours_are_read_from_hex() {
        assert_eq!(parse_hex("#3B82F6"), [0x3b, 0x82, 0xf6]);
        assert_eq!(parse_hex("bad"), [255, 255, 255]);
    }

    #[test]
    fn the_halo_is_strongest_in_the_middle_and_gone_outside() {
        let mut b = black(60, 60);
        draw_halo(&mut b, 60, 60, 30.0, 30.0, 20.0, [255, 255, 0]);
        let mid = px(&b, 60, 30, 30);
        let edge = px(&b, 60, 30, 48);
        assert!(mid[0] > 90 && mid[0] > edge[0], "{mid:?} {edge:?}");
        assert_eq!(
            px(&b, 60, 5, 5),
            [0, 0, 0],
            "outside the halo nothing changed"
        );
    }

    #[test]
    fn a_ripple_grows_and_fades_and_a_burst_draws_lines_around_the_point() {
        let mut early = black(100, 100);
        let mut late = black(100, 100);
        draw_ripple(&mut early, 100, 100, 50.0, 50.0, 30.0, 0.1, [255, 0, 0]);
        draw_ripple(&mut late, 100, 100, 50.0, 50.0, 30.0, 0.9, [255, 0, 0]);
        let lit = |b: &[u8]| b.chunks_exact(4).filter(|p| p[2] > 20).count();
        assert!(lit(&early) > 0);
        let strongest = |b: &[u8]| b.chunks_exact(4).map(|p| p[2]).max().unwrap();
        assert!(strongest(&early) > strongest(&late), "it fades");
        let mut b = black(100, 100);
        draw_burst(&mut b, 100, 100, 50.0, 50.0, 30.0, 0.3, [0, 255, 0]);
        assert!(lit_green(&b) > 20);
        assert_eq!(px(&b, 100, 50, 50), [0, 0, 0], "the middle stays clear");
    }

    fn lit_green(b: &[u8]) -> usize {
        b.chunks_exact(4).filter(|p| p[1] > 20).count()
    }

    #[test]
    fn a_scaled_cursor_is_bigger_and_keeps_its_colour() {
        let mut img = image::RgbaImage::new(4, 4);
        for p in img.pixels_mut() {
            *p = image::Rgba([255, 0, 0, 255]);
        }
        let mut b = black(30, 30);
        blend_scaled(&mut b, 30, 30, &img, 10.0, 10.0, 2.0);
        assert_eq!(px(&b, 30, 10, 10), [255, 0, 0]);
        assert_eq!(px(&b, 30, 17, 17), [255, 0, 0], "8 x 8 pixels now");
        assert_eq!(px(&b, 30, 18, 18), [0, 0, 0]);
    }

    #[test]
    fn the_webcam_is_cut_to_its_shape_with_a_border() {
        let cam: Vec<u8> = (0..40 * 30).flat_map(|_| [0u8, 200, 0, 255]).collect(); // green
        let mut circle = black(80, 80);
        draw_webcam(
            &mut circle,
            80,
            80,
            &cam,
            40,
            30,
            (10, 10, 60, 60),
            Shape::Circle,
            false,
        );
        assert_eq!(px(&circle, 80, 40, 40), [0, 200, 0]);
        assert_eq!(
            px(&circle, 80, 11, 11),
            [0, 0, 0],
            "the corner of a circle is not drawn"
        );
        let mut square = black(80, 80);
        draw_webcam(
            &mut square,
            80,
            80,
            &cam,
            40,
            30,
            (10, 10, 60, 60),
            Shape::Rect,
            false,
        );
        assert_eq!(px(&square, 80, 11, 11), [0, 200, 0]);
        let mut bordered = black(80, 80);
        draw_webcam(
            &mut bordered,
            80,
            80,
            &cam,
            40,
            30,
            (10, 10, 60, 60),
            Shape::Rect,
            true,
        );
        assert!(px(&bordered, 80, 11, 40)[0] > 235, "white border");
        assert_eq!(px(&bordered, 80, 40, 40), [0, 200, 0]);
        let mut rounded = black(80, 80);
        draw_webcam(
            &mut rounded,
            80,
            80,
            &cam,
            40,
            30,
            (10, 10, 60, 60),
            Shape::Rounded,
            false,
        );
        assert_eq!(px(&rounded, 80, 10, 10), [0, 0, 0], "rounded corners");
        assert_eq!(px(&rounded, 80, 40, 12), [0, 200, 0]);
    }

    #[test]
    fn output_plans_for_every_aspect_ratio_resolution_and_fit() {
        // The original, no limit.
        let p = plan_output(1920, 1080, Aspect::Original, Fit::Bars, None);
        assert_eq!((p.w, p.h, p.dst), (1920, 1080, (0, 0, 1920, 1080)));
        // 720p never makes a smaller picture bigger.
        let p = plan_output(640, 360, Aspect::Original, Fit::Bars, Some(720));
        assert_eq!((p.w, p.h), (640, 360));
        let p = plan_output(1920, 1080, Aspect::Original, Fit::Bars, Some(720));
        assert_eq!((p.w, p.h), (1280, 720));
        // 9:16 with bars around 16:9: a tall canvas, the picture in the middle.
        let p = plan_output(1920, 1080, Aspect::Tall, Fit::Bars, None);
        assert_eq!((p.w, p.h), (1920, 3412), "at the source's own scale");
        let p = plan_output(1920, 1080, Aspect::Tall, Fit::Bars, Some(1080));
        assert_eq!((p.w, p.h), (1080, 1920));
        assert_eq!(p.dst.2, 1080);
        assert_eq!(p.dst.3, 608);
        assert!(p.dst.1 > 600);
        // 9:16 cropped: the middle of the picture fills the canvas.
        let p = plan_output(1920, 1080, Aspect::Tall, Fit::Crop, None);
        assert_eq!((p.w, p.h), (608, 1080));
        assert_eq!(p.src, (656, 0, 608, 1080));
        assert_eq!(p.dst, (0, 0, 608, 1080));
        // 1:1 cropped, then limited to 480.
        let p = plan_output(1920, 1080, Aspect::Square, Fit::Crop, Some(480));
        assert_eq!((p.w, p.h), (480, 480));
        assert_eq!(p.src, (420, 0, 1080, 1080));
        // 16:9 from a portrait recording with bars.
        let p = plan_output(676, 1182, Aspect::Wide, Fit::Bars, None);
        assert!(p.w > p.h && p.w.is_multiple_of(2) && p.h.is_multiple_of(2));
        assert_eq!(p.h, 1182);
        // A portrait source and the 1080p limit apply to the short side.
        let p = plan_output(1080, 1920, Aspect::Original, Fit::Bars, Some(720));
        assert_eq!((p.w, p.h), (720, 1280));
    }

    #[test]
    fn scaling_averages_down_and_keeps_the_picture_when_the_size_is_the_same() {
        // 4 x 2 pixels, left half red, right half blue, scaled to 2 x 1.
        let mut src = Vec::new();
        for _ in 0..2 {
            for x in 0..4 {
                src.extend_from_slice(if x < 2 {
                    &[0, 0, 255, 255]
                } else {
                    &[255, 0, 0, 255]
                });
            }
        }
        let mut out = black(2, 1);
        scale_into(&src, 4, (0, 0, 4, 2), &mut out, 2, (0, 0, 2, 1));
        assert_eq!(px(&out, 2, 0, 0), [255, 0, 0]);
        assert_eq!(px(&out, 2, 1, 0), [0, 0, 255]);
        let mut same = black(4, 2);
        scale_into(&src, 4, (0, 0, 4, 2), &mut same, 4, (0, 0, 4, 2));
        assert_eq!(same, src);
        // Up: a 2 x 1 picture to 4 x 2 stays red on the left and blue on the right.
        let small = vec![0, 0, 255, 255, 255, 0, 0, 255];
        let mut big = black(4, 2);
        scale_into(&small, 2, (0, 0, 2, 1), &mut big, 4, (0, 0, 4, 2));
        assert_eq!(px(&big, 4, 0, 0), [255, 0, 0]);
        assert_eq!(px(&big, 4, 3, 1), [0, 0, 255]);
        // Bars: a picture scaled into the middle leaves the rest black.
        let mut bars = black(4, 4);
        scale_into(&small, 2, (0, 0, 2, 1), &mut bars, 4, (0, 1, 4, 2));
        assert_eq!(px(&bars, 4, 0, 0), [0, 0, 0]);
        assert_eq!(px(&bars, 4, 0, 1), [255, 0, 0]);
    }
}
