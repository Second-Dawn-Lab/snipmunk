//! Where writing stands in a screenshot, for Quick redact: text recognition leaves some lines out altogether (long runs of
//! digits in small smoothed type), so the places that look like writing and were not read are cut out and read again, and the
//! ink after a label can be covered even when it cannot be read.

/// A step in brightness between two neighbours that counts as the edge of a letter.
const EDGE: i32 = 48;

fn lum(rgba: &[u8], width: u32, x: u32, y: u32) -> i32 {
    let at = (y as usize * width as usize + x as usize) * 4;
    (77 * rgba[at] as i32 + 150 * rgba[at + 1] as i32 + 29 * rgba[at + 2] as i32) >> 8
}

/// The lowest and the highest letter sizes (pixels) looked at.
const MIN_BAND: usize = 5;
const MAX_BAND: usize = 90;

/// The pieces of `region` ([x, y, width, height]) that look like a stretch of writing of which the boxes in `known`
/// ([x, y, width, height]) cover little: as rectangles with a margin, the widest first, at most `most`.
pub fn unread_writing(
    rgba: &[u8],
    width: u32,
    height: u32,
    region: [u32; 4],
    known: &[[f32; 4]],
    most: usize,
) -> Vec<[u32; 4]> {
    let [rx, ry, rw, rh] = region;
    if rw < 8
        || rh < 8
        || rx + rw > width
        || ry + rh > height
        || rgba.len() != width as usize * height as usize * 4
    {
        return Vec::new();
    }
    let (w, h) = (rw as usize, rh as usize);
    let mut edge = vec![false; w * h];
    for y in 0..h {
        let mut left = lum(rgba, width, rx, ry + y as u32);
        for x in 1..w {
            let here = lum(rgba, width, rx + x as u32, ry + y as u32);
            edge[y * w + x] = (here - left).abs() > EDGE;
            left = here;
        }
    }
    // A vertical line taller than any letter (the border of a margin or a window, a change bar) is no writing; left in, it
    // would join the lines of text into one block.
    for x in 0..w {
        let mut y = 0;
        while y < h {
            let top = y;
            while y < h && edge[y * w + x] {
                y += 1;
            }
            if y - top > MAX_BAND {
                (top..y).for_each(|row| edge[row * w + x] = false);
            }
            y += 1;
        }
    }
    let written: Vec<bool> = (0..h)
        .map(|y| edge[y * w..(y + 1) * w].iter().filter(|e| **e).count() >= 3)
        .collect();
    let mut found: Vec<[u32; 4]> = Vec::new();
    let mut y = 0;
    while y < h {
        if !written[y] {
            y += 1;
            continue;
        }
        let top = y;
        while y < h && written[y] {
            y += 1;
        }
        let tall = y - top;
        if !(MIN_BAND..=MAX_BAND).contains(&tall) {
            continue;
        }
        let used: Vec<bool> = (0..w)
            .map(|x| (top..y).any(|row| edge[row * w + x]))
            .collect();
        // Boxes already read on these rows, in columns of the region (with half a letter of room at each end).
        let mid = |b: &[f32; 4]| b[1] + b[3] / 2.0 - ry as f32;
        let read: Vec<(f32, f32)> = known
            .iter()
            .filter(|b| mid(b) >= top as f32 - 2.0 && mid(b) <= y as f32 + 2.0)
            .map(|b| {
                let room = tall as f32 / 2.0;
                (b[0] - rx as f32 - room, b[0] + b[2] - rx as f32 + room)
            })
            .collect();
        let gap = (tall * 8 / 5).max(6);
        let mut x = 0;
        while x < w {
            if !used[x] {
                x += 1;
                continue;
            }
            let start = x;
            let mut end = x + 1;
            while x < w && x < end + gap {
                if used[x] {
                    end = x + 1;
                }
                x += 1;
            }
            // The longest stretch of this piece that no box covers.
            let (mut longest, mut run, mut quiet) = (0, 0, 0);
            for (column, inked) in used.iter().enumerate().take(end).skip(start) {
                let covered = read
                    .iter()
                    .any(|(a, b)| column as f32 >= *a && column as f32 <= *b);
                if covered {
                    run = 0;
                    quiet = 0;
                } else if *inked {
                    run += 1 + quiet;
                    quiet = 0;
                    longest = longest.max(run);
                } else if run > 0 {
                    quiet += 1;
                    if quiet > gap {
                        run = 0;
                        quiet = 0;
                    }
                }
            }
            if end - start >= tall * 5 / 2 && longest >= tall * 5 / 2 {
                let pad = 6;
                let x0 = (rx as usize + start).saturating_sub(pad) as u32;
                let y0 = (ry as usize + top).saturating_sub(pad) as u32;
                let x1 = ((rx as usize + end + pad) as u32).min(width);
                let y1 = ((ry as usize + y + pad) as u32).min(height);
                found.push([x0, y0, x1 - x0, y1 - y0]);
            }
        }
    }
    found.sort_by_key(|r| std::cmp::Reverse(r[2]));
    found.truncate(most);
    found
}

