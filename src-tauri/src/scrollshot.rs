#![allow(clippy::chunks_exact_to_as_chunks)]
//! The scrolling screenshot: Snipmunk scrolls a window (or the part of it that was chosen) step by step, takes a picture after each
//! step and joins them into ONE tall image (`stitch.rs`), which then goes the way of every other capture.
//!
//! * **Scrolling.** The window's own UI Automation `ScrollPattern` is used when it has one (a page at a time, no mouse involved).
//!   Otherwise `WM_MOUSEWHEEL` is posted to the window under the middle of the area, and `WM_VSCROLL` (page down) when the wheel does
//!   nothing. Nothing is sent as keyboard or mouse input: the messages go to the window, the pointer stays where the user left it.
//! * **Settling.** After a step the area is grabbed again and again until two grabs are the same (smooth scrolling, lazy images).
//! * **The end.** When a step does not change the picture (or UI Automation says 100 %), the maximum height is reached, Esc is
//!   pressed or the Stop pill is clicked. The pill and Snipmunk's other windows are left out of the pictures.
//! * **The result.** One normal capture. Optionally the window is scrolled back to the top afterwards.
//!
//! The own test instance has a development-only scrollable test window (`dev_scroll_window`) and takes its pictures from that window
//! alone (`Source::Window`, `PrintWindow`), never from the screen.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::CmdResult;
use crate::geometry::Rect;
use crate::stitch::{Picture, Pushed, Stitcher};

/// The Stop pill was clicked.
static STOP: AtomicBool = AtomicBool::new(false);
/// A scrolling capture is running.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// The newest thumbnail (PNG) for the pill, and a counter that changes with it.
static THUMB: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static THUMB_N: AtomicU64 = AtomicU64::new(0);

/// The pill's picture (served at `snipmunk-cam://…/scroll`).
pub fn thumb_png() -> Option<Vec<u8>> {
    let t = THUMB.lock().unwrap_or_else(|e| e.into_inner());
    (!t.is_empty()).then(|| t.clone())
}

/// Where the pictures come from.
#[derive(Debug, Clone, Copy)]
pub enum Source {
    /// The screen area (physical pixels of the virtual desktop).
    Screen(Rect),
    /// One window of this program, with `PrintWindow` (development tests only: no screen pixels are read).
    Window(isize),
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Stop at this height (rows).
    pub max_height: usize,
    /// Scroll back to the top at the end.
    pub scroll_back: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// The end of the content.
    End,
    /// The maximum height.
    Max,
    /// Esc or the Stop pill.
    Stopped,
    /// Nothing could scroll the window.
    NoScroll,
}

pub struct Outcome {
    pub rgba: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub steps: usize,
    pub method: &'static str,
    pub reason: Reason,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub height: usize,
    pub n: u64,
}

/// What does the actual scrolling of a window (see `win`).
pub trait Scroller {
    /// Scroll down by about `notches` mouse wheel notches (a page for the UI Automation way). `false` when nothing was sent.
    fn down(&mut self, notches: u32) -> bool;
    /// Scroll back up by the same.
    fn up(&mut self, notches: u32);
    /// The position as a percentage when the scroller knows it (UI Automation).
    fn percent(&self) -> Option<f64>;
    fn to_top(&mut self);
    fn name(&self) -> &'static str;
    /// Try the next way of scrolling (the wheel, then the scroll bar message); `false` when there is none left.
    fn next_way(&mut self) -> bool;
}

/// A picture of the source, RGBA.
fn grab(src: &Source) -> Result<(Vec<u8>, usize, usize), String> {
    match *src {
        Source::Screen(area) => {
            let screens = dawn_capture::capture_all().map_err(|e| e.to_string())?;
            let rects: Vec<Rect> = screens
                .iter()
                .map(|s| Rect::new(s.x, s.y, s.width, s.height))
                .collect();
            let pairs: Vec<(Rect, &dawn_capture::Frame)> = rects
                .iter()
                .copied()
                .zip(screens.iter().map(|s| &s.frame))
                .collect();
            let f = crate::geometry::compose(&pairs, area).ok_or("the area is not on a screen")?;
            Ok((f.rgba, f.width as usize, f.height as usize))
        }
        Source::Window(hwnd) => win::print_window(hwnd),
    }
}

