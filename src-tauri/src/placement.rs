//! Remembers the main window's size and position between runs.
//!
//! Everything is in physical pixels, the unit of window and monitor rectangles on Windows. The saved rectangle is
//! checked against the monitors that exist now (a monitor may have been unplugged, a resolution changed), so the
//! window never comes back off-screen or smaller than its minimum size. The decision is a pure function and unit
//! tested; the window calls around it are thin.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// The smallest logical window size (also set in tauri.conf.json).
pub const MIN_LOGICAL: (f64, f64) = (640.0, 560.0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub maximized: bool,
}

/// A monitor: its rectangle and DPI scale (1.0 = 96 dpi).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Monitor {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub scale: f64,
}

fn overlap(b: &Bounds, m: &Monitor) -> i64 {
    let w = (b.x + b.w).min(m.x + m.w) - b.x.max(m.x);
    let h = (b.y + b.h).min(m.y + m.h) - b.y.max(m.y);
    if w <= 0 || h <= 0 {
        0
    } else {
        i64::from(w) * i64::from(h)
    }
}

/// Where the window goes, given what was saved and the monitors now. `None` means "no usable saved place":
/// the caller keeps the default (centered) placement.
pub fn fit(saved: Bounds, monitors: &[Monitor]) -> Option<Bounds> {
    if saved.w <= 0 || saved.h <= 0 {
        return None;
    }
    // The monitor the window mostly was on; it must still show a real part of the window.
    let monitor = monitors
        .iter()
        .max_by_key(|m| overlap(&saved, m))
        .filter(|m| overlap(&saved, m) >= 120 * 80)?;
    let min_w = (MIN_LOGICAL.0 * monitor.scale).round() as i32;
    let min_h = (MIN_LOGICAL.1 * monitor.scale).round() as i32;
    let w = saved.w.max(min_w).min(monitor.w.max(min_w));
    let h = saved.h.max(min_h).min(monitor.h.max(min_h));
    let x = saved
        .x
        .clamp(monitor.x, (monitor.x + monitor.w - w).max(monitor.x));
    let y = saved
        .y
        .clamp(monitor.y, (monitor.y + monitor.h - h).max(monitor.y));
    Some(Bounds {
        x,
        y,
        w,
        h,
        maximized: saved.maximized,
    })
}

fn path() -> PathBuf {
    crate::store::app_dir().join("window.json")
}

fn monitors(window: &WebviewWindow) -> Vec<Monitor> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Monitor {
            x: m.position().x,
            y: m.position().y,
            w: m.size().width as i32,
            h: m.size().height as i32,
            scale: m.scale_factor(),
        })
        .collect()
}

/// Put the window where it was last time (call before showing it). Without a usable saved place nothing changes.
pub fn restore(window: &WebviewWindow) {
    let saved: Bounds = dawn_core::read_json(&path());
    let Some(b) = fit(saved, &monitors(window)) else {
        return;
    };
    // Move first, so the window is on its monitor (and its DPI) when it is resized, then move again.
    let _ = window.set_position(PhysicalPosition::new(b.x, b.y));
    let _ = window.set_size(PhysicalSize::new(b.w as u32, b.h as u32));
    let _ = window.set_position(PhysicalPosition::new(b.x, b.y));
    if b.maximized {
        let _ = window.maximize();
    }
}

/// Is the window where a person can see it? A window with (almost) no part on any monitor (an unplugged monitor, the
/// -32000 place of a minimized window) is not.
pub fn is_on_screen(rect: Bounds, monitors: &[Monitor]) -> bool {
    monitors.iter().any(|m| overlap(&rect, m) >= 120 * 80)
}

/// Bring a window that is off every monitor back to the middle of one. Returns whether it had to move.
pub fn ensure_on_screen(window: &WebviewWindow) -> bool {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let rect = Bounds {
        x: pos.x,
        y: pos.y,
        w: size.width as i32,
        h: size.height as i32,
        maximized: false,
    };
    if is_on_screen(rect, &monitors(window)) {
        return false;
    }
    window.center().is_ok()
}

struct Tracker {
    latest: Option<Bounds>,
    last_write: Option<Instant>,
    dirty: bool,
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker {
    latest: None,
    last_write: None,
    dirty: false,
});

/// Note the window's current place (call on every move or resize). Written at most once a second; `flush` writes
/// the rest.
pub fn track(window: &WebviewWindow) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let mut t = TRACKER.lock().unwrap();
    if maximized {
        // Keep the normal-size rectangle from before; only remember that the window is maximized.
        if let Some(b) = t.latest.as_mut() {
            b.maximized = true;
        } else {
            t.latest = Some(Bounds {
                maximized: true,
                ..dawn_core::read_json(&path())
            });
        }
    } else if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        t.latest = Some(Bounds {
            x: pos.x,
            y: pos.y,
            w: size.width as i32,
            h: size.height as i32,
            maximized: false,
        });
    } else {
        return;
    }
    t.dirty = true;
    if t.last_write
        .is_none_or(|w| w.elapsed() > Duration::from_secs(1))
    {
        write(&mut t);
    }
}

