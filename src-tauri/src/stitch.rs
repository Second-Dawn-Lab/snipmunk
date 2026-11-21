#![allow(clippy::chunks_exact_to_as_chunks, clippy::too_many_arguments)]
//! Stitching the pictures of a scrolling screenshot into one tall image (no Windows code; unit tested with generated pages).
//!
//! The pictures are the same window or area after every scroll step (RGBA, the same size). To put one under the other:
//!
//! * **Sticky bands.** The rows at the top that are the same in two pictures at the same place are a fixed header, the rows at the
//!   bottom a fixed footer (both found from the first two pictures that differ, at most a third of the picture each). The header
//!   is kept once, with the first picture; the footer once, at the end; the pictures are only used between them.
//! * **The moving scrollbar.** The columns at the right edge are left out when rows are compared (a scrollbar's thumb moves), and the
//!   columns of the scrollbar that were found moving are cut off the finished image.
//! * **Overlap.** Every row of the middle part is reduced to a hash. The picture was scrolled by `d` rows when the rows of the new
//!   picture equal the rows `d` further down in the old one. All `d` are tried; the one that matches the most rows that are not
//!   plain background wins (a few rows may differ: a blinking caret, an animated banner). Where there is only background in the
//!   overlap (a blank stretch of a page) the distance of the last step is used.

/// A picture: RGBA rows, top first.
pub struct Picture<'a> {
    pub width: usize,
    pub height: usize,
    pub rgba: &'a [u8],
}

/// How the stitcher used a picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pushed {
    /// This many new rows were added at the bottom.
    Added(usize),
    /// The picture is the same as the one before: the page did not move (the end).
    Same,
    /// No overlap with the picture before was found: the scroll went too far (or the content changed completely).
    NoOverlap,
}

/// The columns at the right edge that are not compared (a scrollbar is up to this wide, in pixels).
const EDGE: usize = 48;
/// Fewer matching rows than this share of the overlap is not a match.
const MIN_RATIO: f32 = 0.985;
/// At least this many rows that are not plain background must match.
const MIN_INFORMATIVE: usize = 4;

struct Rows {
    hash: Vec<u64>,
    /// The row is not one colour (text, an edge, an image).
    busy: Vec<bool>,
}

pub struct Stitcher {
    width: usize,
    frame_h: usize,
    /// Everything stitched so far (RGBA), without the footer.
    out: Vec<u8>,
    height: usize,
    prev: Vec<u8>,
    header: Option<usize>,
    footer: usize,
    footer_rows: Vec<u8>,
    /// The widest scrollbar found moving.
    scrollbar: usize,
    last_d: Option<usize>,
    compare_w: usize,
}

