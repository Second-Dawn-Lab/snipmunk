//! The cursor track of a recording: the screen is recorded WITHOUT the cursor, and where the cursor was is written to a file next
//! to the video (`cursor.jsonl`), so it can be drawn (and later styled) when the recording is played or rendered.
//!
//! The file is one JSON object per line, appended as the recording goes (a crash loses at most the last second):
//!
//! ```text
//! {"type":"header","version":1,"width":1920,"height":1080,"fps":30}
//! {"t":0,"shape":"s1","hx":3,"hy":3,"w":32,"h":32,"file":"cursors/s1.png"}   a cursor image (made the first time it is seen)
//! {"t":0,"x":812,"y":440,"v":1,"s":"s1"}                                      a position (recording pixels, ms of recorded time)
//! {"t":240,"b":"l","d":1}                                                     the left (l) or right (r) button down (1) / up (0)
//! ```
//!
//! `t` counts recorded milliseconds: a pause does not count, so the track stays in step with the video. Positions are in the
//! pixels of the recording (the origin is the top left of the recorded area). `v` is 0 while the cursor is hidden or outside the
//! recorded area. `s` names the cursor image, and is written when the shape changes.
//!
//! The track only watches: the position and the buttons are read (never hooked), so no input is delayed or swallowed.
//! `Sampler` has the logic and no Windows code, so it is tested with generated movements; `poller` (Windows) reads the real
//! cursor and runs only for a real recording.

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;

/// What the cursor did at one moment, as read from the system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    /// Screen position of the cursor (the hot spot).
    pub x: i32,
    pub y: i32,
    pub visible: bool,
    /// The cursor image in use (an id; the image itself is known to the `Appender` of the track).
    pub shape: String,
    pub left: bool,
    pub right: bool,
}

/// The size of the recorded area and where its origin is on the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// A cursor image: its id, the hot spot, the size and the PNG file (relative to the recording folder).
pub struct Shape {
    pub id: String,
    pub hx: i32,
    pub hy: i32,
    pub w: u32,
    pub h: u32,
    pub file: String,
}

/// A line of the track, as a JSON text.
pub type Line = String;

/// Turns readings into lines: a position is written when it changed (and at least every `keepalive_ms`, so a long still period
/// has samples too), a shape when it changed, a button when it went down or up. Time is recorded time: the pauses are left out.
pub struct Sampler {
    area: Area,
    last: Option<(i32, i32, bool)>,
    last_shape: Option<String>,
    left: bool,
    right: bool,
    last_written_ms: u64,
    keepalive_ms: u64,
    paused_since: Option<u64>,
    paused_total: u64,
    pub samples: u64,
}

fn text(v: serde_json::Value) -> Line {
    v.to_string()
}

impl Sampler {
    pub fn new(area: Area, keepalive_ms: u64) -> Self {
        Self {
            area,
            last: None,
            last_shape: None,
            left: false,
            right: false,
            last_written_ms: 0,
            keepalive_ms,
            paused_since: None,
            paused_total: 0,
            samples: 0,
        }
    }

    pub fn header(&self, fps: u32) -> Line {
        text(serde_json::json!({
            "type": "header", "version": 1, "width": self.area.w, "height": self.area.h, "fps": fps
        }))
    }

    /// `now_ms` is a clock that runs also while paused (a monotonic time since the start); the pause is cut out of it here.
    pub fn pause(&mut self, now_ms: u64) {
        self.paused_since.get_or_insert(now_ms);
    }

    pub fn resume(&mut self, now_ms: u64) {
        if let Some(since) = self.paused_since.take() {
            self.paused_total += now_ms.saturating_sub(since);
        }
    }