/// Grab until three grabs in a row are the same (the page has stopped moving and has finished painting), at most ~2 s.
fn grab_settled(src: &Source, min_wait: Duration) -> Result<(Vec<u8>, usize, usize), String> {
    std::thread::sleep(min_wait);
    let mut prev = grab(src)?;
    let mut equal = 0;
    for _ in 0..24 {
        std::thread::sleep(Duration::from_millis(70));
        let next = grab(src)?;
        if next.0 == prev.0 && next.1 == prev.1 && next.2 == prev.2 {
            equal += 1;
            if equal >= 2 {
                return Ok(next);
            }
        } else {
            equal = 0;
        }
        prev = next;
    }
    Ok(prev)
}

/// The whole run: scroll, grab, stitch. `progress` is told the height after every step; `stopped` is asked before every step.
pub fn run(
    src: &Source,
    scroller: &mut dyn Scroller,
    opts: Options,
    progress: &dyn Fn(&Stitcher),
    stopped: &dyn Fn() -> bool,
) -> Result<Outcome, String> {
    let (first, w, h) = grab_settled(src, Duration::from_millis(80))?;
    let mut st = Stitcher::new(&Picture {
        width: w,
        height: h,
        rgba: &first,
    });
    progress(&st);
    let mut last = first;
    let mut notches: u32 = 3;
    let mut steps = 0usize;
    let mut same_in_a_row = 0;
    let mut failures = 0;
    #[allow(unused_assignments)]
    let mut reason = Reason::End;
    let mut ways_without_change = 0;
    let started_percent = scroller.percent();
    let mut method = scroller.name();
    loop {
        if stopped() {
            reason = Reason::Stopped;
            break;
        }
        if st.height() >= opts.max_height {
            reason = Reason::Max;
            break;
        }
        let before = scroller.percent();
        if !scroller.down(notches) {
            if scroller.next_way() {
                method = scroller.name();
                continue;
            }
            reason = if steps == 0 {
                Reason::NoScroll
            } else {
                Reason::End
            };
            break;
        }
        let (pic, pw, ph) = grab_settled(src, Duration::from_millis(120))?;
        steps += 1;
        let moved_by_api = match (before, scroller.percent()) {
            (Some(a), Some(b)) => b > a + 1e-6,
            _ => true,
        };
        let pushed = st.push(
            &Picture {
                width: pw,
                height: ph,
                rgba: &pic,
            },
            None,
            moved_by_api && same_in_a_row == 0,
        );
        trace(&format!(
            "step {steps}: {pushed:?} notches {notches} way {}",
            scroller.name()
        ));
        match pushed {
            Pushed::Added(d) => {
                same_in_a_row = 0;
                failures = 0;
                ways_without_change = 0;
                last = pic;
                progress(&st);
                // Aim at about 60 % of the part between the sticky bands per step with the wheel (a page of the API is what it is).
                if scroller.name() != "uia" && d > 0 {
                    let target = (st.content_height() as f32 * 0.6).max(1.0);
                    let want = (notches as f32 * target / d as f32)
                        .round()
                        .clamp(1.0, 40.0);
                    notches = want as u32;
                }
                if scroller.percent().is_some_and(|p| p >= 99.99) {
                    reason = Reason::End;
                    break;
                }
            }
            Pushed::Same => {
                same_in_a_row += 1;
                if scroller.percent().is_some_and(|p| p >= 99.99) {
                    reason = Reason::End;
                    break;
                }
                if same_in_a_row >= 2 {
                    // Nothing moves: another way of scrolling, or the end.
                    if steps <= 2 && ways_without_change < 2 && scroller.next_way() {
                        ways_without_change += 1;
                        method = scroller.name();
                        same_in_a_row = 0;
                        continue;
                    }
                    reason = if steps <= same_in_a_row {
                        Reason::NoScroll
                    } else {
                        Reason::End
                    };
                    break;
                }
                notches = (notches * 2).min(40);
            }
            Pushed::NoOverlap => {
                if let Ok(dir) = std::env::var("SNIPMUNK_SCROLL_DUMP") {
                    for (name, data) in [("prev", &last), ("next", &pic)] {
                        if let Some(img) =
                            image::RgbaImage::from_raw(pw as u32, ph as u32, data.clone())
                        {
                            let _ = img.save(format!("{dir}/{name}-{steps}.png"));
                        }
                    }
                }
                failures += 1;
                if failures > 3 {
                    reason = Reason::End;
                    break;
                }
                // Too far (or the page changed): back, and a smaller step.
                scroller.up(notches);
                notches = (notches / 2).max(1);
                // A page of the API that leaves (almost) no overlap: the wheel is more careful.
                if scroller.name() == "uia" && scroller.next_way() {
                    method = scroller.name();
                    notches = 3;
                }
                let _ = grab_settled(src, Duration::from_millis(150))?;
                let (back, ..) = grab_settled(src, Duration::from_millis(60))?;
                last = back;
            }
        }
    }
    let _ = (&last, started_percent);
    if opts.scroll_back {
        scroller.to_top();
    }
    let (rgba, width, height) = st.finish();
    Ok(Outcome {
        rgba,
        width,
        height,
        steps,
        method,
        reason,
    })
}