fn write(t: &mut Tracker) {
    if let Some(b) = t.latest.filter(|_| t.dirty) {
        let _ = dawn_core::write_json(&path(), &b);
        t.last_write = Some(Instant::now());
        t.dirty = false;
    }
}

/// Write the last noted place now (the window is hiding or the app is quitting).
pub fn flush() {
    write(&mut TRACKER.lock().unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: i32, y: i32, w: i32, h: i32, scale: f64) -> Monitor {
        Monitor { x, y, w, h, scale }
    }
    fn b(x: i32, y: i32, w: i32, h: i32) -> Bounds {
        Bounds {
            x,
            y,
            w,
            h,
            maximized: false,
        }
    }

    #[test]
    fn a_window_that_still_fits_is_restored_exactly() {
        let m = [mon(0, 0, 1920, 1080, 1.0)];
        assert_eq!(fit(b(100, 80, 1000, 700), &m), Some(b(100, 80, 1000, 700)));
    }

    #[test]
    fn nothing_saved_means_the_default_placement() {
        let m = [mon(0, 0, 1920, 1080, 1.0)];
        assert_eq!(fit(Bounds::default(), &m), None);
        assert_eq!(fit(b(0, 0, 0, 500), &m), None);
        assert_eq!(fit(b(0, 0, 800, 600), &[]), None);
    }

    #[test]
    fn a_window_on_an_unplugged_monitor_is_not_restored() {
        let m = [mon(0, 0, 1920, 1080, 1.0)];
        assert_eq!(
            fit(b(2500, 100, 900, 700), &m),
            None,
            "it was on a monitor right of this one"
        );
        assert_eq!(fit(b(-1900, 100, 900, 700), &m), None);
    }

    #[test]
    fn a_window_hanging_off_the_screen_is_pulled_back() {
        let m = [mon(0, 0, 1920, 1080, 1.0)];
        assert_eq!(
            fit(b(1500, 700, 900, 700), &m),
            Some(b(1020, 380, 900, 700))
        );
        assert_eq!(fit(b(-300, -100, 900, 700), &m), Some(b(0, 0, 900, 700)));
    }

    #[test]
    fn the_minimum_size_is_enforced_at_the_monitors_scale() {
        let m = [mon(0, 0, 1920, 1080, 1.0)];
        let r = fit(b(10, 10, 300, 200), &m).unwrap();
        assert_eq!((r.w, r.h), (640, 560));
        let hidpi = [mon(0, 0, 3840, 2160, 2.0)];
        let r = fit(b(10, 10, 700, 600), &hidpi).unwrap();
        assert_eq!((r.w, r.h), (1280, 1120));
    }

    #[test]
    fn a_window_larger_than_the_monitor_is_shrunk() {
        let m = [mon(0, 0, 1366, 768, 1.0)];
        let r = fit(b(0, 0, 2000, 1200), &m).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (0, 0, 1366, 768));
    }

    #[test]
    fn the_monitor_with_most_of_the_window_wins() {
        let left = mon(-1920, 0, 1920, 1080, 1.0);
        let main = mon(0, 0, 2560, 1440, 1.5);
        let r = fit(b(-1000, 100, 900, 700), &[main, left]).unwrap();
        assert_eq!((r.x, r.y), (-1000, 100));
        // Straddling the seam, mostly on the main monitor.
        let r = fit(b(-200, 100, 900, 700), &[left, main]).unwrap();
        assert_eq!(r.x, 0);
    }

    #[test]
    fn maximized_is_kept() {
        let m = [mon(0, 0, 1920, 1080, 1.0)];
        let saved = Bounds {
            maximized: true,
            ..b(100, 80, 1000, 700)
        };
        assert!(fit(saved, &m).unwrap().maximized);
    }

    #[test]
    fn old_or_partial_files_load() {
        let v: Bounds = serde_json::from_str(r#"{"x":5,"y":6}"#).unwrap();
        assert_eq!((v.x, v.y, v.w, v.maximized), (5, 6, 0, false));
    }

    #[test]
    fn a_window_off_every_monitor_is_not_on_screen() {
        let m = [mon(0, 0, 1920, 1080, 1.0), mon(1920, 0, 1920, 1080, 1.0)];
        assert!(is_on_screen(b(100, 100, 900, 700), &m));
        assert!(is_on_screen(b(1800, 100, 900, 700), &m), "across the seam");
        assert!(!is_on_screen(b(-32000, -32000, 900, 700), &m), "minimized");
        assert!(
            !is_on_screen(b(4000, 100, 900, 700), &m),
            "unplugged monitor"
        );
        assert!(!is_on_screen(b(1910, 1075, 900, 700), &m), "a corner only");
        assert!(!is_on_screen(b(0, 0, 900, 700), &[]));
    }
}