    pub fn recorded_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.paused_total)
    }

    /// Handle one reading; the lines to append (none while paused or when nothing changed).
    pub fn feed(&mut self, now_ms: u64, r: &Reading) -> Vec<Line> {
        if self.paused_since.is_some() {
            return Vec::new();
        }
        let t = self.recorded_ms(now_ms);
        let mut out = Vec::new();
        let (px, py) = (r.x - self.area.x, r.y - self.area.y);
        let inside = px >= 0 && py >= 0 && (px as u32) < self.area.w && (py as u32) < self.area.h;
        let visible = r.visible && inside;
        let shape_changed = self.last_shape.as_deref() != Some(r.shape.as_str());
        let moved = self.last != Some((px, py, visible));
        let due = t.saturating_sub(self.last_written_ms) >= self.keepalive_ms;
        if moved || shape_changed || due {
            let mut v = serde_json::json!({ "t": t, "x": px, "y": py, "v": u8::from(visible) });
            if shape_changed {
                v["s"] = serde_json::Value::String(r.shape.clone());
                self.last_shape = Some(r.shape.clone());
            }
            out.push(text(v));
            self.last = Some((px, py, visible));
            self.last_written_ms = t;
            self.samples += 1;
        }
        for (name, now, was) in [
            ("l", r.left, &mut self.left),
            ("r", r.right, &mut self.right),
        ] {
            if now != *was {
                out.push(text(
                    serde_json::json!({ "t": t, "b": name, "d": u8::from(now) }),
                ));
                *was = now;
            }
        }
        out
    }
}

/// The file of the track, appended line by line and flushed about once a second.
pub struct Appender {
    out: BufWriter<File>,
    lines_since_flush: u32,
    known_shapes: std::collections::HashSet<String>,
}

impl Appender {
    pub fn create(path: &Path, header: &str) -> io::Result<Self> {
        let mut out = BufWriter::new(File::create(path)?);
        writeln!(out, "{header}")?;
        out.flush()?;
        Ok(Self {
            out,
            lines_since_flush: 0,
            known_shapes: Default::default(),
        })
    }

    pub fn knows(&self, shape: &str) -> bool {
        self.known_shapes.contains(shape)
    }

    /// A cursor image (`file` is relative to the recording folder; the PNG is written by the caller).
    pub fn define_shape(&mut self, t_ms: u64, shape: &Shape) -> io::Result<()> {
        self.known_shapes.insert(shape.id.clone());
        let line = text(serde_json::json!({
            "t": t_ms, "shape": shape.id, "hx": shape.hx, "hy": shape.hy, "w": shape.w, "h": shape.h, "file": shape.file
        }));
        self.line(&line)
    }

    pub fn line(&mut self, line: &str) -> io::Result<()> {
        writeln!(self.out, "{line}")?;
        self.lines_since_flush += 1;
        // About once a second at 120 readings a second: a crash loses at most the last second of the track.
        if self.lines_since_flush >= 100 {
            self.out.flush()?;
            self.lines_since_flush = 0;
        }
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<()> {
        self.out.flush()?;
        self.out.get_ref().sync_all()
    }
}

/// A track read back.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Track {
    pub width: u32,
    pub height: u32,
    /// (ms, x, y, visible, shape)
    pub points: Vec<(u64, i32, i32, bool, Option<String>)>,
    /// (ms, "l"|"r", down)
    pub buttons: Vec<(u64, String, bool)>,
    /// (shape id, hotspot x, hotspot y, w, h, file)
    pub shapes: Vec<(String, i32, i32, u32, u32, String)>,
}

/// Read a track (lines that cannot be read, such as the last one of a crash, are skipped).
pub fn read(path: &Path) -> io::Result<Track> {
    let text = std::fs::read_to_string(path)?;
    let mut t = Track::default();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v["type"] == "header" {
            t.width = v["width"].as_u64().unwrap_or(0) as u32;
            t.height = v["height"].as_u64().unwrap_or(0) as u32;
        } else if let Some(id) = v["shape"].as_str() {
            t.shapes.push((
                id.to_string(),
                v["hx"].as_i64().unwrap_or(0) as i32,
                v["hy"].as_i64().unwrap_or(0) as i32,
                v["w"].as_u64().unwrap_or(0) as u32,
                v["h"].as_u64().unwrap_or(0) as u32,
                v["file"].as_str().unwrap_or("").to_string(),
            ));
        } else if let Some(b) = v["b"].as_str() {
            t.buttons
                .push((v["t"].as_u64().unwrap_or(0), b.to_string(), v["d"] == 1));
        } else if v["x"].is_i64() {
            t.points.push((
                v["t"].as_u64().unwrap_or(0),
                v["x"].as_i64().unwrap_or(0) as i32,
                v["y"].as_i64().unwrap_or(0) as i32,
                v["v"] == 1,
                v["s"].as_str().map(str::to_string),
            ));
        }
    }
    Ok(t)
}