/// The ink that follows a label on its row: from the first mark within a few letters of the label's right edge to the last
/// one before a wide gap. `label` is [x, y, width, height]; `None` when nothing follows.
pub fn ink_after(rgba: &[u8], width: u32, height: u32, label: [u32; 4]) -> Option<[u32; 4]> {
    let [lx, ly, lw, lh] = label;
    if lh < 3 || rgba.len() != width as usize * height as usize * 4 {
        return None;
    }
    let from = lx.saturating_add(lw).saturating_add(1);
    let (y0, y1) = (ly.saturating_sub(1), ly.saturating_add(lh + 2).min(height));
    if from >= width || y0 >= y1 {
        return None;
    }
    // The background: the most frequent brightness of the band after the label.
    let mut counts = [0u32; 32];
    for y in y0..y1 {
        for x in from..from.saturating_add(40 * lh).min(width) {
            counts[(lum(rgba, width, x, y) / 8) as usize] += 1;
        }
    }
    let back = counts.iter().enumerate().max_by_key(|(_, n)| **n)?.0 as i32 * 8 + 4;
    let ink = |x: u32, y: u32| (lum(rgba, width, x, y) - back).abs() > 56;
    let (mut start, mut end) = (None, 0);
    for x in from..width {
        let marked = (y0..y1).any(|y| ink(x, y));
        match start {
            None if marked => (start, end) = (Some(x), x + 1),
            None if x > from + 4 * lh => return None,
            Some(_) if marked => end = x + 1,
            Some(_) if x > end + 2 * lh => break,
            _ => {}
        }
    }
    let start = start?;
    let rows: Vec<u32> = (y0..y1)
        .filter(|&y| (start..end).any(|x| ink(x, y)))
        .collect();
    let (top, bottom) = (*rows.first()?, *rows.last()? + 1);
    Some([start, top, end - start, bottom - top])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A white picture with "letters" (vertical strokes) on rows.
    struct Page {
        w: u32,
        h: u32,
        rgba: Vec<u8>,
    }

    impl Page {
        fn new(w: u32, h: u32) -> Self {
            Page {
                w,
                h,
                rgba: vec![255; (w * h * 4) as usize],
            }
        }

        fn fill(&mut self, [x, y, w, h]: [u32; 4], value: u8) {
            for row in y..y + h {
                for col in x..x + w {
                    let at = ((row * self.w + col) * 4) as usize;
                    self.rgba[at..at + 3].fill(value);
                }
            }
        }

        /// Letters 2 pixels wide every 6 pixels, 10 pixels tall.
        fn write(&mut self, x: u32, y: u32, letters: u32) {
            for i in 0..letters {
                self.fill([x + i * 6, y, 2, 10], 0);
            }
        }
    }

    #[test]
    fn writing_that_no_box_covers_is_found() {
        let mut p = Page::new(400, 100);
        // A margin line through the whole picture, a line that was read and one that was not.
        p.fill([20, 0, 2, 100], 0);
        p.write(40, 10, 20);
        p.write(40, 40, 30);
        let known = [[40.0, 10.0, 116.0, 10.0]];
        let found = unread_writing(&p.rgba, p.w, p.h, [0, 0, 400, 100], &known, 10);
        assert_eq!(found.len(), 1, "{found:?}");
        let [x, y, w, h] = found[0];
        assert!(
            (30..=40).contains(&x) && (30..=40).contains(&y),
            "{found:?}"
        );
        assert!(x + w >= 40 + 29 * 6 + 2 && y + h >= 50, "{found:?}");
        // Covered completely: nothing.
        let known = [[40.0, 10.0, 116.0, 10.0], [40.0, 40.0, 176.0, 10.0]];
        assert!(unread_writing(&p.rgba, p.w, p.h, [0, 0, 400, 100], &known, 10).is_empty());
        // A region outside the picture is nothing.
        assert!(unread_writing(&p.rgba, p.w, p.h, [0, 0, 500, 100], &[], 10).is_empty());
    }

    #[test]
    fn the_ink_after_a_label_ends_before_a_wide_gap() {
        let mut p = Page::new(400, 40);
        p.write(10, 10, 5);
        p.write(50, 10, 20);
        p.write(300, 10, 4);
        let found = ink_after(&p.rgba, p.w, p.h, [10, 10, 26, 10]).unwrap();
        assert_eq!(found, [50, 10, 19 * 6 + 2, 10]);
        assert!(ink_after(&p.rgba, p.w, p.h, [320, 10, 10, 10]).is_none());
        assert!(ink_after(&p.rgba, p.w, p.h, [390, 10, 20, 10]).is_none());
    }
}
