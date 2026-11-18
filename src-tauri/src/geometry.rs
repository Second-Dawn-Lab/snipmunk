//! Pure geometry of a capture, all in physical pixels of the virtual desktop (the unit of monitor and window
//! rectangles on Windows). Nothing here touches the OS, so the mixed-DPI cases are unit tested.
//!
//! A monitor with 150 % scaling is 1.5 times as many physical pixels per CSS pixel as one with 100 %. The overlay pages
//! convert pointer positions to physical pixels of their own monitor; the Rust side only ever sees physical pixels.

use dawn_capture::Frame;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: u32, h: u32) -> Self {
        Self { x, y, w, h }
    }

    pub fn right(&self) -> i32 {
        self.x + self.w as i32
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.h as i32
    }

    pub fn contains(&self, p: (i32, i32)) -> bool {
        p.0 >= self.x && p.0 < self.right() && p.1 >= self.y && p.1 < self.bottom()
    }

    pub fn center(&self) -> (i32, i32) {
        (self.x + self.w as i32 / 2, self.y + self.h as i32 / 2)
    }

    /// The overlap of two rectangles; `None` when they only touch or do not meet.
    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let x0 = self.x.max(other.x);
        let y0 = self.y.max(other.y);
        let x1 = self.right().min(other.right());
        let y1 = self.bottom().min(other.bottom());
        (x1 > x0 && y1 > y0).then(|| Rect::new(x0, y0, (x1 - x0) as u32, (y1 - y0) as u32))
    }
}

/// A selection smaller than this (physical pixels, either side) is an accident and cancels.
pub const MIN_SELECTION: u32 = 4;

/// The monitor that contains a point, or the one nearest to it (a pointer exactly on a seam, or off every monitor).
pub fn monitor_at(monitors: &[Rect], p: (i32, i32)) -> Option<usize> {
    if let Some(i) = monitors.iter().position(|m| m.contains(p)) {
        return Some(i);
    }
    monitors
        .iter()
        .enumerate()
        .min_by_key(|(_, m)| {
            let dx = (m.x - p.0).max(0).max(p.0 - (m.right() - 1)) as i64;
            let dy = (m.y - p.1).max(0).max(p.1 - (m.bottom() - 1)) as i64;
            dx * dx + dy * dy
        })
        .map(|(i, _)| i)
}

/// The part of `area` that lies on a monitor: the bounding box of its overlaps with the monitors. A window half dragged
/// off the screen is captured only where it is visible. `None` when none of it is on a monitor.
pub fn visible_part(area: Rect, monitors: &[Rect]) -> Option<Rect> {
    let mut parts = monitors.iter().filter_map(|m| m.intersect(&area));
    let first = parts.next()?;
    let (mut x0, mut y0, mut x1, mut y1) = (first.x, first.y, first.right(), first.bottom());
    for p in parts {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.right());
        y1 = y1.max(p.bottom());
    }
    Some(Rect::new(x0, y0, (x1 - x0) as u32, (y1 - y0) as u32))
}

/// Copy `area` (desktop pixels) out of the screenshots, each of which sits at its monitor's place. A rectangle that spans
/// monitors is stitched together. Pixels that no monitor covers stay transparent.
pub fn compose(screens: &[(Rect, &Frame)], area: Rect) -> Option<Frame> {
    if area.w == 0 || area.h == 0 {
        return None;
    }
    let (w, h) = (area.w as usize, area.h as usize);
    let mut rgba = vec![0u8; w * h * 4];
    let mut covered = false;
    for (place, frame) in screens {
        let Some(part) = place.intersect(&area) else {
            continue;
        };
        covered = true;
        let rows = part.h as usize;
        let len = part.w as usize * 4;
        for r in 0..rows {
            let sy = (part.y - place.y) as usize + r;
            let sx = (part.x - place.x) as usize;
            let src = (sy * frame.width as usize + sx) * 4;
            let dy = (part.y - area.y) as usize + r;
            let dx = (part.x - area.x) as usize;
            let dst = (dy * w + dx) * 4;
            if src + len <= frame.rgba.len() {
                rgba[dst..dst + len].copy_from_slice(&frame.rgba[src..src + len]);
            }
        }
    }
    covered.then_some(Frame {
        width: area.w,
        height: area.h,
        rgba,
    })
}

// --- windows that appear during a capture ----------------------------------

/// Where the toast goes: the bottom-right corner of the work area (the screen without the taskbar).
pub fn toast_position(work: Rect, size: (u32, u32), margin: u32) -> (i32, i32) {
    let x = work.right() - size.0 as i32 - margin as i32;
    let y = work.bottom() - size.1 as i32 - margin as i32;
    (x.max(work.x), y.max(work.y))
}