#[cfg(windows)]
pub mod poller {
    //! Reads the real cursor (position, shape, buttons) about 120 times a second. For the development source `__synthetic__` a
    //! generated movement is used instead, so the tests never watch the real mouse.

    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetObjectW, SelectObject,
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, ICONINFO,
    };

    use super::{Appender, Area, Reading, Sampler};

    struct Inner {
        sampler: Sampler,
        appender: Option<Appender>,
        started: Instant,
        /// The clock of the recording has started (its first picture arrived); nothing is read before.
        begun: bool,
    }

    pub struct Cursor {
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
        inner: Arc<Mutex<Inner>>,
        path: PathBuf,
    }

    impl Cursor {
        /// The first picture arrived: the time of the track starts now.
        pub fn begin(&self) {
            let mut i = self.inner.lock().unwrap();
            i.started = Instant::now();
            i.begun = true;
        }

        pub fn pause(&self) {
            let mut i = self.inner.lock().unwrap();
            let now = i.started.elapsed().as_millis() as u64;
            i.sampler.pause(now);
        }

        pub fn resume(&self) {
            let mut i = self.inner.lock().unwrap();
            let now = i.started.elapsed().as_millis() as u64;
            i.sampler.resume(now);
        }

        /// Stop watching and close the file; its path.
        pub fn finish(mut self) -> Option<PathBuf> {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            let appender = self.inner.lock().unwrap().appender.take()?;
            appender.finish().ok()?;
            Some(self.path.clone())
        }
    }

    /// Start the track in `dir` (`cursor.jsonl`, images in `cursors/`). With `synthetic` a generated movement is written.
    pub fn start(dir: &Path, area: Area, fps: u32, synthetic: bool) -> std::io::Result<Cursor> {
        let path = dir.join("cursor.jsonl");
        let sampler = Sampler::new(area, 500);
        let appender = Appender::create(&path, &sampler.header(fps))?;
        let inner = Arc::new(Mutex::new(Inner {
            sampler,
            appender: Some(appender),
            started: Instant::now(),
            begun: false,
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let (i2, s2, d2) = (inner.clone(), stop.clone(), dir.to_path_buf());
        let thread = std::thread::spawn(move || {
            while !s2.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(8));
                let mut i = i2.lock().unwrap();
                if !i.begun {
                    continue;
                }
                let now = i.started.elapsed().as_millis() as u64;
                let reading = if synthetic {
                    generated(now, area)
                } else {
                    match read_cursor() {
                        Some(r) => r,
                        None => continue,
                    }
                };
                let Inner {
                    sampler, appender, ..
                } = &mut *i;
                let Some(appender) = appender.as_mut() else {
                    break;
                };
                if !appender.knows(&reading.shape) {
                    let image = if synthetic {
                        Some(generated_image(&reading.shape))
                    } else {
                        // SAFETY: the handle comes from GetCursorInfo a moment ago.
                        unsafe { render(&reading.shape) }
                    };
                    if let Some((png, hx, hy, w, h)) = image {
                        let file = format!("cursors/{}.png", reading.shape);
                        let _ = std::fs::create_dir_all(d2.join("cursors"));
                        if std::fs::write(d2.join(&file), png).is_ok() {
                            let t = sampler.recorded_ms(now);
                            let shape = super::Shape {
                                id: reading.shape.clone(),
                                hx,
                                hy,
                                w,
                                h,
                                file,
                            };
                            let _ = appender.define_shape(t, &shape);
                        }
                    }
                }
                for l in sampler.feed(now, &reading) {
                    let _ = appender.line(&l);
                }
            }
        });
        Ok(Cursor {
            stop,
            thread: Some(thread),
            inner,
            path,
        })
    }

    /// The generated cursor: a circle in the area, a left button pressed for half a second every 3 s, the shape changing at 5 s.
    fn generated(now_ms: u64, area: Area) -> Reading {
        let a = now_ms as f64 / 1000.0;
        Reading {
            x: area.x + area.w as i32 / 2 + (a.cos() * area.w as f64 / 4.0) as i32,
            y: area.y + area.h as i32 / 2 + (a.sin() * area.h as f64 / 4.0) as i32,
            visible: true,
            shape: if now_ms < 5000 { "arrow" } else { "ibeam" }.to_string(),
            left: now_ms % 3000 < 500 && now_ms >= 1000,
            right: false,
        }
    }

    /// A small arrow (or text beam) picture for the generated cursor: (PNG, hot spot x, y, width, height).
    fn generated_image(shape: &str) -> (Vec<u8>, i32, i32, u32, u32) {
        let (w, h) = (24u32, 24u32);
        let mut img = image::RgbaImage::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let on = if shape == "ibeam" {
                    ((x == 11 || x == 12) && (2..22).contains(&y))
                        || ((y == 2 || y == 21) && (7..17).contains(&x))
                } else {
                    x <= y * 2 / 3 + 1 && y < 20 && x < 14
                };
                if on {
                    img.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
                }
            }
        }
        let mut png = Vec::new();
        let _ = img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png);
        let hot = if shape == "ibeam" { 12 } else { 0 };
        (png, hot, hot, w, h)
    }

    fn read_cursor() -> Option<Reading> {
        let mut info = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        // SAFETY: `info` has its size set, as GetCursorInfo requires.
        unsafe { GetCursorInfo(&mut info).ok()? };
        let POINT { x, y } = info.ptScreenPos;
        // SAFETY: GetAsyncKeyState has no preconditions; it reads the state, it never changes or delays any input.
        let (left, right) = unsafe {
            (
                GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0,
                GetAsyncKeyState(VK_RBUTTON.0 as i32) as u16 & 0x8000 != 0,
            )
        };
        Some(Reading {
            x,
            y,
            visible: info.flags.0 & CURSOR_SHOWING.0 != 0,
            shape: format!("c{:x}", info.hCursor.0 as usize),
            left,
            right,
        })
    }

    /// The picture of the cursor in use (its handle is in the id): PNG, hot spot, size. `None` when it cannot be drawn.
    ///
    /// # Safety
    /// The handle in `shape` must be a cursor handle that was read from the system just now.
    unsafe fn render(shape: &str) -> Option<(Vec<u8>, i32, i32, u32, u32)> {
        use windows::Win32::UI::WindowsAndMessaging::HCURSOR;
        let handle = usize::from_str_radix(shape.strip_prefix('c')?, 16).ok()?;
        let hcur = HCURSOR(handle as *mut _);
        let mut ii = ICONINFO::default();
        GetIconInfo(hcur.into(), &mut ii).ok()?;
        let has_color = !ii.hbmColor.is_invalid();
        let bitmap = if has_color { ii.hbmColor } else { ii.hbmMask };
        let mut bm = BITMAP::default();
        GetObjectW(
            HGDIOBJ(bitmap.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        );
        let (w, h) = (
            bm.bmWidth,
            if has_color {
                bm.bmHeight
            } else {
                bm.bmHeight / 2
            },
        );
        let (hx, hy) = (ii.xHotspot as i32, ii.yHotspot as i32);
        if has_color {
            let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
        }
        let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        if w <= 0 || h <= 0 || w > 256 || h > 256 {
            return None;
        }
        let dc = CreateCompatibleDC(None);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let dib = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
        let old = SelectObject(dc, HGDIOBJ(dib.0));
        let _ = DrawIconEx(dc, 0, 0, hcur.into(), w, h, 0, None, DI_NORMAL);
        let mut px = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize).to_vec();
        SelectObject(dc, old);
        let _ = DeleteObject(HGDIOBJ(dib.0));
        let _ = DeleteDC(dc);
        // BGRA to RGBA. A cursor of the old kind has no alpha: whatever was drawn is then opaque.
        let (pixels, _) = px.as_chunks_mut::<4>();
        let any_alpha = pixels.iter().any(|p| p[3] != 0);
        for p in pixels.iter_mut() {
            p.swap(0, 2);
            if !any_alpha && (p[0] | p[1] | p[2]) != 0 {
                p[3] = 255;
            }
        }
        let img = image::RgbaImage::from_raw(w as u32, h as u32, px)?;
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .ok()?;
        Some((png, hx, hy, w as u32, h as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(x: i32, y: i32) -> Reading {
        Reading {
            x,
            y,
            visible: true,
            shape: "arrow".into(),
            left: false,
            right: false,
        }
    }

    const AREA: Area = Area {
        x: 100,
        y: 50,
        w: 640,
        h: 360,
    };

    #[test]
    fn positions_are_in_recording_pixels_and_only_changes_are_written() {
        let mut s = Sampler::new(AREA, 500);
        let a = s.feed(0, &reading(110, 60));
        assert_eq!(a.len(), 1);
        assert!(
            a[0].contains("\"x\":10")
                && a[0].contains("\"y\":10")
                && a[0].contains("\"s\":\"arrow\"")
        );
        // Nothing moved: nothing is written (until the keep-alive).
        assert!(s.feed(8, &reading(110, 60)).is_empty());
        assert!(s.feed(300, &reading(110, 60)).is_empty());
        assert_eq!(s.feed(520, &reading(110, 60)).len(), 1);
        // A move, with the shape staying the same: no shape field.
        let m = s.feed(530, &reading(111, 60));
        assert_eq!(m.len(), 1);
        assert!(!m[0].contains("\"s\""));
    }

    #[test]
    fn a_cursor_outside_the_area_or_hidden_is_not_visible_and_shape_changes_are_written() {
        let mut s = Sampler::new(AREA, 500);
        s.feed(0, &reading(110, 60));
        let out = s.feed(10, &reading(50, 60));
        assert!(out[0].contains("\"v\":0"));
        let mut hidden = reading(120, 70);
        hidden.visible = false;
        assert!(s.feed(20, &hidden)[0].contains("\"v\":0"));
        let mut ibeam = reading(120, 70);
        ibeam.shape = "ibeam".into();
        let out = s.feed(30, &ibeam);
        assert!(out[0].contains("\"s\":\"ibeam\"") && out[0].contains("\"v\":1"));
    }

    #[test]
    fn buttons_are_written_when_they_go_down_and_up() {
        let mut s = Sampler::new(AREA, 500);
        s.feed(0, &reading(110, 60));
        let mut r = reading(110, 60);
        r.left = true;
        let down = s.feed(100, &r);
        assert_eq!(down.len(), 1);
        assert!(down[0].contains("\"b\":\"l\"") && down[0].contains("\"d\":1"));
        r.left = false;
        r.right = true;
        let both = s.feed(200, &r);
        assert_eq!(both.len(), 2);
        assert!(both[0].contains("\"d\":0") && both[1].contains("\"b\":\"r\""));
    }

    #[test]
    fn a_pause_is_cut_out_of_the_time_and_nothing_is_written_during_it() {
        let mut s = Sampler::new(AREA, 500);
        s.feed(0, &reading(110, 60));
        s.pause(1000);
        assert!(s.feed(1500, &reading(200, 100)).is_empty());
        s.resume(4000);
        // 3 s were paused: the clock of the track continues at 1000.
        let out = s.feed(4010, &reading(210, 100));
        assert!(out[0].contains("\"t\":1010"), "{}", out[0]);
    }

    #[test]
    fn a_generated_movement_at_120_readings_a_second_makes_a_track_that_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cursor.jsonl");
        let mut s = Sampler::new(AREA, 500);
        let mut a = Appender::create(&path, &s.header(30)).unwrap();
        a.define_shape(
            0,
            &Shape {
                id: "arrow".into(),
                hx: 3,
                hy: 3,
                w: 32,
                h: 32,
                file: "cursors/arrow.png".into(),
            },
        )
        .unwrap();
        for i in 0..1200u64 {
            let ms = i * 1000 / 120;
            let ang = ms as f64 / 1000.0;
            let mut r = reading(
                100 + 320 + (ang.cos() * 200.0) as i32,
                50 + 180 + (ang.sin() * 100.0) as i32,
            );
            r.left = (2000..2500).contains(&ms);
            for l in s.feed(ms, &r) {
                a.line(&l).unwrap();
            }
        }
        a.finish().unwrap();
        let t = read(&path).unwrap();
        assert_eq!((t.width, t.height), (640, 360));
        assert_eq!(t.shapes.len(), 1);
        assert_eq!(t.buttons.len(), 2);
        // The movement is sampled at least at the frame rate of the video (30 a second): 10 s gave far more than 300 points.
        assert!(t.points.len() > 300, "{}", t.points.len());
        assert!(t.points.windows(2).all(|w| w[0].0 <= w[1].0));
        // A line that a crash cut off is skipped.
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"t\":99999,\"x\":1,");
        std::fs::write(&path, text).unwrap();
        assert_eq!(read(&path).unwrap().points.len(), t.points.len());
    }
}