// --- the session started from the screenshot overlay ------------------------------------------------------------------------

/// The settings: maximum height and scrolling back.
fn options(app: &AppHandle) -> Options {
    let s = app
        .state::<crate::commands::AppState>()
        .settings
        .lock()
        .unwrap()
        .clone();
    Options {
        max_height: s.scroll_max_height.clamp(1000, 32_000) as usize,
        scroll_back: s.scroll_back,
    }
}

/// A line of the development trace (`SNIPMUNK_SCROLL_TRACE` names the file).
fn trace(line: &str) {
    if let Ok(path) = std::env::var("SNIPMUNK_SCROLL_TRACE") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// The Stop button of the pill.
#[tauri::command]
pub fn scroll_stop() {
    STOP.store(true, Ordering::SeqCst);
}

/// Start a scrolling capture of `area` (the window `hwnd` is scrolled). Runs on its own thread; the result is added as a capture.
pub fn begin(app: &AppHandle, area: Rect, hwnd: Option<isize>, title: Option<String>) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    STOP.store(false, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let result = session(&app, area, hwnd, title);
        RUNNING.store(false, Ordering::SeqCst);
        if let Err(e) = result {
            let _ = app.emit("capture-error", e);
        }
    });
}

#[cfg(windows)]
fn session(
    app: &AppHandle,
    area: Rect,
    hwnd: Option<isize>,
    title: Option<String>,
) -> Result<(), String> {
    let opts = options(app);
    show_pill(app, area);
    // The overlay is gone and the page behind it has settled.
    std::thread::sleep(Duration::from_millis(250));
    let src = Source::Screen(area);
    let mut scroller = win::make_scroller(hwnd, area);
    let progress = |st: &Stitcher| publish(app, st);
    let stopped = || STOP.load(Ordering::SeqCst) || crate::webview::escape_down();
    let outcome = run(&src, scroller.as_mut(), opts, &progress, &stopped);
    let reason = outcome.as_ref().map_or(Reason::End, |o| o.reason);
    let _ = app.emit_to("scrollpill", "scroll-done", reason);
    let outcome = match outcome {
        Ok(o) => o,
        Err(e) => {
            close_pill(app);
            return Err(e);
        }
    };
    if reason == Reason::NoScroll {
        std::thread::sleep(Duration::from_millis(2500));
        close_pill(app);
        return Err("This window cannot be scrolled by Snipmunk.".into());
    }
    std::thread::sleep(Duration::from_millis(700));
    close_pill(app);
    let frame = dawn_capture::Frame {
        width: outcome.width as u32,
        height: outcome.height as u32,
        rgba: outcome.rgba,
    };
    crate::output::deliver(app, frame, title)
}

#[cfg(not(windows))]
fn session(_: &AppHandle, _: Rect, _: Option<isize>, _: Option<String>) -> Result<(), String> {
    Err("Scrolling screenshots need Windows.".into())
}

/// Tell the pill the height and give it a new thumbnail.
fn publish(app: &AppHandle, st: &Stitcher) {
    let (rgba, w, h) = st.thumbnail(180, 120);
    if let Some(img) = image::RgbaImage::from_raw(w as u32, h as u32, rgba) {
        if let Ok(png) = crate::thumbs::png_bytes(&img, image::codecs::png::CompressionType::Fast) {
            *THUMB.lock().unwrap_or_else(|e| e.into_inner()) = png;
        }
    }
    let n = THUMB_N.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit_to(
        "scrollpill",
        "scroll-progress",
        Progress {
            height: st.height(),
            n,
        },
    );
}

#[cfg(windows)]
fn show_pill(app: &AppHandle, area: Rect) {
    THUMB.lock().unwrap_or_else(|e| e.into_inner()).clear();
    let mon = win::monitor_rect_at(area.center().0, area.center().1).unwrap_or(area);
    let scale = win::scale_at(area.center().0, area.center().1);
    let (w, h) = ((300.0 * scale) as u32, (96.0 * scale) as u32);
    let x = mon.x + (mon.w as i32 - w as i32) / 2;
    let y = mon.y + (12.0 * scale) as i32;
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "scrollpill",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .decorations(false)
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    .visible(false)
    .build();
    if let Ok(win) = built {
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        crate::webview::exclude_from_capture(&win);
        win::no_activate(&win);
        let _ = win.show();
    }
}