fn row_stats(p: &Picture, y: usize, compare_w: usize) -> (u64, bool) {
    let row = &p.rgba[y * p.width * 4..y * p.width * 4 + compare_w * 4];
    let mut h: u64 = 0xcbf29ce484222325;
    let first = [row[0], row[1], row[2]];
    let mut busy = false;
    for px in row.chunks_exact(4) {
        for &b in &px[..3] {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        if px[0] != first[0] || px[1] != first[1] || px[2] != first[2] {
            busy = true;
        }
    }
    (h, busy)
}

fn rows_of(p: &Picture, range: std::ops::Range<usize>, compare_w: usize) -> Rows {
    let mut hash = Vec::with_capacity(range.len());
    let mut busy = Vec::with_capacity(range.len());
    for y in range {
        let (h, b) = row_stats(p, y, compare_w);
        hash.push(h);
        busy.push(b);
    }
    Rows { hash, busy }
}

impl Stitcher {
    /// Start with the first picture.
    pub fn new(first: &Picture) -> Self {
        let compare_w = first.width.saturating_sub(EDGE.min(first.width / 6)).max(1);
        Self {
            width: first.width,
            frame_h: first.height,
            out: first.rgba.to_vec(),
            height: first.height,
            prev: first.rgba.to_vec(),
            header: None,
            footer: 0,
            footer_rows: Vec::new(),
            scrollbar: 0,
            last_d: None,
            compare_w,
        }
    }

    /// The height of the image so far (rows).
    pub fn height(&self) -> usize {
        self.height
    }

    /// The rows between the sticky bands (the whole picture until two pictures have shown where the bands are).
    pub fn content_height(&self) -> usize {
        self.frame_h - self.header.unwrap_or(0) - self.footer
    }

    /// Add the next picture. `hint` is the expected scroll distance in rows when it is known. `scrolled` says that the scroll
    /// really moved (the window said so): then a picture that is plain background in both is a blank stretch of the page, not the
    /// end, and the rows are added with the distance of the step before.
    pub fn push(&mut self, next: &Picture, hint: Option<usize>, scrolled: bool) -> Pushed {
        if next.width != self.width || next.height != self.frame_h {
            return Pushed::NoOverlap;
        }
        let prev = Picture {
            width: self.width,
            height: self.frame_h,
            rgba: &self.prev,
        };
        let h = self.frame_h;
        let cw = self.compare_w;
        let all_prev = rows_of(&prev, 0..h, cw);
        let all_next = rows_of(next, 0..h, cw);
        if all_prev.hash == all_next.hash {
            let d = hint.or(self.last_d);
            if let (true, Some(d)) = (scrolled && !all_prev.busy.iter().any(|&b| b), d) {
                let top = self.header.unwrap_or(0);
                let d = d.min(h - top - self.footer);
                let from = (h - self.footer - d) * self.width * 4;
                let to = (h - self.footer) * self.width * 4;
                self.out.extend_from_slice(&next.rgba[from..to]);
                self.height += d;
                return Pushed::Added(d);
            }
            return Pushed::Same;
        }
        // The sticky bands come from the first two pictures that differ.
        if self.header.is_none() {
            let cap = h / 3;
            let top = (0..cap)
                .take_while(|&i| all_prev.hash[i] == all_next.hash[i])
                .count();
            let bottom = (0..cap)
                .take_while(|&i| all_prev.hash[h - 1 - i] == all_next.hash[h - 1 - i])
                .count();
            self.header = Some(top);
            self.footer = bottom;
            self.footer_rows = self.prev[(h - bottom) * self.width * 4..].to_vec();
            // The footer is not part of what was stitched so far.
            self.out.truncate(self.out.len() - bottom * self.width * 4);
            self.height -= bottom;
        }
        let top = self.header.unwrap_or(0);
        let region = top..h - self.footer;
        let hc = region.len();
        if hc < 8 {
            return Pushed::NoOverlap;
        }
        let a = &all_prev.hash[region.clone()];
        let b = &all_next.hash[region.clone()];
        let busy = &all_prev.busy[region.clone()];
        let hint = hint.or(self.last_d);
        let mut best: Option<(usize, usize, usize)> = None; // (informative, d closeness, d)
        let mut blank_ok: Vec<usize> = Vec::new();
        let min_overlap = 8usize;
        for d in 1..=hc.saturating_sub(min_overlap) {
            let n = hc - d;
            // Cheap exit: the first and last rows of the overlap decide most wrong distances at once.
            let (mut matched, mut informative) = (0usize, 0usize);
            let allowed_miss = ((n as f32) * (1.0 - MIN_RATIO)) as usize;
            let mut miss = 0usize;
            for i in 0..n {
                if b[i] == a[i + d] {
                    matched += 1;
                    if busy[i + d] {
                        informative += 1;
                    }
                } else {
                    miss += 1;
                    if miss > allowed_miss {
                        break;
                    }
                }
            }
            if miss > allowed_miss {
                continue;
            }
            let _ = matched;
            if informative >= MIN_INFORMATIVE {
                let close = hint.map_or(0, |h| h.abs_diff(d));
                let better = match best {
                    None => true,
                    Some((bi, bc, _)) => informative > bi || (informative == bi && close < bc),
                };
                if better {
                    best = Some((informative, close, d));
                }
            } else {
                blank_ok.push(d);
            }
        }
        let d = match best {
            Some((_, _, d)) => d,
            None => match hint.and_then(|h| blank_ok.iter().copied().min_by_key(|d| d.abs_diff(h)))
            {
                Some(d) => d,
                None => return Pushed::NoOverlap,
            },
        };
        // The scrollbar: columns at the right edge that differ in the overlap.
        let edge_from = self.width - EDGE.min(self.width / 6);
        let mut sb = 0;
        for x in edge_from..self.width {
            let mut diff = 0;
            for i in 0..hc - d {
                let ya = (top + i + d) * self.width * 4 + x * 4;
                let yb = (top + i) * self.width * 4 + x * 4;
                if self.prev[ya..ya + 3] != next.rgba[yb..yb + 3] {
                    diff += 1;
                    if diff >= 2 {
                        break;
                    }
                }
            }
            if diff >= 2 {
                sb = sb.max(self.width - x);
                break;
            }
        }
        self.scrollbar = self.scrollbar.max(sb);
        // The new rows are the last `d` rows of the middle part.
        let from = (top + hc - d) * self.width * 4;
        let to = (top + hc) * self.width * 4;
        self.out.extend_from_slice(&next.rgba[from..to]);
        self.height += d;
        self.prev.copy_from_slice(next.rgba);
        self.last_d = Some(d);
        Pushed::Added(d)
    }

    /// The finished image (RGBA, width, height): the footer added once, the scrollbar cut off.
    pub fn finish(mut self) -> (Vec<u8>, usize, usize) {
        let fb = self.footer_rows.len() / (self.width * 4).max(1);
        if fb > 0 {
            // The footer of the last picture (it is the same in all of them).
            let rows = self.footer_rows.clone();
            self.out.extend_from_slice(&rows);
            self.height += fb;
        }
        let keep = self.width - self.scrollbar.min(self.width.saturating_sub(1));
        if keep == self.width {
            return (self.out, self.width, self.height);
        }
        let mut cropped = Vec::with_capacity(keep * self.height * 4);
        for y in 0..self.height {
            let s = y * self.width * 4;
            cropped.extend_from_slice(&self.out[s..s + keep * 4]);
        }
        (cropped, keep, self.height)
    }

    /// A small picture of the image so far for the progress pill: the last rows, at most `max_h` tall and `max_w` wide (RGBA).
    pub fn thumbnail(&self, max_w: usize, max_h: usize) -> (Vec<u8>, usize, usize) {
        let scale = (self.width as f32 / max_w as f32).max(1.0);
        let tw = ((self.width as f32 / scale) as usize).max(1);
        let rows_src = ((max_h as f32 * scale) as usize).min(self.height).max(1);
        let th = ((rows_src as f32 / scale) as usize).max(1);
        let mut out = Vec::with_capacity(tw * th * 4);
        let y0 = self.height - rows_src;
        for ty in 0..th {
            let sy = (y0 + (ty as f32 * scale) as usize).min(self.height - 1);
            for tx in 0..tw {
                let sx = ((tx as f32 * scale) as usize).min(self.width - 1);
                let i = (sy * self.width + sx) * 4;
                out.extend_from_slice(&self.out[i..i + 4]);
            }
        }
        (out, tw, th)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A generated page: `w` x `rows` with rows of pseudo-random "text" and blank stretches where `blank(y)` says so.
    fn page(w: usize, rows: usize, blank: impl Fn(usize) -> bool) -> Vec<u8> {
        let mut v = vec![255u8; w * rows * 4];
        let mut seed = 12345u64;
        for y in 0..rows {
            if blank(y) {
                continue;
            }
            for x in 0..w {
                seed = seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                let g = (seed >> 56) as u8;
                if g < 90 {
                    let i = (y * w + x) * 4;
                    v[i] = g;
                    v[i + 1] = g / 2;
                    v[i + 2] = 200;
                }
            }
        }
        v
    }

    /// The window at scroll position `at` of a page: sticky header and footer, the scrollbar on the right with a moving thumb.
    fn view(
        page: &[u8],
        w: usize,
        total: usize,
        at: usize,
        h: usize,
        header: usize,
        footer: usize,
        sb: usize,
    ) -> Vec<u8> {
        let mut v = vec![0u8; w * h * 4];
        let body = h - header - footer;
        for y in 0..h {
            let src_row: Option<usize> = if y < header || y >= h - footer {
                None
            } else {
                Some(at + (y - header))
            };
            for x in 0..w {
                let i = (y * w + x) * 4;
                let px: [u8; 4] = if x >= w - sb {
                    // The scrollbar: a track with a thumb whose place depends on the position.
                    let thumb = (at * body / total.max(1)) + header;
                    if y >= thumb && y < thumb + 20 {
                        [90, 90, 90, 255]
                    } else {
                        [230, 230, 230, 255]
                    }
                } else if y < header {
                    [30, 60, 120, 255]
                } else if y >= h - footer {
                    [120, 60, 30, 255]
                } else {
                    let r = src_row.unwrap().min(total - 1);
                    let j = (r * w + x) * 4;
                    [page[j], page[j + 1], page[j + 2], 255]
                };
                v[i..i + 4].copy_from_slice(&px);
            }
        }
        v
    }

    fn run(
        w: usize,
        total: usize,
        h: usize,
        header: usize,
        footer: usize,
        sb: usize,
        step: usize,
        blank: impl Fn(usize) -> bool,
    ) -> (Vec<u8>, usize, usize, Vec<u8>) {
        let pg = page(w, total, blank);
        let body = h - header - footer;
        let mut at = 0;
        let first = view(&pg, w, total, 0, h, header, footer, sb);
        let mut st = Stitcher::new(&Picture {
            width: w,
            height: h,
            rgba: &first,
        });
        loop {
            let next_at = (at + step).min(total - body);
            let pic = view(&pg, w, total, next_at, h, header, footer, sb);
            match st.push(
                &Picture {
                    width: w,
                    height: h,
                    rgba: &pic,
                },
                None,
                next_at > at,
            ) {
                Pushed::Same => break,
                Pushed::Added(_) => {}
                Pushed::NoOverlap => panic!("no overlap at {next_at}"),
            }
            at = next_at;
            if at + body >= total {
                // One more push of the end: the same picture ends it.
                let again = view(&pg, w, total, at, h, header, footer, sb);
                assert_eq!(
                    st.push(
                        &Picture {
                            width: w,
                            height: h,
                            rgba: &again
                        },
                        None,
                        false
                    ),
                    Pushed::Same
                );
                break;
            }
        }
        let (img, iw, ih) = st.finish();
        (img, iw, ih, pg)
    }

    #[test]
    fn a_page_with_sticky_bands_and_a_moving_scrollbar_comes_out_as_the_page() {
        let (w, total, h, header, footer, sb) =
            (200usize, 3000usize, 400usize, 40usize, 30usize, 17usize);
        let (img, iw, ih, pg) = run(w, total, h, header, footer, sb, 250, |_| false);
        // The scrollbar is cut off; header once, then the page, then the footer once.
        assert_eq!(iw, w - sb);
        assert_eq!(ih, header + total + footer);
        let px = |y: usize, x: usize| &img[(y * iw + x) * 4..(y * iw + x) * 4 + 3];
        assert_eq!(px(5, 5), [30, 60, 120]);
        assert_eq!(px(ih - 3, 5), [120, 60, 30]);
        for y in (0..total).step_by(7) {
            for x in (0..iw).step_by(11) {
                assert_eq!(
                    px(header + y, x),
                    &pg[(y * w + x) * 4..(y * w + x) * 4 + 3],
                    "row {y} col {x}"
                );
            }
        }
    }

    #[test]
    fn a_blank_stretch_is_stitched_with_the_distance_of_the_step_before() {
        let (w, total, h) = (160usize, 2400usize, 300usize);
        let (img, iw, ih, pg) = run(w, total, h, 0, 0, 0, 200, |y| (900..1500).contains(&y));
        assert_eq!((iw, ih), (w, total));
        for y in (0..total).step_by(5) {
            assert_eq!(
                &img[(y * iw) * 4..(y * iw) * 4 + 12],
                &pg[(y * w) * 4..(y * w) * 4 + 12],
                "row {y}"
            );
        }
    }

    #[test]
    fn a_very_tall_page_is_stitched() {
        let (w, total, h) = (96usize, 40_000usize, 500usize);
        let (img, iw, ih, pg) = run(w, total, h, 20, 20, 0, 420, |_| false);
        assert_eq!((iw, ih), (w, total + 40));
        assert_eq!(img.len(), iw * ih * 4);
        for y in (0..total).step_by(97) {
            assert_eq!(
                &img[((y + 20) * iw) * 4..((y + 20) * iw) * 4 + 16],
                &pg[(y * w) * 4..(y * w) * 4 + 16],
                "row {y}"
            );
        }
    }

    #[test]
    fn a_scroll_that_went_too_far_has_no_overlap_and_the_same_picture_is_the_end() {
        let (w, total, h) = (120usize, 3000usize, 300usize);
        let pg = page(w, total, |_| false);
        let first = view(&pg, w, total, 0, h, 0, 0, 0);
        let mut st = Stitcher::new(&Picture {
            width: w,
            height: h,
            rgba: &first,
        });
        assert_eq!(
            st.push(
                &Picture {
                    width: w,
                    height: h,
                    rgba: &first
                },
                None,
                false
            ),
            Pushed::Same
        );
        let far = view(&pg, w, total, 1500, h, 0, 0, 0);
        assert_eq!(
            st.push(
                &Picture {
                    width: w,
                    height: h,
                    rgba: &far
                },
                None,
                true
            ),
            Pushed::NoOverlap
        );
        assert_eq!(st.height(), h);
        let (t, tw, th) = st.thumbnail(60, 40);
        assert_eq!(t.len(), tw * th * 4);
        assert!(tw <= 60 && th <= 40);
    }
}
