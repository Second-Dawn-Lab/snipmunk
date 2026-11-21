#![allow(
    clippy::chunks_exact_to_as_chunks,
    clippy::too_many_arguments,
    clippy::needless_range_loop
)]
//! The canvas of a scrolling screenshot (no Windows code; unit tested with generated pages).
//!
//! The user scrolls by hand, up or down, at their own pace, and a picture of the area arrives about fifteen times a second
//! (BGRA, always the same size). Every picture is put where it belongs on a growing canvas:
//!
//! * **Sticky bands.** The rows at the top (and bottom) that stay the same while the content moves are a fixed header (footer). They
//!   are found by comparing the first picture with the first one that differs a lot from it, and are kept once: the header above the
//!   canvas, the footer below it. The pictures are only used between them.
//! * **Placement.** Every row of the middle part is reduced to a hash (the columns at the right edge, where a scrollbar moves, are
//!   left out). A picture lies at `p` on the canvas when its rows equal the canvas rows from `p` on. Positions near the last one
//!   (one page up or down) are tried; the one that matches the most rows that are not plain background wins. So scrolling back up
//!   finds the content that is on the canvas already and adds nothing twice; content above the first picture is added above, content
//!   below the last one is added below.
//! * **Newest wins.** A row that is on the canvas already but differs in the new picture (an image that loaded later) is replaced.
//! * **Too fast.** When no position matches (the scroll jumped further than a page, or the content changed completely) the picture is
//!   not used and the canvas is `lost`: the next pictures are tried against the whole canvas, so scrolling back to something that was
//!   captured finds the place again. Nothing that was captured is lost.

/// A picture: BGRA rows, top first.
pub struct Picture<'a> {
    pub width: usize,
    pub height: usize,
    pub bgra: &'a [u8],
}

/// What happened to a picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placed {
    /// The picture is the same as the one before.
    Same,
    /// Not much has moved yet: the sticky bands are not known, the picture waits.
    Waiting,
    /// Placed; this many rows were added (0 = only rows that were there were looked at or replaced).
    Added(usize),
    /// No place was found: the scroll was too fast (or the page changed). Nothing was changed.
    Lost,
}

/// The columns at the right edge that are not compared (a scrollbar is up to this wide, in pixels).
const EDGE: usize = 48;
/// A picture has to differ in this share of its rows from the first one before the sticky bands are measured.
const BANDS_AFTER_PERCENT: usize = 30;
/// The least overlap (rows) a position needs.
const MIN_OVERLAP: usize = 16;
/// At least this many rows that are not plain background must match.
const MIN_INFORMATIVE: usize = 6;
/// At least this share of the overlapping rows must match (some rows differ: a loaded image, an animation).
const MIN_MATCH_PERCENT: usize = 60;

struct Rows {
    hash: Vec<u64>,
    busy: Vec<bool>,
}