fn close_pill(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("scrollpill") {
        let _ = w.close();
    }
}

// --- development-only test window ---------------------------------------------------------------------------------------------

/// Development only: a scrollable window made by this program ("custom": painted lines with a sticky header and footer, scrolled by
/// the wheel or the scroll bar messages; "edit": a multi-line edit control that has a UI Automation scroll pattern). Returns its handle
/// and client size.
#[cfg(all(windows, debug_assertions))]
#[tauri::command]
pub fn dev_scroll_window(kind: String, lines: Option<u32>) -> CmdResult<serde_json::Value> {
    let (hwnd, w, h) = win::test_window(&kind, lines.unwrap_or(400))
        .map_err(|e| crate::error::CmdError::new("unavailable", e))?;
    Ok(serde_json::json!({ "hwnd": hwnd, "width": w, "height": h }))
}

/// Development only: run a scrolling capture of the test window (pictures from that window alone) and add the result as a capture.
/// Returns what happened: height, steps, way, reason, milliseconds.
#[cfg(all(windows, debug_assertions))]
#[tauri::command]
pub async fn dev_scroll_capture(
    app: AppHandle,
    hwnd: isize,
    max_height: Option<u32>,
    scroll_back: Option<bool>,
    deliver: Option<bool>,
    force: Option<String>,
) -> CmdResult<serde_json::Value> {
    let r = tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let started = Instant::now();
        let area = win::window_rect(hwnd);
        let mut scroller = win::make_scroller(Some(hwnd), area);
        // A way of scrolling can be forced ("wheel", "vscroll"), to test the fallbacks.
        if let Some(way) = force.as_deref() {
            while scroller.name() != way && scroller.next_way() {}
        }
        let opts = Options {
            max_height: max_height.unwrap_or(20_000) as usize,
            scroll_back: scroll_back.unwrap_or(true),
        };
        let out = run(
            &Source::Window(hwnd),
            scroller.as_mut(),
            opts,
            &|_| {},
            &|| false,
        )?;
        let summary = serde_json::json!({
            "width": out.width, "height": out.height, "steps": out.steps, "way": out.method,
            "reason": out.reason, "ms": started.elapsed().as_millis() as u64,
        });
        if deliver.unwrap_or(false) {
            let frame = dawn_capture::Frame {
                width: out.width as u32,
                height: out.height as u32,
                rgba: out.rgba,
            };
            crate::output::deliver(&app, frame, Some("Scrolling test".into()))?;
        }
        Ok(summary)
    })
    .await
    .map_err(|e| crate::error::CmdError::new("io", e.to_string()))?
    .map_err(|e| crate::error::CmdError::new("capture", e))?;
    Ok(r)
}

#[cfg(not(all(windows, debug_assertions)))]
#[tauri::command]
pub fn dev_scroll_window() -> CmdResult<()> {
    Err(crate::error::CmdError::new(
        "unavailable",
        "the test window exists in development builds only",
    ))
}

#[cfg(not(all(windows, debug_assertions)))]
#[tauri::command]
pub fn dev_scroll_capture() -> CmdResult<()> {
    Err(crate::error::CmdError::new(
        "unavailable",
        "the test window exists in development builds only",
    ))
}

