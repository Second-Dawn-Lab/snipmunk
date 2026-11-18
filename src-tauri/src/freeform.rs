//! The freeform (lasso) capture: the bounding box of the drawn path, with everything outside the path transparent.
//! Pure, so the mask is unit tested. Points are in physical pixels of the same space as the rectangle.

#![allow(clippy::chunks_exact_to_as_chunks)] // plain chunks over pixel data read better than as_chunks

use dawn_capture::Frame;

use crate::geometry::Rect;

/// The smallest rectangle (whole pixels) that holds all points. `None` for fewer than 3 points or a flat path.
pub fn bounding_box(points: &[(f64, f64)]) -> Option<Rect> {
    if points.len() < 3 {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for &(x, y) in points {
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    let (x0, y0, x1, y1) = (
        x0.floor() as i32,
        y0.floor() as i32,
        x1.ceil() as i32,
        y1.ceil() as i32,
    );
    let (w, h) = ((x1 - x0).max(0) as u32, (y1 - y0).max(0) as u32);
    (w >= 1 && h >= 1).then(|| Rect::new(x0, y0, w, h))
}

/// 255 for pixels of `area` inside the closed path (even-odd rule, a pixel counts when its center is inside), 0 outside.
/// One byte per pixel, rows top to bottom.
pub fn mask(points: &[(f64, f64)], area: Rect) -> Vec<u8> {
    let (w, h) = (area.w as usize, area.h as usize);
    let mut out = vec![0u8; w * h];
    if points.len() < 3 {
        return out;
    }
    let local: Vec<(f64, f64)> = points
        .iter()
        .map(|&(x, y)| (x - area.x as f64, y - area.y as f64))
        .collect();
    let mut crossings: Vec<f64> = Vec::new();
    for row in 0..h {
        let yc = row as f64 + 0.5;
        crossings.clear();
        for i in 0..local.len() {
            let (ax, ay) = local[i];
            let (bx, by) = local[(i + 1) % local.len()];
            // The edge crosses this row when the center line is between its ends (half-open, so a vertex counts once).
            if (ay <= yc && by > yc) || (by <= yc && ay > yc) {
                crossings.push(ax + (yc - ay) / (by - ay) * (bx - ax));
            }
        }
        crossings.sort_by(|a, b| a.total_cmp(b));
        for pair in crossings.chunks_exact(2) {
            // Pixels whose centers (x + 0.5) lie between the two crossings.
            let from = (pair[0] - 0.5).ceil().max(0.0) as usize;
            let to = ((pair[1] - 0.5).ceil().max(0.0) as usize).min(w);
            if from < to {
                out[row * w + from..row * w + to].fill(255);
            }
        }
    }
    out
}

/// Make everything outside the mask transparent.
pub fn apply(frame: &mut Frame, mask: &[u8]) {
    for (px, m) in frame.rgba.chunks_exact_mut(4).zip(mask) {
        px[3] = (px[3] as u16 * *m as u16 / 255) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inside(mask: &[u8], w: usize, x: usize, y: usize) -> bool {
        mask[y * w + x] == 255
    }

    #[test]
    fn the_bounding_box_rounds_outwards() {
        let pts = [(1.4, 2.6), (10.2, 3.0), (5.0, 9.1)];
        assert_eq!(bounding_box(&pts), Some(Rect::new(1, 2, 10, 8)));
        assert_eq!(
            bounding_box(&[(1.0, 1.0), (5.0, 5.0)]),
            None,
            "a line is not a shape"
        );
        assert_eq!(
            bounding_box(&[(1.0, 1.0), (5.0, 1.0), (9.0, 1.0)]),
            None,
            "a flat path has no area"
        );
    }

    #[test]
    fn a_square_path_fills_exactly_the_square() {
        let pts = [(2.0, 2.0), (6.0, 2.0), (6.0, 6.0), (2.0, 6.0)];
        let area = Rect::new(0, 0, 8, 8);
        let m = mask(&pts, area);
        for y in 0..8 {
            for x in 0..8 {
                let expect = (2..6).contains(&x) && (2..6).contains(&y);
                assert_eq!(inside(&m, 8, x, y), expect, "({x}, {y})");
            }
        }
    }

    #[test]
    fn a_triangle_is_narrower_at_the_top() {
        let pts = [(0.0, 0.0), (10.0, 0.0), (5.0, 10.0)];
        let area = bounding_box(&pts).unwrap();
        let m = mask(&pts, area);
        let row = |y: usize| {
            m[y * 10..(y + 1) * 10]
                .iter()
                .filter(|v| **v == 255)
                .count()
        };
        assert!(row(0) >= 9, "top row is almost full: {}", row(0));
        assert!(row(9) <= 2, "bottom row is a point: {}", row(9));
        assert!(row(2) > row(7));
        assert!(
            !inside(&m, 10, 0, 9),
            "the corner below the left edge is outside"
        );
    }

    #[test]
    fn the_path_may_start_anywhere_and_be_given_in_desktop_coordinates() {
        // The same square, 1000 pixels to the right and with a negative y; the area follows.
        let pts = [
            (1002.0, -8.0),
            (1006.0, -8.0),
            (1006.0, -4.0),
            (1002.0, -4.0),
        ];
        let area = bounding_box(&pts).unwrap();
        assert_eq!(area, Rect::new(1002, -8, 4, 4));
        assert!(mask(&pts, area).iter().all(|v| *v == 255));
    }

    #[test]
    fn a_figure_eight_uses_the_even_odd_rule() {
        // A bow tie: the crossing point splits it in two triangles, the middle row is thin.
        let pts = [(0.0, 0.0), (16.0, 16.0), (16.0, 0.0), (0.0, 16.0)];
        let m = mask(&pts, Rect::new(0, 0, 16, 16));
        assert!(inside(&m, 16, 1, 3), "left wing");
        assert!(!inside(&m, 16, 8, 3), "between the wings");
        assert!(inside(&m, 16, 14, 3), "right wing");
    }

    #[test]
    fn applying_the_mask_clears_the_alpha_outside() {
        let mut f = Frame {
            width: 2,
            height: 1,
            rgba: vec![10, 20, 30, 255, 40, 50, 60, 255],
        };
        apply(&mut f, &[255, 0]);
        assert_eq!(f.rgba, vec![10, 20, 30, 255, 40, 50, 60, 0]);
    }
}