fn row_stats(p: &Picture, y: usize, compare_w: usize) -> (u64, bool) {
    let row = &p.bgra[y * p.width * 4..y * p.width * 4 + compare_w * 4];
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

pub struct Canvas {
    width: usize,
    frame_h: usize,
    compare_w: usize,
    /// The first picture, until the sticky bands are known.
    first: Option<Vec<u8>>,
    /// (header rows, footer rows) once known.
    bands: Option<(usize, usize)>,
    header: Vec<u8>,
    footer: Vec<u8>,
    body: Vec<u8>,
    hash: Vec<u64>,
    busy: Vec<bool>,
    /// Where the last picture's middle part lies on the body.
    last_p: i64,
    prev: Vec<u8>,
    scrollbar: usize,
    lost: bool,
    max_rows: usize,
    at_max: bool,
}

impl Canvas {
    /// Start with the first picture; the canvas is never taller than `max_rows`.
    pub fn new(first: &Picture, max_rows: usize) -> Self {
        let compare_w = first.width.saturating_sub(EDGE.min(first.width / 6)).max(1);
        Self {
            width: first.width,
            frame_h: first.height,
            compare_w,
            first: Some(first.bgra.to_vec()),
            bands: None,
            header: Vec::new(),
            footer: Vec::new(),
            body: Vec::new(),
            hash: Vec::new(),
            busy: Vec::new(),
            last_p: 0,
            prev: first.bgra.to_vec(),
            scrollbar: 0,
            lost: false,
            max_rows,
            at_max: false,
        }
    }

    fn header_rows(&self) -> usize {
        self.header.len() / (self.width * 4)
    }

    fn footer_rows(&self) -> usize {
        self.footer.len() / (self.width * 4)
    }

    /// The height of the finished image so far (rows).
    pub fn height(&self) -> usize {
        match self.bands {
            None => self.frame_h,
            Some(_) => self.header_rows() + self.hash.len() + self.footer_rows(),
        }
    }

    /// The canvas stopped growing because it reached the maximum height.
    pub fn at_max(&self) -> bool {
        self.at_max
    }

    /// The last picture could not be placed (and no later one could be yet).
    #[cfg(test)]
    pub fn lost(&self) -> bool {
        self.lost
    }

    /// Put the next picture on the canvas.
    pub fn push(&mut self, next: &Picture) -> Placed {
        if next.width != self.width || next.height != self.frame_h {
            return Placed::Lost;
        }
        if next.bgra == self.prev.as_slice() {
            return Placed::Same;
        }
        let h = self.frame_h;
        let cw = self.compare_w;
        let rows = rows_of(next, 0..h, cw);
        if self.bands.is_none() {
            let first = self.first.clone().unwrap_or_default();
            let f0 = Picture {
                width: self.width,
                height: h,
                bgra: &first,
            };
            let base = rows_of(&f0, 0..h, cw);
            let differ = (0..h).filter(|&i| base.hash[i] != rows.hash[i]).count();
            if differ * 100 < BANDS_AFTER_PERCENT * h {
                self.prev.copy_from_slice(next.bgra);
                return Placed::Waiting;
            }
            let cap = h / 3;
            let top = (0..cap)
                .take_while(|&i| base.hash[i] == rows.hash[i])
                .count();
            let bottom = (0..cap)
                .take_while(|&i| base.hash[h - 1 - i] == rows.hash[h - 1 - i])
                .count();
            let rw = self.width * 4;
            self.header = first[..top * rw].to_vec();
            self.footer = first[(h - bottom) * rw..].to_vec();
            self.body = first[top * rw..(h - bottom) * rw].to_vec();
            self.hash = base.hash[top..h - bottom].to_vec();
            self.busy = base.busy[top..h - bottom].to_vec();
            self.bands = Some((top, bottom));
            self.last_p = 0;
            self.first = None;
        }
        let (top, bottom) = self.bands.unwrap_or((0, 0));
        let hc = h - top - bottom;
        if hc < MIN_OVERLAP {
            return Placed::Lost;
        }
        let f_hash = &rows.hash[top..h - bottom];
        let f_busy = &rows.busy[top..h - bottom];
        let body_h = self.hash.len() as i64;
        let (lo, hi) = if self.lost {
            (
                -(hc as i64) + MIN_OVERLAP as i64,
                body_h - MIN_OVERLAP as i64,
            )
        } else {
            (
                self.last_p - hc as i64 + MIN_OVERLAP as i64,
                self.last_p + hc as i64 - MIN_OVERLAP as i64,
            )
        };
        // (informative matches, closeness, position)
        let mut best: Option<(usize, i64, i64)> = None;
        for p in lo..=hi {
            let from = (-p).max(0) as usize;
            let to = ((body_h - p).min(hc as i64)).max(0) as usize;
            if to <= from || to - from < MIN_OVERLAP {
                continue;
            }
            let n = to - from;
            let allowed_miss = n * (100 - MIN_MATCH_PERCENT) / 100;
            let (mut matched, mut informative, mut miss) = (0usize, 0usize, 0usize);
            for i in from..to {
                if f_hash[i] == self.hash[(p + i as i64) as usize] {
                    matched += 1;
                    if f_busy[i] {
                        informative += 1;
                    }
                } else {
                    miss += 1;
                    if miss > allowed_miss {
                        break;
                    }
                }
            }
            if miss > allowed_miss
                || informative < MIN_INFORMATIVE
                || matched * 100 < MIN_MATCH_PERCENT * n
            {
                continue;
            }
            let close = (p - self.last_p).abs();
            let better = match best {
                None => true,
                Some((bi, bc, _)) => informative > bi || (informative == bi && close < bc),
            };
            if better {
                best = Some((informative, close, p));
            }
        }
        let Some((_, _, mut p)) = best else {
            self.lost = true;
            return Placed::Lost;
        };
        self.lost = false;
        let rw = self.width * 4;
        let mut added = 0usize;
        // The scrollbar: columns at the right edge that differ where the rows are the same.
        let edge_from = self.width - EDGE.min(self.width / 6);
        let from = (-p).max(0) as usize;
        let to = ((body_h - p).min(hc as i64)).max(0) as usize;
        for x in edge_from..self.width {
            let mut diff = 0;
            for i in from..to {
                if f_hash[i] == self.hash[(p + i as i64) as usize] {
                    let a = (p + i as i64) as usize * rw + x * 4;
                    let b = (top + i) * rw + x * 4;
                    if self.body[a..a + 3] != next.bgra[b..b + 3] {
                        diff += 1;
                        if diff >= 2 {
                            break;
                        }
                    }
                }
            }
            if diff >= 2 {
                self.scrollbar = self.scrollbar.max(self.width - x);
                break;
            }
        }
        let room = self.max_rows.saturating_sub(top + bottom);
        // Above the canvas: new rows at the front.
        if p < 0 {
            let want = (-p) as usize;
            let take = want.min(room.saturating_sub(self.hash.len()));
            if take < want {
                self.at_max = true;
            }
            if take > 0 {
                let src_from = (top + want - take) * rw;
                let src_to = (top + want) * rw;
                self.body
                    .splice(0..0, next.bgra[src_from..src_to].iter().copied());
                self.hash
                    .splice(0..0, f_hash[want - take..want].iter().copied());
                self.busy
                    .splice(0..0, f_busy[want - take..want].iter().copied());
                added += take;
            }
            // The picture's row `want - take` is now the first row of the canvas.
            p = -((want - take) as i64);
        }
        // Rows that are there already: the newest picture of a row wins.
        let from = (-p).max(0) as usize;
        let to = ((self.hash.len() as i64 - p).min(hc as i64)).max(0) as usize;
        for i in from..to {
            let r = (p + i as i64) as usize;
            if f_hash[i] != self.hash[r] {
                self.body[r * rw..(r + 1) * rw]
                    .copy_from_slice(&next.bgra[(top + i) * rw..(top + i + 1) * rw]);
                self.hash[r] = f_hash[i];
                self.busy[r] = f_busy[i];
            }
        }
        // Below the canvas: new rows at the end.
        let have = self.hash.len() as i64;
        if p + hc as i64 > have {
            let start = (have - p).max(0) as usize;
            let want = hc - start;
            let take = want.min(room.saturating_sub(self.hash.len()));
            if take < want {
                self.at_max = true;
            }
            if take > 0 {
                self.body
                    .extend_from_slice(&next.bgra[(top + start) * rw..(top + start + take) * rw]);
                self.hash.extend_from_slice(&f_hash[start..start + take]);
                self.busy.extend_from_slice(&f_busy[start..start + take]);
                added += take;
            }
        }
        self.footer = next.bgra[(h - bottom) * rw..].to_vec();
        self.last_p = p.max(-(hc as i64));
        self.prev.copy_from_slice(next.bgra);
        Placed::Added(added)
    }

    /// The finished image (BGRA, width, height): header, canvas, footer, the scrollbar cut off.
    pub fn finish(self) -> (Vec<u8>, usize, usize) {
        let rw = self.width * 4;
        let (data, height) = match self.bands {
            None => (self.first.unwrap_or(self.prev), self.frame_h),
            Some(_) => {
                let mut v =
                    Vec::with_capacity(self.header.len() + self.body.len() + self.footer.len());
                v.extend_from_slice(&self.header);
                v.extend_from_slice(&self.body);
                v.extend_from_slice(&self.footer);
                let h = v.len() / rw;
                (v, h)
            }
        };
        let keep = self.width - self.scrollbar.min(self.width.saturating_sub(1));
        if keep == self.width {
            return (data, self.width, height);
        }
        let mut cropped = Vec::with_capacity(keep * height * 4);
        for y in 0..height {
            let s = y * rw;
            cropped.extend_from_slice(&data[s..s + keep * 4]);
        }
        (cropped, keep, height)
    }

    /// A small picture of the whole canvas for the pill (RGBA), at most `max_w` x `max_h`.
    pub fn thumbnail(&self, max_w: usize, max_h: usize) -> (Vec<u8>, usize, usize) {
        let rw = self.width * 4;
        let rows: Vec<&[u8]> = match self.bands {
            None => vec![self.first.as_deref().unwrap_or(&self.prev)],
            Some(_) => vec![&self.header, &self.body, &self.footer],
        };
        let total: usize = rows.iter().map(|r| r.len() / rw).sum();
        let scale = (self.width as f32 / max_w as f32)
            .max(total as f32 / max_h as f32)
            .max(1.0);
        let tw = ((self.width as f32 / scale) as usize).max(1);
        let th = ((total as f32 / scale) as usize).max(1);
        let mut out = Vec::with_capacity(tw * th * 4);
        for ty in 0..th {
            let mut sy = ((ty as f32 * scale) as usize).min(total.saturating_sub(1));
            let mut part = 0;
            while part < rows.len() && sy >= rows[part].len() / rw {
                sy -= rows[part].len() / rw;
                part += 1;
            }
            let part = part.min(rows.len() - 1);
            let row = rows[part];
            let sy = sy.min((row.len() / rw).saturating_sub(1));
            for tx in 0..tw {
                let sx = ((tx as f32 * scale) as usize).min(self.width - 1);
                let i = sy * rw + sx * 4;
                if i + 4 <= row.len() {
                    out.extend_from_slice(&[row[i + 2], row[i + 1], row[i], 255]);
                } else {
                    out.extend_from_slice(&[255, 255, 255, 255]);
                }
            }
        }
        (out, tw, th)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A generated page of `rows` rows of pseudo-random "text".
    fn page(w: usize, rows: usize) -> Vec<u8> {
        let mut v = vec![255u8; w * rows * 4];
        let mut seed = 12345u64;
        for y in 0..rows {
            // Some blank rows between "paragraphs".
            if y % 53 > 40 {
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

    struct Setup {
        w: usize,
        h: usize,
        header: usize,
        footer: usize,
        sb: usize,
    }

    /// The window at scroll position `at` of a page: sticky header and footer, the scrollbar on the right with a moving thumb.
    fn view(page: &[u8], total: usize, at: usize, s: &Setup) -> Vec<u8> {
        let (w, h) = (s.w, s.h);
        let mut v = vec![0u8; w * h * 4];
        let body = h - s.header - s.footer;
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let px: [u8; 4] = if x >= w - s.sb {
                    let thumb = (at * body / total.max(1)) + s.header;
                    if y >= thumb && y < thumb + 20 {
                        [90, 90, 90, 255]
                    } else {
                        [230, 230, 230, 255]
                    }
                } else if y < s.header {
                    [120, 60, 30, 255]
                } else if y >= h - s.footer {
                    [30, 60, 120, 255]
                } else {
                    let r = (at + (y - s.header)).min(total - 1);
                    let j = (r * w + x) * 4;
                    [page[j], page[j + 1], page[j + 2], 255]
                };
                v[i..i + 4].copy_from_slice(&px);
            }
        }
        v
    }

    fn pic<'a>(s: &Setup, d: &'a [u8]) -> Picture<'a> {
        Picture {
            width: s.w,
            height: s.h,
            bgra: d,
        }
    }

    fn check(img: &[u8], iw: usize, ih: usize, pg: &[u8], total: usize, s: &Setup) {
        assert_eq!(iw, s.w - s.sb);
        assert_eq!(ih, s.header + total + s.footer);
        let px = |y: usize, x: usize| &img[(y * iw + x) * 4..(y * iw + x) * 4 + 3];
        for y in (0..total).step_by(3) {
            for x in (0..iw).step_by(7) {
                assert_eq!(
                    px(s.header + y, x),
                    &pg[(y * s.w + x) * 4..(y * s.w + x) * 4 + 3],
                    "row {y} col {x}"
                );
            }
        }
        if s.header > 0 {
            assert_eq!(px(2, 2), [120, 60, 30]);
        }
        if s.footer > 0 {
            assert_eq!(px(ih - 3, 2), [30, 60, 120]);
        }
    }

    /// Feed the positions one after the other (every one is a picture); returns the canvas.
    fn run(s: &Setup, total: usize, path: &[usize]) -> (Canvas, Vec<u8>, Vec<Placed>) {
        let pg = page(s.w, total);
        let first = view(&pg, total, path[0], s);
        let mut c = Canvas::new(&pic(s, &first), 100_000);
        let mut log = Vec::new();
        for &at in &path[1..] {
            let d = view(&pg, total, at, s);
            log.push(c.push(&pic(s, &d)));
        }
        (c, pg, log)
    }

    fn steps(from: usize, to: usize, step: usize) -> Vec<usize> {
        let mut v = Vec::new();
        let mut at = from as i64;
        let dir = if to >= from {
            step as i64
        } else {
            -(step as i64)
        };
        while (dir > 0 && at < to as i64) || (dir < 0 && at > to as i64) {
            v.push(at as usize);
            at += dir;
        }
        v.push(to);
        v
    }

    #[test]
    fn scrolling_down_gives_the_page_with_the_header_and_footer_once_and_no_scrollbar() {
        let s = Setup {
            w: 200,
            h: 400,
            header: 40,
            footer: 30,
            sb: 17,
        };
        let total = 3000;
        let body = s.h - s.header - s.footer;
        let (c, pg, log) = run(&s, total, &steps(0, total - body, 45));
        assert!(!log.contains(&Placed::Lost), "{log:?}");
        let (img, iw, ih) = c.finish();
        check(&img, iw, ih, &pg, total, &s);
    }

    #[test]
    fn scrolling_back_up_and_down_adds_nothing_twice() {
        let s = Setup {
            w: 160,
            h: 300,
            header: 24,
            footer: 0,
            sb: 0,
        };
        let total = 2400;
        let body = s.h - s.header;
        let mut path = steps(0, 1200, 40);
        path.extend(steps(1200, 500, 35));
        path.extend(steps(500, total - body, 50));
        let (c, pg, log) = run(&s, total, &path);
        assert!(!log.contains(&Placed::Lost), "{log:?}");
        let (img, iw, ih) = c.finish();
        check(&img, iw, ih, &pg, total, &s);
    }

    #[test]
    fn starting_in_the_middle_and_scrolling_up_adds_rows_above_and_the_header_stays_on_top() {
        let s = Setup {
            w: 160,
            h: 300,
            header: 24,
            footer: 20,
            sb: 0,
        };
        let total = 2000;
        let body = s.h - s.header - s.footer;
        let mut path = steps(800, 0, 40);
        path.extend(steps(0, total - body, 60));
        let (c, pg, log) = run(&s, total, &path);
        assert!(!log.contains(&Placed::Lost), "{log:?}");
        let (img, iw, ih) = c.finish();
        check(&img, iw, ih, &pg, total, &s);
    }

    #[test]
    fn a_jump_that_is_too_fast_is_lost_and_scrolling_back_finds_the_place_again() {
        let s = Setup {
            w: 160,
            h: 300,
            header: 24,
            footer: 20,
            sb: 0,
        };
        let total = 4000;
        let body = s.h - s.header - s.footer;
        let pg = page(s.w, total);
        let first = view(&pg, total, 0, &s);
        let mut c = Canvas::new(&pic(&s, &first), 100_000);
        for at in steps(0, 600, 40) {
            let d = view(&pg, total, at, &s);
            c.push(&pic(&s, &d));
        }
        let height = c.height();
        // A jump of 2000 rows: nothing overlaps.
        let far = view(&pg, total, 2600, &s);
        assert_eq!(c.push(&pic(&s, &far)), Placed::Lost);
        assert!(c.lost());
        assert_eq!(c.height(), height, "nothing was changed");
        // Still too far: lost again; nothing is added.
        let far2 = view(&pg, total, 2400, &s);
        assert_eq!(c.push(&pic(&s, &far2)), Placed::Lost);
        // Back near what was captured: the place is found again (the whole canvas is searched) and the scroll goes on.
        for at in steps(500, total - body, 45) {
            let d = view(&pg, total, at, &s);
            let r = c.push(&pic(&s, &d));
            assert_ne!(r, Placed::Lost, "at {at}");
        }
        assert!(!c.lost());
        let (img, iw, ih) = c.finish();
        check(&img, iw, ih, &pg, total, &s);
    }

    #[test]
    fn an_image_that_loads_later_replaces_the_placeholder_rows() {
        let s = Setup {
            w: 160,
            h: 300,
            header: 0,
            footer: 0,
            sb: 0,
        };
        let total = 1500;
        let mut pg = page(s.w, total);
        let truth = pg.clone();
        // Rows 700..800 are a grey placeholder at first.
        for y in 700..800 {
            for x in 0..s.w {
                let i = (y * s.w + x) * 4;
                pg[i..i + 4].copy_from_slice(&[200, 200, 200, 255]);
            }
        }
        let first = view(&pg, total, 400, &s);
        let mut c = Canvas::new(&pic(&s, &first), 100_000);
        // The placeholder is seen while scrolling down; then the image is loaded and the next pictures show it.
        for at in steps(400, 900, 40) {
            let d = view(&pg, total, at, &s);
            c.push(&pic(&s, &d));
        }
        for at in steps(900, 560, 30) {
            let d = view(&truth, total, at, &s);
            c.push(&pic(&s, &d));
        }
        for at in steps(560, total - s.h, 40) {
            let d = view(&truth, total, at, &s);
            c.push(&pic(&s, &d));
        }
        let (img, iw, ih) = c.finish();
        // Rows 400.. of the page start the canvas.
        assert_eq!(iw, s.w);
        let row = |y: usize| &img[((y - 400) * iw) * 4..((y - 400) * iw) * 4 + 12];
        for y in (700..800).step_by(5) {
            assert_eq!(row(y), &truth[(y * s.w) * 4..(y * s.w) * 4 + 12], "row {y}");
        }
        assert_eq!(ih, total - 400);
    }

    #[test]
    fn a_page_of_forty_thousand_rows_and_the_maximum_height() {
        let s = Setup {
            w: 96,
            h: 500,
            header: 20,
            footer: 20,
            sb: 0,
        };
        let total = 40_000;
        let body = s.h - s.header - s.footer;
        let pg = page(s.w, total);
        let first = view(&pg, total, 0, &s);
        let mut c = Canvas::new(&pic(&s, &first), 100_000);
        for at in steps(0, total - body, 150) {
            let d = view(&pg, total, at, &s);
            assert_ne!(c.push(&pic(&s, &d)), Placed::Lost, "at {at}");
        }
        let (img, iw, ih) = c.finish();
        assert_eq!((iw, ih), (s.w, total + 40));
        assert_eq!(
            &img[((20 + 30_000) * iw) * 4..((20 + 30_000) * iw) * 4 + 16],
            &pg[(30_000 * s.w) * 4..(30_000 * s.w) * 4 + 16]
        );
        // With a maximum the canvas stops growing and says so.
        let mut c = Canvas::new(&pic(&s, &first), 3000);
        for at in steps(0, 8000, 150) {
            let d = view(&pg, total, at, &s);
            c.push(&pic(&s, &d));
        }
        assert!(c.at_max());
        assert!(c.height() <= 3000, "{}", c.height());
        let (t, tw, th) = c.thumbnail(60, 90);
        assert_eq!(t.len(), tw * th * 4);
        assert!(tw <= 60 && th <= 90);
    }

    #[test]
    fn a_small_move_waits_and_a_picture_that_did_not_change_is_the_same() {
        let s = Setup {
            w: 120,
            h: 200,
            header: 0,
            footer: 0,
            sb: 0,
        };
        let pg = page(s.w, 1000);
        let first = view(&pg, 1000, 0, &s);
        let mut c = Canvas::new(&pic(&s, &first), 10_000);
        assert_eq!(c.push(&pic(&s, &first)), Placed::Same);
        // Only a few rows change (a blinking caret): nothing has been scrolled.
        let mut small = first.clone();
        for b in small[..40 * 4].iter_mut() {
            *b = !*b;
        }
        assert_eq!(c.push(&pic(&s, &small)), Placed::Waiting);
        assert_eq!(c.height(), s.h);
        let (img, iw, ih) = c.finish();
        assert_eq!((iw, ih), (s.w, s.h));
        assert_eq!(img.len(), iw * ih * 4);
    }
}