#[cfg(windows)]
mod win {
    use super::{Rect, Scroller};
    use windows::core::{w, Interface, BOOL};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush,
        DeleteDC, DeleteObject, FillRect, GetDC, GetDIBits, GetMonitorInfoW, MonitorFromPoint,
        ReleaseDC, SelectObject, SetBkMode, SetTextColor, TextOutW, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
        TRANSPARENT,
    };
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationScrollPattern, ScrollAmount_LargeDecrement,
        ScrollAmount_LargeIncrement, ScrollAmount_NoAmount, TreeScope_Subtree,
        UIA_IsScrollPatternAvailablePropertyId, UIA_ScrollPatternId,
    };
    use windows::Win32::UI::Controls::SetScrollInfo;
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW,
        GetScrollInfo, GetWindowLongPtrW, GetWindowRect, PostMessageW, RealChildWindowFromPoint,
        RegisterClassW, SetWindowLongPtrW, ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
        GWL_EXSTYLE, MSG, SB_PAGEDOWN, SB_PAGEUP, SB_VERT, SCROLLINFO, SIF_ALL, SIF_PAGE, SIF_POS,
        SIF_RANGE, SW_SHOWNOACTIVATE, WM_MOUSEWHEEL, WM_PAINT, WM_VSCROLL, WNDCLASSW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_OVERLAPPED, WS_VISIBLE, WS_VSCROLL,
    };

    pub fn window_rect(hwnd: isize) -> Rect {
        let mut r = RECT::default();
        // SAFETY: a window handle and a valid out pointer.
        unsafe {
            let _ = GetWindowRect(HWND(hwnd as _), &mut r);
        }
        Rect::new(
            r.left,
            r.top,
            (r.right - r.left).max(1) as u32,
            (r.bottom - r.top).max(1) as u32,
        )
    }

    pub fn monitor_rect_at(x: i32, y: i32) -> Option<Rect> {
        // SAFETY: plain queries with valid out pointers.
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(m, &mut info).as_bool().then(|| {
                Rect::new(
                    info.rcMonitor.left,
                    info.rcMonitor.top,
                    (info.rcMonitor.right - info.rcMonitor.left) as u32,
                    (info.rcMonitor.bottom - info.rcMonitor.top) as u32,
                )
            })
        }
    }

    pub fn scale_at(x: i32, y: i32) -> f64 {
        use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
        // SAFETY: plain queries with valid out pointers.
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let (mut dx, mut dy) = (96u32, 96u32);
            let _ = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            dx as f64 / 96.0
        }
    }

    /// Not activated by a click, not in Alt+Tab.
    pub fn no_activate(win: &tauri::WebviewWindow) {
        if let Ok(h) = win.hwnd() {
            let hwnd = HWND(h.0);
            // SAFETY: a valid window handle of this process.
            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
                );
            }
        }
    }

    /// The window's own pixels (RGBA), whatever lies on top of it (used by the development tests).
    pub fn print_window(hwnd: isize) -> Result<(Vec<u8>, usize, usize), String> {
        let r = window_rect(hwnd);
        let (w, h) = (r.w as i32, r.h as i32);
        // SAFETY: GDI objects are created, used and released here; the buffer has the size the bitmap needs.
        unsafe {
            let screen = GetDC(None);
            let dc = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(dc, HGDIOBJ(bmp.0));
            let ok = PrintWindow(HWND(hwnd as _), dc, PRINT_WINDOW_FLAGS(2)).as_bool();
            let mut info = BITMAPINFO {
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
            let mut buf = vec![0u8; (w * h * 4) as usize];
            let got = GetDIBits(
                dc,
                bmp,
                0,
                h as u32,
                Some(buf.as_mut_ptr() as *mut _),
                &mut info,
                DIB_RGB_COLORS,
            );
            SelectObject(dc, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(dc);
            ReleaseDC(None, screen);
            if !ok || got == 0 {
                return Err("the window could not be drawn".into());
            }
            for px in buf.chunks_exact_mut(4) {
                px.swap(0, 2);
                px[3] = 255;
            }
            Ok((buf, w as usize, h as usize))
        }
    }

    // --- the ways of scrolling ------------------------------------------------------------------------------------

    struct Uia {
        pattern: IUIAutomationScrollPattern,
    }

    // SAFETY: the pattern is only used on the thread that made it (the capture thread).
    impl Uia {
        fn find(hwnd: isize, area: Rect) -> Option<Self> {
            // SAFETY: COM calls on this thread; every pointer comes from the calls themselves.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let auto: IUIAutomation =
                    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                let root = auto.ElementFromHandle(HWND(hwnd as _)).ok()?;
                let cond = auto
                    .CreatePropertyCondition(
                        UIA_IsScrollPatternAvailablePropertyId,
                        &VARIANT::from(true),
                    )
                    .ok()?;
                let all = root.FindAll(TreeScope_Subtree, &cond).ok()?;
                let mut best: Option<(i64, IUIAutomationScrollPattern)> = None;
                for i in 0..all.Length().ok()? {
                    let Ok(el) = all.GetElement(i) else { continue };
                    let Ok(p) = el.GetCurrentPattern(UIA_ScrollPatternId) else {
                        continue;
                    };
                    let Ok(pat) = p.cast::<IUIAutomationScrollPattern>() else {
                        continue;
                    };
                    if !pat
                        .CurrentVerticallyScrollable()
                        .map(|b| b.as_bool())
                        .unwrap_or(false)
                    {
                        continue;
                    }
                    let Ok(r) = el.CurrentBoundingRectangle() else {
                        continue;
                    };
                    let ix = (r.right.min(area.right()) - r.left.max(area.x)).max(0) as i64;
                    let iy = (r.bottom.min(area.bottom()) - r.top.max(area.y)).max(0) as i64;
                    if ix * iy > 0 && best.as_ref().is_none_or(|b| ix * iy > b.0) {
                        best = Some((ix * iy, pat));
                    }
                }
                best.map(|b| Self { pattern: b.1 })
            }
        }
    }

    pub struct Ways {
        uia: Option<Uia>,
        top: isize,
        center: (i32, i32),
        /// 0 = UI Automation, 1 = the wheel, 2 = the scroll bar message
        way: u8,
    }

    pub fn make_scroller(hwnd: Option<isize>, area: Rect) -> Box<dyn Scroller> {
        let top = hwnd.unwrap_or(0);
        let uia = (top != 0).then(|| Uia::find(top, area)).flatten();
        Box::new(Ways {
            way: if uia.is_some() { 0 } else { 1 },
            uia,
            top,
            center: area.center(),
        })
    }

    impl Ways {
        /// The innermost window under the middle of the area.
        fn target(&self) -> HWND {
            let mut h = HWND(self.top as _);
            // SAFETY: plain window queries.
            unsafe {
                loop {
                    let mut p = POINT {
                        x: self.center.0,
                        y: self.center.1,
                    };
                    let _ = windows::Win32::Graphics::Gdi::ScreenToClient(h, &mut p);
                    let child = RealChildWindowFromPoint(h, p);
                    if child.0.is_null() || child == h {
                        return h;
                    }
                    h = child;
                }
            }
        }

        fn wheel(&self, notches: i32) -> bool {
            let delta = (-120 * notches) as i16 as u16 as usize;
            let (x, y) = self.center;
            let lparam = ((y as i16 as u16 as usize) << 16) | (x as i16 as u16 as usize);
            // SAFETY: a window message to a window handle.
            unsafe {
                PostMessageW(
                    Some(self.target()),
                    WM_MOUSEWHEEL,
                    WPARAM(delta << 16),
                    LPARAM(lparam as isize),
                )
                .is_ok()
            }
        }
    }

    impl Scroller for Ways {
        fn down(&mut self, notches: u32) -> bool {
            match self.way {
                0 => {
                    let Some(u) = &self.uia else { return false };
                    // SAFETY: COM call on the thread that made the pattern.
                    unsafe {
                        u.pattern
                            .Scroll(ScrollAmount_NoAmount, ScrollAmount_LargeIncrement)
                            .is_ok()
                    }
                }
                1 => self.wheel(notches as i32),
                _ => unsafe {
                    // SAFETY: a window message to a window handle.
                    PostMessageW(
                        Some(self.target()),
                        WM_VSCROLL,
                        WPARAM(SB_PAGEDOWN.0 as usize),
                        LPARAM(0),
                    )
                    .is_ok()
                },
            }
        }

        fn up(&mut self, notches: u32) {
            match self.way {
                0 => {
                    if let Some(u) = &self.uia {
                        // SAFETY: COM call on the thread that made the pattern.
                        unsafe {
                            let _ = u
                                .pattern
                                .Scroll(ScrollAmount_NoAmount, ScrollAmount_LargeDecrement);
                        }
                    }
                }
                1 => {
                    let _ = self.wheel(-(notches as i32));
                }
                _ => unsafe {
                    let _ = PostMessageW(
                        Some(self.target()),
                        WM_VSCROLL,
                        WPARAM(SB_PAGEUP.0 as usize),
                        LPARAM(0),
                    );
                },
            }
        }

        fn percent(&self) -> Option<f64> {
            let u = self.uia.as_ref().filter(|_| self.way == 0)?;
            // SAFETY: COM call on the thread that made the pattern.
            unsafe { u.pattern.CurrentVerticalScrollPercent().ok() }
        }

        fn to_top(&mut self) {
            if let Some(u) = self.uia.as_ref().filter(|_| self.way == 0) {
                // SAFETY: COM call on the thread that made the pattern.
                unsafe {
                    let _ = u.pattern.SetScrollPercent(-1.0, 0.0);
                }
                return;
            }
            // Many wheel notches up (the end of the page is left behind in one go).
            for _ in 0..40 {
                if self.way == 1 {
                    let _ = self.wheel(-30);
                } else {
                    unsafe {
                        let _ = PostMessageW(
                            Some(self.target()),
                            WM_VSCROLL,
                            WPARAM(6), // SB_TOP
                            LPARAM(0),
                        );
                    }
                }
            }
        }

        fn name(&self) -> &'static str {
            ["uia", "wheel", "vscroll"][self.way as usize]
        }

        fn next_way(&mut self) -> bool {
            if self.way >= 2 {
                return false;
            }
            self.way += 1;
            true
        }
    }

    // --- the test window --------------------------------------------------------------------------------------------

    use std::sync::Mutex;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowTextLengthW, SetWindowTextW, ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY,
        WINDOW_STYLE, WS_BORDER, WS_CHILD, WS_CLIPCHILDREN, WS_POPUP,
    };

    const HEADER: i32 = 48;
    const FOOTER: i32 = 36;
    const LINE: i32 = 24;
    static CUSTOM_LINES: Mutex<(i32, i32)> = Mutex::new((400, 0));

    unsafe extern "system" fn custom_proc(h: HWND, m: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        // SAFETY: the standard window procedure contract; GDI objects are released before returning.
        unsafe {
            let mut client = RECT::default();
            let _ = GetClientRect(h, &mut client);
            let view_h = client.bottom - HEADER - FOOTER;
            let total = CUSTOM_LINES.lock().unwrap_or_else(|e| e.into_inner()).0 * LINE;
            let max = (total - view_h).max(0);
            let set = |pos: i32| {
                let pos = pos.clamp(0, max);
                CUSTOM_LINES.lock().unwrap_or_else(|e| e.into_inner()).1 = pos;
                let si = SCROLLINFO {
                    cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                    fMask: SIF_ALL,
                    nMin: 0,
                    nMax: total,
                    nPage: view_h.max(1) as u32,
                    nPos: pos,
                    nTrackPos: 0,
                };
                SetScrollInfo(h, SB_VERT, &si, true);
                let _ = windows::Win32::Graphics::Gdi::InvalidateRect(Some(h), None, false);
            };
            let pos = CUSTOM_LINES.lock().unwrap_or_else(|e| e.into_inner()).1;
            match m {
                WM_MOUSEWHEEL => {
                    let d = ((wp.0 >> 16) as u16 as i16) as i32;
                    set(pos - d / 120 * LINE * 3);
                    LRESULT(0)
                }
                WM_VSCROLL => {
                    match (wp.0 & 0xffff) as i32 {
                        x if x == SB_PAGEDOWN.0 => set(pos + view_h - LINE),
                        x if x == SB_PAGEUP.0 => set(pos - view_h + LINE),
                        6 => set(0),
                        7 => set(max),
                        _ => {
                            let mut si = SCROLLINFO {
                                cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                                fMask: SIF_POS,
                                ..Default::default()
                            };
                            let _ = GetScrollInfo(h, SB_VERT, &mut si);
                        }
                    }
                    LRESULT(0)
                }
                WM_PAINT => {
                    let mut ps = windows::Win32::Graphics::Gdi::PAINTSTRUCT::default();
                    let dc = windows::Win32::Graphics::Gdi::BeginPaint(h, &mut ps);
                    // Drawn into a memory bitmap first so a repaint never shows half a picture.
                    let mem = CreateCompatibleDC(Some(dc));
                    let bmp = CreateCompatibleBitmap(dc, client.right, client.bottom);
                    let old = SelectObject(mem, HGDIOBJ(bmp.0));
                    let white = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x00FFFFFF));
                    FillRect(mem, &client, white);
                    let font = CreateFontW(
                        18,
                        0,
                        0,
                        0,
                        400,
                        0,
                        0,
                        0,
                        Default::default(),
                        Default::default(),
                        Default::default(),
                        Default::default(),
                        0,
                        w!("Consolas"),
                    );
                    let oldf = SelectObject(mem, HGDIOBJ(font.0));
                    SetBkMode(mem, TRANSPARENT);
                    SetTextColor(mem, windows::Win32::Foundation::COLORREF(0x00222222));
                    let first = (pos / LINE).max(0);
                    for i in first..(first + view_h / LINE + 2) {
                        let y = HEADER + i * LINE - pos;
                        if y + LINE <= HEADER || y >= client.bottom - FOOTER || i * LINE >= total {
                            continue;
                        }
                        // Every line is different (a number and a pattern of marks), so overlaps are never ambiguous.
                        let text: Vec<u16> =
                            format!("Line {i:05}  {}", "#".repeat(((i * 7) % 23 + 3) as usize))
                                .encode_utf16()
                                .collect();
                        let _ = TextOutW(mem, 10, y + 2, &text);
                    }
                    for (y0, y1, c) in [
                        (0, HEADER, 0x00784B1E),
                        (client.bottom - FOOTER, client.bottom, 0x001E4B78),
                    ] {
                        let b = CreateSolidBrush(windows::Win32::Foundation::COLORREF(c));
                        let r = RECT {
                            left: 0,
                            top: y0,
                            right: client.right,
                            bottom: y1,
                        };
                        FillRect(mem, &r, b);
                        let _ = DeleteObject(HGDIOBJ(b.0));
                    }
                    SetTextColor(mem, windows::Win32::Foundation::COLORREF(0x00FFFFFF));
                    let head: Vec<u16> = "Sticky header".encode_utf16().collect();
                    let _ = TextOutW(mem, 10, 14, &head);
                    let foot: Vec<u16> = "Sticky footer".encode_utf16().collect();
                    let _ = TextOutW(mem, 10, client.bottom - FOOTER + 8, &foot);
                    let _ = BitBlt(
                        dc,
                        0,
                        0,
                        client.right,
                        client.bottom,
                        Some(mem),
                        0,
                        0,
                        SRCCOPY,
                    );
                    SelectObject(mem, oldf);
                    let _ = DeleteObject(HGDIOBJ(font.0));
                    let _ = DeleteObject(HGDIOBJ(white.0));
                    SelectObject(mem, old);
                    let _ = DeleteObject(HGDIOBJ(bmp.0));
                    let _ = DeleteDC(mem);
                    let _ = windows::Win32::Graphics::Gdi::EndPaint(h, &ps);
                    LRESULT(0)
                }
                _ => DefWindowProcW(h, m, wp, lp),
            }
        }
    }

    /// A scrollable window on its own thread (with a message loop). Returns (handle, width, height).
    pub fn test_window(kind: &str, lines: u32) -> Result<(isize, u32, u32), String> {
        let kind = kind.to_string();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(isize, u32, u32), String>>();
        std::thread::spawn(move || {
            // SAFETY: Win32 window creation and a message loop on this thread only.
            unsafe {
                let hi = windows::Win32::System::LibraryLoader::GetModuleHandleW(None)
                    .unwrap_or_default();
                let class = w!("SnipmunkScrollTest");
                let wc = WNDCLASSW {
                    style: CS_HREDRAW | CS_VREDRAW,
                    lpfnWndProc: Some(custom_proc),
                    hInstance: hi.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                RegisterClassW(&wc);
                let (cw, ch) = (520, 420);
                // A tool window that never takes the focus; placed where it is out of the way (the pictures come from the
                // window itself, so nothing else on the screen matters).
                let hwnd = CreateWindowExW(
                    WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
                    class,
                    w!("Snipmunk scroll test"),
                    WS_OVERLAPPED | WS_VISIBLE | WS_VSCROLL | WS_CLIPCHILDREN,
                    40,
                    40,
                    cw,
                    ch,
                    None,
                    None,
                    Some(hi.into()),
                    None,
                );
                let Ok(hwnd) = hwnd else {
                    let _ = tx.send(Err("the test window could not be created".into()));
                    return;
                };
                let mut client = RECT::default();
                let _ = GetClientRect(hwnd, &mut client);
                if kind == "edit" {
                    let text: String = (0..lines)
                        .map(|i| {
                            format!(
                                "Line {i:05}  {}\r\n",
                                "#".repeat(((i * 7) % 23 + 3) as usize)
                            )
                        })
                        .collect();
                    let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
                    let edit = CreateWindowExW(
                        Default::default(),
                        w!("EDIT"),
                        None,
                        WINDOW_STYLE(
                            WS_CHILD.0
                                | WS_VISIBLE.0
                                | WS_VSCROLL.0
                                | WS_BORDER.0
                                | (ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY) as u32,
                        ),
                        0,
                        0,
                        client.right,
                        client.bottom,
                        Some(hwnd),
                        None,
                        Some(hi.into()),
                        None,
                    );
                    if let Ok(e) = edit {
                        let _ = SetWindowTextW(e, windows::core::PCWSTR(wide.as_ptr()));
                    }
                    let _ = GetWindowTextLengthW(hwnd);
                } else {
                    *CUSTOM_LINES.lock().unwrap_or_else(|e| e.into_inner()) = (lines as i32, 0);
                    let view_h = client.bottom - HEADER - FOOTER;
                    let si = SCROLLINFO {
                        cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                        fMask: SIF_RANGE | SIF_PAGE | SIF_POS,
                        nMin: 0,
                        nMax: lines as i32 * LINE,
                        nPage: view_h as u32,
                        nPos: 0,
                        nTrackPos: 0,
                    };
                    SetScrollInfo(hwnd, SB_VERT, &si, true);
                }
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                let dpi = GetDpiForWindow(hwnd);
                let _ = dpi;
                let r = {
                    let mut r = RECT::default();
                    let _ = GetWindowRect(hwnd, &mut r);
                    r
                };
                let _ = tx.send(Ok((
                    hwnd.0 as isize,
                    (r.right - r.left) as u32,
                    (r.bottom - r.top) as u32,
                )));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });
        let _ = (BOOL(0), WS_POPUP);
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }
}