/// Where the countdown badge goes: just below and right of the pointer, moved to stay on the pointer's monitor.
pub fn badge_position(cursor: (i32, i32), size: u32, monitors: &[Rect], offset: i32) -> (i32, i32) {
    let Some(i) = monitor_at(monitors, cursor) else {
        return (cursor.0 + offset, cursor.1 + offset);
    };
    let m = monitors[i];
    let s = size as i32;
    let mut x = cursor.0 + offset;
    let mut y = cursor.1 + offset;
    if x + s > m.right() {
        x = cursor.0 - offset - s; // flip to the left of the pointer
    }
    if y + s > m.bottom() {
        y = cursor.1 - offset - s; // flip above
    }
    (
        x.clamp(m.x, (m.right() - s).max(m.x)),
        y.clamp(m.y, (m.bottom() - s).max(m.y)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: u32, h: u32, rgba: [u8; 4]) -> Frame {
        Frame {
            width: w,
            height: h,
            rgba: rgba
                .iter()
                .copied()
                .cycle()
                .take((w * h * 4) as usize)
                .collect(),
        }
    }

    // A 100 % monitor on the left and a 150 % monitor on the right (physical sizes differ from logical ones).
    fn mixed() -> Vec<Rect> {
        vec![
            Rect::new(0, 0, 1920, 1080),
            Rect::new(1920, -200, 2880, 1620),
        ]
    }

    #[test]
    fn rectangles_intersect_only_when_they_overlap() {
        let a = Rect::new(0, 0, 100, 100);
        assert_eq!(
            a.intersect(&Rect::new(50, 50, 100, 100)),
            Some(Rect::new(50, 50, 50, 50))
        );
        assert_eq!(
            a.intersect(&Rect::new(100, 0, 10, 10)),
            None,
            "touching is not overlapping"
        );
        assert_eq!(
            a.intersect(&Rect::new(-5, -5, 10, 10)),
            Some(Rect::new(0, 0, 5, 5))
        );
    }

    #[test]
    fn the_monitor_under_a_point_is_found_on_mixed_dpi_layouts() {
        let m = mixed();
        assert_eq!(monitor_at(&m, (10, 10)), Some(0));
        assert_eq!(monitor_at(&m, (1919, 500)), Some(0));
        assert_eq!(monitor_at(&m, (1920, 500)), Some(1));
        assert_eq!(monitor_at(&m, (2000, -150)), Some(1));
        // Above the left monitor and 20 pixels left of the taller right one: the right one is nearer.
        assert_eq!(monitor_at(&m, (1900, -150)), Some(1), "nearest monitor");
        assert_eq!(monitor_at(&m, (500, -150)), Some(0));
        assert_eq!(monitor_at(&[], (0, 0)), None);
    }

    #[test]
    fn only_the_visible_part_of_a_window_is_kept() {
        let m = mixed();
        // A window hanging off the top-left of the first monitor.
        assert_eq!(
            visible_part(Rect::new(-8, -8, 500, 400), &m),
            Some(Rect::new(0, 0, 492, 392))
        );
        // A window across the seam of both monitors.
        assert_eq!(
            visible_part(Rect::new(1800, 100, 400, 300), &m),
            Some(Rect::new(1800, 100, 400, 300))
        );
        assert_eq!(visible_part(Rect::new(9000, 0, 10, 10), &m), None);
    }

    #[test]
    fn a_rectangle_across_two_monitors_is_stitched() {
        let left = frame(4, 2, [255, 0, 0, 255]);
        let right = frame(4, 2, [0, 0, 255, 255]);
        let screens = [
            (Rect::new(0, 0, 4, 2), &left),
            (Rect::new(4, 0, 4, 2), &right),
        ];
        let out = compose(&screens, Rect::new(2, 0, 4, 2)).unwrap();
        assert_eq!((out.width, out.height), (4, 2));
        let px = |x: usize, y: usize| out.rgba[(y * 4 + x) * 4..(y * 4 + x) * 4 + 4].to_vec();
        assert_eq!(px(0, 0), vec![255, 0, 0, 255]);
        assert_eq!(px(1, 1), vec![255, 0, 0, 255]);
        assert_eq!(px(2, 0), vec![0, 0, 255, 255]);
        assert_eq!(px(3, 1), vec![0, 0, 255, 255]);
    }

    #[test]
    fn uncovered_pixels_are_transparent_and_a_miss_is_none() {
        let f = frame(2, 2, [9, 9, 9, 255]);
        let out = compose(&[(Rect::new(0, 0, 2, 2), &f)], Rect::new(1, 1, 3, 3)).unwrap();
        assert_eq!(&out.rgba[0..4], &[9, 9, 9, 255]);
        assert_eq!(&out.rgba[4..8], &[0, 0, 0, 0]);
        assert!(compose(&[(Rect::new(0, 0, 2, 2), &f)], Rect::new(10, 10, 2, 2)).is_none());
    }

    #[test]
    fn a_monitor_at_a_negative_origin_crops_correctly() {
        let mut f = frame(3, 3, [0, 0, 0, 255]);
        // Mark the pixel at (1, 2) of the screenshot.
        f.rgba[(2 * 3 + 1) * 4..(2 * 3 + 1) * 4 + 4].copy_from_slice(&[1, 2, 3, 255]);
        let out = compose(&[(Rect::new(-3, -3, 3, 3), &f)], Rect::new(-2, -1, 1, 1)).unwrap();
        assert_eq!(out.rgba, vec![1, 2, 3, 255]);
    }

    #[test]
    fn the_toast_sits_in_the_corner_of_the_work_area() {
        let work = Rect::new(0, 0, 1920, 1040);
        assert_eq!(toast_position(work, (340, 96), 16), (1564, 928));
        // A work area smaller than the toast: never off the top-left.
        assert_eq!(
            toast_position(Rect::new(10, 10, 100, 50), (340, 96), 16),
            (10, 10)
        );
    }

    #[test]
    fn the_countdown_badge_stays_next_to_the_pointer_on_its_monitor() {
        let m = mixed();
        assert_eq!(badge_position((100, 100), 96, &m, 24), (124, 124));
        // Near the right edge of the left monitor: flips to the left of the pointer.
        assert_eq!(badge_position((1900, 100), 96, &m, 24), (1780, 124));
        // Near the bottom: flips above.
        assert_eq!(badge_position((100, 1070), 96, &m, 24), (124, 950));
        // On the second monitor with its negative top edge.
        assert_eq!(badge_position((2000, -190), 96, &m, 24), (2024, -166));
    }
}
