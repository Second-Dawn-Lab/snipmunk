#![allow(clippy::too_many_arguments)]
//! The step recorder of Documents mode: it turns what the user does in any Windows app into the steps of a guide.
//!
//! **Threads** (nothing waits for anything it should not wait for):
//! * *Hooks* (`hooks`): one thread with a message loop that installs `WH_MOUSE_LL` and `WH_KEYBOARD_LL`. A hook callback only copies
//!   the event (position, key, modifiers, the time) into a channel and returns; it never takes a lock that could block and never
//!   touches a window, UI Automation or the disk. While the guide is paused the callbacks drop the events at once.
//! * *Frames* (`Frames`): a live capture of every monitor (Windows.Graphics.Capture, no cursor, about 15 pictures a second when the
//!   screen changes) keeps the newest few pictures of each monitor with their arrival time. The picture of a step is the newest one
//!   that arrived BEFORE the mouse went down, so it shows the screen as it was at the click, before the app reacted.
//! * *UI Automation* (`Uia`): one thread (COM) answers "what is at this point / what has the focus", with a time limit of 300 ms for
//!   the caller; when it is late the step still gets its picture and a fallback text.
//! * *Pipeline* (`pipeline`): the worker that reads the events in order, merges a double click into one step, groups typed characters
//!   into one step, asks UI Automation, writes the picture and appends the line to `steps.jsonl`.
//!
//! In the tests the hooks are not installed: events are fed into the same channel after the hook stage (`dev_guide_inject`), against
//! test windows that the own test instance creates, so no real input of the user is ever read.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{CmdError, CmdResult};
use crate::geometry::Rect;
use crate::guides::{self, ElementInfo, Step, WindowInfo};
use crate::steptext::{self, Kind, Meta};

/// Mouse buttons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Button {
    Left,
    Right,
    Middle,
}

/// What the hooks (or the tests) hand to the pipeline.
#[derive(Debug, Clone)]
pub enum Raw {
    /// A mouse button went down at a point of the desktop (physical pixels).
    Mouse {
        button: Button,
        x: i32,
        y: i32,
        at: Instant,
    },
    /// A key went down: virtual key, scan code, the modifiers held, the keyboard layout it was typed on (0 = the current one).
    Key {
        vk: u32,
        scan: u32,
        mods: Mods,
        hkl: isize,
        at: Instant,
    },
    /// "Take a step now" (the step hotkey, the bar's button): at the pointer.
    Take { x: i32, y: i32, at: Instant },
    /// Finish: write what is pending and stop.
    Stop,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Mods {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub win: bool,
    pub caps: bool,
}

// --- pure parts: double click, typed text, shortcut names ---------------------------------------------------------------------------

/// A left click waits for the double-click time: a second click close to it makes it ONE double-click step.
#[derive(Debug, Clone, Copy)]
pub struct PendingClick {
    pub at: Instant,
    pub x: i32,
    pub y: i32,
}

/// Is a click at (x, y) at time `at` the second click of a double click that started with `first`?
pub fn is_double(
    first: &PendingClick,
    x: i32,
    y: i32,
    at: Instant,
    window: Duration,
    slop: i32,
) -> bool {
    at.saturating_duration_since(first.at) <= window
        && (x - first.x).abs() <= slop
        && (y - first.y).abs() <= slop
}

/// The characters typed into one element, until something ends the group.
#[derive(Debug, Clone, Default)]
pub struct TypeGroup {
    pub text: String,
    pub last: Option<Instant>,
}

impl TypeGroup {
    pub fn push(&mut self, s: &str, at: Instant) {
        self.text.push_str(s);
        self.last = Some(at);
    }
    pub fn backspace(&mut self, at: Instant) {
        self.text.pop();
        self.last = Some(at);
    }
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
    /// Idle for the grouping time?
    pub fn idle(&self, now: Instant, limit: Duration) -> bool {
        self.last
            .is_some_and(|l| now.saturating_duration_since(l) >= limit)
    }
}

pub const TYPE_IDLE: Duration = Duration::from_millis(2000);

/// "Ctrl+Shift+S" for a shortcut: the held modifiers and the key name.
pub fn shortcut_name(mods: Mods, key: &str) -> String {
    let mut v: Vec<&str> = Vec::new();
    if mods.ctrl {
        v.push("Ctrl");
    }
    if mods.alt {
        v.push("Alt");
    }
    if mods.shift {
        v.push("Shift");
    }
    if mods.win {
        v.push("Win");
    }
    v.push(key);
    v.join("+")
}

/// The name of a key for a shortcut ("S", "F5", "Enter").
pub fn key_name(vk: u32) -> String {
    match vk {
        0x08 => "Backspace".into(),
        0x09 => "Tab".into(),
        0x0D => "Enter".into(),
        0x1B => "Esc".into(),
        0x20 => "Space".into(),
        0x21 => "Page Up".into(),
        0x22 => "Page Down".into(),
        0x23 => "End".into(),
        0x24 => "Home".into(),
        0x25 => "Left".into(),
        0x26 => "Up".into(),
        0x27 => "Right".into(),
        0x28 => "Down".into(),
        0x2D => "Insert".into(),
        0x2E => "Delete".into(),
        0x30..=0x39 | 0x41..=0x5A => (vk as u8 as char).to_string(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0xBB => "+".into(),
        0xBC => ",".into(),
        0xBD => "-".into(),
        0xBE => ".".into(),
        _ => format!("Key {vk:#04x}"),
    }
}

pub fn is_modifier(vk: u32) -> bool {
    matches!(vk, 0x10 | 0x11 | 0x12 | 0x14 | 0x5B | 0x5C | 0xA0..=0xA5)
}

#[cfg(test)]
mod pure_tests {
    use super::*;

    #[test]
    fn a_second_click_close_in_time_and_place_is_a_double_click() {
        let t0 = Instant::now();
        let first = PendingClick {
            at: t0,
            x: 100,
            y: 100,
        };
        let w = Duration::from_millis(500);
        assert!(is_double(
            &first,
            102,
            99,
            t0 + Duration::from_millis(200),
            w,
            4
        ));
        assert!(
            !is_double(&first, 102, 99, t0 + Duration::from_millis(700), w, 4),
            "too late"
        );
        assert!(
            !is_double(&first, 130, 100, t0 + Duration::from_millis(200), w, 4),
            "too far"
        );
    }

    #[test]
    fn the_picture_of_a_step_is_the_newest_one_that_arrived_before_the_click() {
        let m = MonitorFrames::new(Rect::new(0, 0, 2, 1), 1.0);
        m.push(vec![1; 8], 2, 1);
        std::thread::sleep(Duration::from_millis(30));
        let click = Instant::now();
        std::thread::sleep(Duration::from_millis(30));
        // The app reacted after the click: this picture arrives later and is not used.
        m.push(vec![2; 8], 2, 1);
        let (frame, _, _, age) = m.at(click).unwrap();
        assert_eq!(frame[0], 1);
        assert!((25..200).contains(&age), "{age} ms old");
        // Nothing older than the click: the oldest picture is used (age 0).
        let empty = MonitorFrames::new(Rect::new(0, 0, 2, 1), 1.0);
        let before = Instant::now();
        std::thread::sleep(Duration::from_millis(5));
        empty.push(vec![3; 8], 2, 1);
        assert_eq!(empty.at(before).unwrap().3, 0);
        // The ring keeps only the newest few pictures.
        for i in 0..10u8 {
            m.push(vec![i; 8], 2, 1);
        }
        assert_eq!(m.ring.lock().unwrap().len(), RING);
    }

    #[test]
    fn typed_characters_group_and_backspace_removes_the_last() {
        let t0 = Instant::now();
        let mut g = TypeGroup::default();
        g.push("Ham", t0);
        g.push("x", t0 + Duration::from_millis(100));
        g.backspace(t0 + Duration::from_millis(200));
        g.push("burg", t0 + Duration::from_millis(300));
        assert_eq!(g.text, "Hamburg");
        assert!(!g.idle(t0 + Duration::from_millis(1500), TYPE_IDLE));
        assert!(g.idle(t0 + Duration::from_millis(2400), TYPE_IDLE));
    }

    #[test]
    fn shortcuts_are_named_in_a_fixed_order() {
        let m = Mods {
            ctrl: true,
            shift: true,
            ..Default::default()
        };
        assert_eq!(shortcut_name(m, &key_name(0x53)), "Ctrl+Shift+S");
        assert_eq!(
            shortcut_name(
                Mods {
                    alt: true,
                    ..Default::default()
                },
                &key_name(0x70)
            ),
            "Alt+F1"
        );
        assert!(is_modifier(0xA0) && !is_modifier(0x41));
    }
}

// --- the live pictures of the monitors ----------------------------------------------------------------------------------------------

/// A picture with the time it arrived, and its size.
type Arrived = (Instant, Arc<Vec<u8>>, usize, usize);

/// One monitor: where it is, and its newest pictures with the time they arrived.
pub struct MonitorFrames {
    pub rect: Rect,
    pub scale: f64,
    ring: Mutex<std::collections::VecDeque<Arrived>>,
}

/// The newest pictures kept per monitor (about 0.2 s of a changing screen; a 4K picture is 33 MB, so only a few).
const RING: usize = 3;

impl MonitorFrames {
    fn new(rect: Rect, scale: f64) -> Self {
        Self {
            rect,
            scale,
            ring: Mutex::new(std::collections::VecDeque::new()),
        }
    }

    pub fn push(&self, bgra: Vec<u8>, w: usize, h: usize) {
        let mut r = self.ring.lock().unwrap_or_else(|e| e.into_inner());
        if r.len() >= RING {
            r.pop_front();
        }
        r.push_back((Instant::now(), Arc::new(bgra), w, h));
    }

    /// The picture for the time `at`: the newest that arrived at or before it (the screen as it was), else the oldest we have.
    /// Returns the picture, its size and how long before `at` it arrived (0 when there was none before).
    pub fn at(&self, at: Instant) -> Option<(Arc<Vec<u8>>, usize, usize, u64)> {
        let r = self.ring.lock().unwrap_or_else(|e| e.into_inner());
        let before = r.iter().rev().find(|f| f.0 <= at);
        match before {
            Some(f) => Some((
                f.1.clone(),
                f.2,
                f.3,
                at.duration_since(f.0).as_millis() as u64,
            )),
            None => r.front().map(|f| (f.1.clone(), f.2, f.3, 0)),
        }
    }
}

pub struct Frames {
    pub monitors: Vec<Arc<MonitorFrames>>,
    #[cfg(windows)]
    _captures: Mutex<Vec<crate::scrollshot::win::Capture>>,
    stop: Arc<AtomicBool>,
}

impl Frames {
    /// The monitor that holds a point (or the nearest one).
    pub fn monitor_for(&self, x: i32, y: i32) -> usize {
        let p = (x, y);
        self.monitors
            .iter()
            .position(|m| m.rect.contains(p))
            .unwrap_or_else(|| {
                self.monitors
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, m)| {
                        let c = m.rect.center();
                        ((c.0 - x).pow(2) as i64) + ((c.1 - y).pow(2) as i64)
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0)
            })
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        self._captures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}

/// Where the pictures come from.
#[derive(Debug, Clone, Copy)]
pub enum FrameSource {
    /// Every monitor of the desktop.
    Monitors,
    /// One window of this program (development tests): its pictures stand for a "monitor" at the window's place.
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    Window(isize),
    /// Generated pictures at a place on the "desktop" (development tests).
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    Synthetic(Rect),
}

#[cfg(windows)]
fn start_frames(src: FrameSource) -> Result<Frames, String> {
    use crate::scrollshot::{win, Source};
    let stop = Arc::new(AtomicBool::new(false));
    let mut monitors = Vec::new();
    let mut captures = Vec::new();
    let mut feeds: Vec<(
        Arc<MonitorFrames>,
        std::sync::mpsc::Receiver<crate::scrollshot::Shot>,
    )> = Vec::new();
    match src {
        FrameSource::Monitors => {
            for (rect, scale) in win::monitors() {
                let m = Arc::new(MonitorFrames::new(rect, scale));
                let (tx, rx) = std::sync::mpsc::sync_channel(2);
                captures.push(win::start_capture(Source::Screen(rect), tx)?);
                feeds.push((m.clone(), rx));
                monitors.push(m);
            }
        }
        FrameSource::Window(hwnd) => {
            let rect = win::window_rect(hwnd);
            let m = Arc::new(MonitorFrames::new(rect, 1.0));
            let (tx, rx) = std::sync::mpsc::sync_channel(2);
            captures.push(win::start_capture(Source::Window(hwnd), tx)?);
            feeds.push((m.clone(), rx));
            monitors.push(m);
        }
        FrameSource::Synthetic(rect) => {
            let m = Arc::new(MonitorFrames::new(rect, 1.0));
            monitors.push(m.clone());
            let (w, h) = (rect.w as usize, rect.h as usize);
            let stop2 = stop.clone();
            std::thread::spawn(move || {
                let mut i = 0usize;
                while !stop2.load(Ordering::SeqCst) {
                    let mut px = vec![255u8; w * h * 4];
                    // A moving bar: the picture changes all the time, so its age is visible in the tests.
                    let x0 = (i * 7) % w.max(1);
                    for y in 0..h {
                        for x in x0..(x0 + 8).min(w) {
                            let k = (y * w + x) * 4;
                            px[k..k + 3].copy_from_slice(&[30, 60, 200]);
                        }
                    }
                    m.push(px, w, h);
                    i += 1;
                    std::thread::sleep(Duration::from_millis(60));
                }
            });
        }
    }
    for (m, rx) in feeds {
        let stop2 = stop.clone();
        std::thread::spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok((bgra, w, h)) => m.push(bgra, w, h),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => break,
                }
            }
        });
    }
    Ok(Frames {
        monitors,
        _captures: Mutex::new(captures),
        stop,
    })
}

#[cfg(not(windows))]
fn start_frames(_: FrameSource) -> Result<Frames, String> {
    Err("Documents mode needs Windows.".into())
}

// --- what the pipeline needs to know about the settings -------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RecSettings {
    pub auto: bool,
    pub typing: bool,
    pub shortcuts: bool,
    pub enter_tab: bool,
    pub zoom_default: bool,
    pub lang: String,
    /// Development tests: clicks inside Snipmunk's own (test) windows count.
    pub allow_own: bool,
}

impl RecSettings {
    pub fn from_app(app: &AppHandle) -> Self {
        let s = app
            .state::<crate::commands::AppState>()
            .settings
            .lock()
            .unwrap()
            .clone();
        Self {
            auto: s.doc_step_mode == "auto",
            typing: s.doc_record_typing,
            shortcuts: s.doc_record_shortcuts,
            enter_tab: s.doc_enter_tab,
            zoom_default: s.doc_zoom_default,
            lang: crate::language::resolve(&s.language).to_string(),
            allow_own: false,
        }
    }
}

// --- the recorder state and its commands ---------------------------------------------------------------------------------------------

struct Active {
    id: String,
    tx: Sender<Raw>,
    paused: Arc<AtomicBool>,
    count: Arc<AtomicU32>,
    frames: Arc<Frames>,
    thread: Option<std::thread::JoinHandle<()>>,
    #[cfg(windows)]
    hooks: Option<hooks::Hooks>,
}

#[derive(Default)]
pub struct GuideRec {
    active: Mutex<Option<Active>>,
}

/// What the bar and the page are told.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideState {
    pub recording: bool,
    pub paused: bool,
    pub steps: u32,
    pub id: String,
}

impl GuideRec {
    pub fn state(&self) -> GuideState {
        match self.active.try_lock() {
            Ok(g) => match g.as_ref() {
                Some(a) => GuideState {
                    recording: true,
                    paused: a.paused.load(Ordering::SeqCst),
                    steps: a.count.load(Ordering::SeqCst),
                    id: a.id.clone(),
                },
                None => GuideState {
                    recording: false,
                    paused: false,
                    steps: 0,
                    id: String::new(),
                },
            },
            // (a command polled by a page never waits for the lock)
            Err(_) => GuideState {
                recording: true,
                paused: false,
                steps: 0,
                id: String::new(),
            },
        }
    }
}

pub fn is_recording(app: &AppHandle) -> bool {
    app.try_state::<GuideRec>()
        .is_some_and(|g| g.state().recording)
}

fn announce(app: &AppHandle) {
    let st = app.state::<GuideRec>().state();
    let _ = app.emit("guide-state", st);
}

/// "Guide 2026-11-22 14:05" (local time).
#[cfg(windows)]
fn default_title() -> String {
    // SAFETY: a plain query of the clock.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "Guide {:04}-{:02}-{:02} {:02}:{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute
    )
}

#[cfg(not(windows))]
fn default_title() -> String {
    "Guide".into()
}

/// Start recording a guide (after the countdown, from its own thread): the live pictures, the pipeline, the hooks, the bar.
#[tauri::command]
pub async fn guide_start(app: AppHandle) -> CmdResult<String> {
    start_with(app, FrameSource::Monitors, false, true).await
}

/// The common start. `real_hooks`: install the hooks (never in the tests). `with_ui`: hide the window and show the bar.
pub async fn start_with(
    app: AppHandle,
    src: FrameSource,
    dev: bool,
    real_hooks: bool,
) -> CmdResult<String> {
    if app.state::<GuideRec>().active.lock().unwrap().is_some()
        || crate::recording::is_recording(&app)
    {
        return Err(CmdError::new("busy", "a recording is running already"));
    }
    let settings = {
        let mut s = RecSettings::from_app(&app);
        s.allow_own = dev;
        s
    };
    let app2 = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || -> CmdResult<String> {
        let app = app2;
        // The countdown of the recording is used (Settings → Recording); the dev tests have none.
        if real_hooks {
            let n = app.state::<crate::commands::AppState>().settings.lock().unwrap().rec_countdown;
            for left in (1..=n).rev() {
                let _ = app.emit("guide-countdown", left);
                std::thread::sleep(Duration::from_secs(1));
            }
            let _ = app.emit("guide-countdown", 0);
        }
        let frames = Arc::new(start_frames(src).map_err(|e| CmdError::new("capture", e))?);
        let info = guides::create(&default_title(), serde_json::json!({
            "stepMode": if settings.auto { "auto" } else { "manual" }, "typing": settings.typing,
            "shortcuts": settings.shortcuts, "enterTab": settings.enter_tab, "zoom": settings.zoom_default, "lang": settings.lang,
        }))?;
        let (tx, rx) = std::sync::mpsc::channel::<Raw>();
        let paused = Arc::new(AtomicBool::new(false));
        let count = Arc::new(AtomicU32::new(0));
        let thread = {
            let (app, frames, paused, count, id) = (app.clone(), frames.clone(), paused.clone(), count.clone(), info.id.clone());
            std::thread::spawn(move || pipeline(app, id, rx, frames, settings, paused, count))
        };
        #[cfg(windows)]
        let hooks = if real_hooks { hooks::Hooks::install(tx.clone(), paused.clone()).ok() } else { None };
        let active = Active {
            id: info.id.clone(),
            tx,
            paused,
            count,
            frames,
            thread: Some(thread),
            #[cfg(windows)]
            hooks,
        };
        *app.state::<GuideRec>().active.lock().unwrap() = Some(active);
        announce(&app);
        Ok(info.id)
    })
    .await
    .map_err(|e| CmdError::new("io", e.to_string()))??;
    if real_hooks {
        ui_start(&app);
    }
    Ok(id)
}

/// The window goes away and the bar appears (like a recording). Called after the state lock is released.
fn ui_start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Snipmunk's window goes away (a window that was hidden stays hidden), as when recording.
        if let Some(w) = app.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
                let _ = w.minimize();
            }
        }
        show_bar(&app);
    });
}

#[cfg(windows)]
fn show_bar(app: &AppHandle) {
    let (x, y, scale) = hooks::primary_top().unwrap_or((0, 0, 1.0));
    let (w, h) = ((460.0 * scale) as u32, (76.0 * scale) as u32);
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "guidebar",
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
        let _ = win.set_position(tauri::PhysicalPosition::new(
            x - w as i32 / 2,
            y + (12.0 * scale) as i32,
        ));
        crate::webview::exclude_from_capture(&win);
        crate::scrollshot::win::no_activate(&win);
        crate::scrollshot::win::show_no_activate(&win);
    }
}

#[cfg(not(windows))]
fn show_bar(_: &AppHandle) {}

fn close_bar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("guidebar") {
        let _ = w.close();
    }
}

fn with_active<R>(app: &AppHandle, f: impl FnOnce(&Active) -> R) -> Option<R> {
    app.state::<GuideRec>()
        .active
        .lock()
        .unwrap()
        .as_ref()
        .map(f)
}

#[tauri::command]
pub fn guide_pause(app: AppHandle) {
    with_active(&app, |a| a.paused.store(true, Ordering::SeqCst));
    announce(&app);
}

#[tauri::command]
pub fn guide_resume(app: AppHandle) {
    with_active(&app, |a| a.paused.store(false, Ordering::SeqCst));
    announce(&app);
}

/// "Take step" (the bar's button, the step hotkey): a step at the pointer now.
#[tauri::command]
pub fn guide_take_step(app: AppHandle) {
    take_step(&app);
}

pub fn take_step(app: &AppHandle) {
    let (x, y) = pointer();
    with_active(app, |a| {
        if !a.paused.load(Ordering::SeqCst) {
            let _ = a.tx.send(Raw::Take {
                x,
                y,
                at: Instant::now(),
            });
        }
    });
}

#[cfg(windows)]
fn pointer() -> (i32, i32) {
    hooks::cursor_pos()
}

#[cfg(not(windows))]
fn pointer() -> (i32, i32) {
    (0, 0)
}

/// The bar tells its size (CSS pixels) whenever its content changes: the window follows, around the same centre.
#[tauri::command]
pub async fn guide_bar_fit(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    let Some(w) = app.get_webview_window("guidebar") else {
        return Ok(());
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let (nw, nh) = (
        (width * scale).ceil() as u32,
        (height * scale).ceil() as u32,
    );
    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
        let cx = pos.x + size.width as i32 / 2;
        let _ = w.set_size(tauri::PhysicalSize::new(nw, nh));
        let _ = w.set_position(tauri::PhysicalPosition::new(cx - nw as i32 / 2, pos.y));
    }
    Ok(())
}

#[tauri::command]
pub fn guide_state(app: AppHandle) -> GuideState {
    app.state::<GuideRec>().state()
}

fn end(app: &AppHandle, keep: bool) -> Option<String> {
    // The recorder is taken out of the state first: no lock is held while the threads end and the windows change.
    let mut a = app.state::<GuideRec>().active.lock().unwrap().take()?;
    #[cfg(windows)]
    drop(a.hooks.take());
    let _ = a.tx.send(Raw::Stop);
    if let Some(t) = a.thread.take() {
        let _ = t.join();
    }
    a.frames.stop();
    let id = a.id.clone();
    if keep {
        let _ = guides::finalize(&id);
    } else {
        let _ = guides::guide_delete(id.clone());
    }
    announce(app);
    Some(id)
}

/// Stop: the guide is finished and opened in the guide view.
#[tauri::command]
pub async fn guide_stop(app: AppHandle) -> CmdResult<Option<String>> {
    let a2 = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || end(&a2, true))
        .await
        .map_err(|e| CmdError::new("io", e.to_string()))?;
    close_bar(&app);
    crate::tray::show_main(&app);
    if let Some(id) = &id {
        let _ = app.emit("guide-finished", id);
    }
    Ok(id)
}

/// Cancel: the guide is deleted (the page has asked first).
#[tauri::command]
pub async fn guide_cancel(app: AppHandle) -> CmdResult<()> {
    let a2 = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || end(&a2, false)).await;
    close_bar(&app);
    crate::tray::show_main(&app);
    let _ = app.emit("guide-finished", "");
    Ok(())
}

// --- the pipeline ------------------------------------------------------------------------------------------------------------------------

struct Snapshot {
    at: Instant,
    pt: (i32, i32),
    monitor: usize,
    frame: Option<(Arc<Vec<u8>>, usize, usize, u64)>,
    win: Option<WinFacts>,
    uia: Option<UiaFacts>,
}

#[derive(Debug, Clone, Default)]
pub struct WinFacts {
    pub hwnd: isize,
    /// Screen coordinates.
    pub rect: [i32; 4],
    pub title: String,
    pub process: String,
    #[allow(dead_code)]
    pub pid: u32,
}

#[derive(Debug, Clone, Default)]
pub struct UiaFacts {
    pub name: String,
    pub control: String,
    pub localized: String,
    pub automation_id: String,
    pub toggle: Option<bool>,
    pub selected: Option<bool>,
    /// Screen coordinates.
    pub rect: [i32; 4],
    pub parents: Vec<String>,
    pub menu_path: Vec<String>,
}

struct Pipe {
    app: AppHandle,
    id: String,
    settings: RecSettings,
    frames: Arc<Frames>,
    paused: Arc<AtomicBool>,
    count: Arc<AtomicU32>,
    uia: facts::Uia,
    n: u32,
    pending: Option<(PendingClick, Snapshot)>,
    typing: TypeGroup,
    typing_facts: Option<Snapshot>,
    last_hwnd: isize,
    hint_sent: bool,
    own_pid: u32,
    /// In the development tests the pointer is where the last injected event was (the real pointer is never read).
    dev_pointer: (i32, i32),
}

const DOUBLE: Duration = Duration::from_millis(500);
const SLOP: i32 = 4;

fn pipeline(
    app: AppHandle,
    id: String,
    rx: Receiver<Raw>,
    frames: Arc<Frames>,
    settings: RecSettings,
    paused: Arc<AtomicBool>,
    count: Arc<AtomicU32>,
) {
    let mut p = Pipe {
        app,
        id,
        settings,
        frames,
        paused,
        count,
        uia: facts::Uia::start(),
        n: 0,
        pending: None,
        typing: TypeGroup::default(),
        typing_facts: None,
        last_hwnd: 0,
        hint_sent: false,
        own_pid: std::process::id(),
        dev_pointer: (0, 0),
    };
    let mut last_poll = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Raw::Stop) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                p.flush_pending();
                p.flush_typing();
                return;
            }
            Ok(ev) => p.event(ev),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        if p.pending
            .as_ref()
            .is_some_and(|(c, _)| now.saturating_duration_since(c.at) > DOUBLE)
        {
            p.flush_pending();
        }
        if p.typing.idle(now, TYPE_IDLE) {
            p.flush_typing();
        }
        // An app that runs as administrator does not show its input to the hooks: one hint on the bar.
        if now.duration_since(last_poll) > Duration::from_secs(1) {
            last_poll = now;
            if !p.hint_sent && !p.settings.allow_own && facts::foreground_is_elevated() {
                p.hint_sent = true;
                let _ = p.app.emit("guide-hint", "elevated");
            }
        }
    }
}

impl Pipe {
    fn event(&mut self, ev: Raw) {
        if self.paused.load(Ordering::SeqCst) {
            return;
        }
        match ev {
            Raw::Mouse { button, x, y, at } => {
                self.dev_pointer = (x, y);
                if !self.settings.auto || self.is_own(x, y) {
                    return;
                }
                self.flush_typing_at(at);
                match button {
                    Button::Left => {
                        if let Some((first, _)) = &self.pending {
                            if is_double(first, x, y, at, DOUBLE, SLOP) {
                                let (_, snap) = self.pending.take().unwrap();
                                self.commit(snap, Kind::DoubleClick, None, None);
                                return;
                            }
                            self.flush_pending();
                        }
                        let snap = self.snapshot((x, y), at);
                        self.pending = Some((PendingClick { at, x, y }, snap));
                    }
                    Button::Right | Button::Middle => {
                        self.flush_pending();
                        let snap = self.snapshot((x, y), at);
                        let kind = if button == Button::Right {
                            Kind::RightClick
                        } else {
                            Kind::Click
                        };
                        self.commit(snap, kind, None, None);
                    }
                }
            }
            Raw::Take { x, y, at } => {
                self.dev_pointer = (x, y);
                if self.is_own(x, y) {
                    return;
                }
                self.flush_pending();
                self.flush_typing_at(at);
                let snap = self.snapshot((x, y), at);
                self.commit(snap, Kind::Click, None, None);
            }
            Raw::Key {
                vk,
                scan,
                mods,
                hkl,
                at,
            } => self.key(vk, scan, mods, hkl, at),
            Raw::Stop => {}
        }
    }

    fn pointer_now(&self) -> (i32, i32) {
        if self.settings.allow_own {
            self.dev_pointer
        } else {
            pointer()
        }
    }

    fn is_own(&self, x: i32, y: i32) -> bool {
        !self.settings.allow_own && facts::point_belongs_to(x, y, self.own_pid)
    }

    fn key(&mut self, vk: u32, scan: u32, mods: Mods, hkl: isize, at: Instant) {
        if is_modifier(vk) {
            return;
        }
        let ctrl_only = mods.ctrl && !mods.alt;
        let shortcut = ctrl_only || (mods.alt && !mods.ctrl) || mods.win;
        if shortcut {
            self.flush_pending();
            self.flush_typing_at(at);
            if self.settings.shortcuts {
                let (x, y) = self.pointer_now();
                let snap = self.snapshot((x, y), at);
                let keys = shortcut_name(mods, &key_name(vk));
                self.commit(snap, Kind::Key, None, Some(keys));
            }
            return;
        }
        if vk == 0x0D || vk == 0x09 {
            self.flush_pending();
            self.flush_typing_at(at);
            if self.settings.enter_tab {
                let (x, y) = self.pointer_now();
                let snap = self.snapshot((x, y), at);
                self.commit(snap, Kind::Key, None, Some(key_name(vk)));
            }
            return;
        }
        if !self.settings.typing {
            return;
        }
        if vk == 0x08 {
            if !self.typing.is_empty() {
                self.typing.backspace(at);
            }
            return;
        }
        let text = facts::to_text(vk, scan, mods, hkl);
        if text.is_empty() {
            return;
        }
        self.flush_pending();
        if self.typing.is_empty() {
            // The element that has the focus at the first character is the field of the group.
            let (x, y) = self.pointer_now();
            self.typing_facts = Some(self.snapshot_focus((x, y), at));
        }
        self.typing.push(&text, at);
    }

    fn flush_pending(&mut self) {
        if let Some((_, snap)) = self.pending.take() {
            self.commit(snap, Kind::Click, None, None);
        }
    }

    fn flush_typing(&mut self) {
        let at = Instant::now();
        self.flush_typing_at(at);
    }

    fn flush_typing_at(&mut self, at: Instant) {
        if self.typing.is_empty() {
            self.typing = TypeGroup::default();
            self.typing_facts = None;
            return;
        }
        let text = std::mem::take(&mut self.typing.text);
        self.typing = TypeGroup::default();
        if let Some(mut snap) = self.typing_facts.take() {
            // The picture of a typing step is taken at its end: it shows the typed text.
            let mi = snap.monitor;
            snap.frame = self.frames.monitors.get(mi).and_then(|m| m.at(at));
            snap.at = at;
            self.commit(snap, Kind::Type, Some(text), None);
        }
    }

    /// What there is at a point at the time of a click: the picture, the window and the element.
    fn snapshot(&mut self, pt: (i32, i32), at: Instant) -> Snapshot {
        let monitor = self.frames.monitor_for(pt.0, pt.1);
        let frame = self.frames.monitors.get(monitor).and_then(|m| m.at(at));
        let win = facts::window_at(pt.0, pt.1);
        let uia = self.uia.at_point(pt.0, pt.1, Duration::from_millis(300));
        Snapshot {
            at,
            pt,
            monitor,
            frame,
            win,
            uia,
        }
    }

    /// The same for typing: the element that has the focus.
    fn snapshot_focus(&mut self, pt: (i32, i32), at: Instant) -> Snapshot {
        let mut s = self.snapshot(pt, at);
        // (not in the tests: the focus of the real desktop is never asked)
        if !self.settings.allow_own {
            if let Some(f) = self.uia.focused(Duration::from_millis(300)) {
                s.uia = Some(f);
            }
        }
        s
    }

    fn commit(&mut self, snap: Snapshot, kind: Kind, typed: Option<String>, keys: Option<String>) {
        let Some((bgra, fw, fh, age)) = snap.frame.clone() else {
            return;
        };
        let mon = &self.frames.monitors[snap.monitor];
        let origin = (mon.rect.x, mon.rect.y);
        let to_frame = |r: [i32; 4]| [r[0] - origin.0, r[1] - origin.1, r[2], r[3]];
        self.n += 1;
        let n = self.n;
        let image = format!("step-{n:04}.png");
        // The picture: PNG, fast compression (lossless, so text stays crisp for annotations).
        let mut rgba = bgra.as_ref().clone();
        #[allow(clippy::chunks_exact_to_as_chunks)]
        for px in rgba.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }
        if let Some(img) = image::RgbaImage::from_raw(fw as u32, fh as u32, rgba) {
            if let Ok(png) =
                crate::thumbs::png_bytes(&img, image::codecs::png::CompressionType::Fast)
            {
                let _ = guides::write_image(&self.id, &image, &png);
            }
        }
        let click = matches!(kind, Kind::Click | Kind::RightClick | Kind::DoubleClick)
            .then(|| [snap.pt.0 - origin.0, snap.pt.1 - origin.1]);
        let window = snap.win.as_ref().map(|w| WindowInfo {
            rect: to_frame(w.rect),
            title: w.title.clone(),
            process: w.process.clone(),
        });
        let element = snap.uia.as_ref().map(|u| ElementInfo {
            name: u.name.clone(),
            control_type: u.control.clone(),
            localized_control_type: u.localized.clone(),
            automation_id: u.automation_id.clone(),
            toggle: u.toggle,
            selected: u.selected,
            rect: to_frame(u.rect),
            parents: u.parents.clone(),
        });
        let hwnd = snap.win.as_ref().map_or(0, |w| w.hwnd);
        let new_window = hwnd != 0 && hwnd != self.last_hwnd;
        if hwnd != 0 {
            self.last_hwnd = hwnd;
        }
        let window_name = snap
            .win
            .as_ref()
            .map(|w| {
                if w.title.trim().is_empty() {
                    w.process.clone()
                } else {
                    w.title.clone()
                }
            })
            .unwrap_or_default();
        let meta = Meta {
            control: snap
                .uia
                .as_ref()
                .map(|u| u.control.clone())
                .unwrap_or_default(),
            name: snap
                .uia
                .as_ref()
                .map(|u| u.name.clone())
                .unwrap_or_default(),
            menu_path: snap
                .uia
                .as_ref()
                .map(|u| u.menu_path.clone())
                .unwrap_or_default(),
            toggle_before: snap.uia.as_ref().and_then(|u| u.toggle),
            window: window_name,
            new_window,
            typed: typed.clone().unwrap_or_default(),
            keys: keys.clone().unwrap_or_default(),
        };
        let text = steptext::step_text(kind, &meta, &self.settings.lang);
        let zoom = click.map(|c| {
            guides::default_zoom(c, window.as_ref().map(|w| w.rect), [fw as u32, fh as u32])
        });
        let step = Step {
            n,
            op: String::new(),
            kind: Some(kind),
            t: guides::now_ms(),
            monitor: [mon.rect.x, mon.rect.y, mon.rect.w as i32, mon.rect.h as i32],
            scale: mon.scale,
            image,
            image_size: [fw as u32, fh as u32],
            click,
            window,
            element,
            typed,
            keys,
            zoom,
            text,
            frame_age_ms: age,
            deleted: false,
        };
        if guides::append_line(&self.id, &step).is_ok() {
            self.count.store(n, Ordering::SeqCst);
            let _ = self.app.emit("guide-step", n);
            announce(&self.app);
        }
    }
}

// --- development-only entry points (the tests) --------------------------------------------------------------------------------------

/// One synthetic event for `dev_guide_inject`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Inject {
    Mouse {
        button: Button,
        x: i32,
        y: i32,
    },
    /// A key with the modifiers; `layout`: "en" (US) or "de" (German).
    Key {
        vk: u32,
        #[serde(default)]
        mods: Mods,
        #[serde(default)]
        layout: String,
    },
    Take {
        x: i32,
        y: i32,
    },
    /// Wait this many milliseconds before the next event (the time between events is real).
    Wait {
        ms: u64,
    },
}

/// Development only: start a guide that takes its pictures from `source` ("synthetic" with a rect, or a window handle) and whose
/// events come from `dev_guide_inject`; no hook is installed.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn dev_guide_start(
    app: AppHandle,
    hwnd: Option<isize>,
    rect: Option<[i32; 4]>,
) -> CmdResult<String> {
    let src = match (hwnd, rect) {
        (Some(h), _) => FrameSource::Window(h),
        (None, Some(r)) => FrameSource::Synthetic(Rect::new(r[0], r[1], r[2] as u32, r[3] as u32)),
        _ => FrameSource::Synthetic(Rect::new(0, 0, 640, 360)),
    };
    start_with(app, src, true, false).await
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn dev_guide_inject(app: AppHandle, events: Vec<Inject>) -> CmdResult<u32> {
    let tx = with_active(&app, |a| a.tx.clone())
        .ok_or_else(|| CmdError::new("busy", "no guide is recording"))?;
    let n = tauri::async_runtime::spawn_blocking(move || {
        let mut sent = 0;
        for e in events {
            let at = Instant::now();
            match e {
                Inject::Wait { ms } => std::thread::sleep(Duration::from_millis(ms)),
                Inject::Mouse { button, x, y } => {
                    let _ = tx.send(Raw::Mouse { button, x, y, at });
                    sent += 1;
                }
                Inject::Take { x, y } => {
                    let _ = tx.send(Raw::Take { x, y, at });
                    sent += 1;
                }
                Inject::Key { vk, mods, layout } => {
                    let hkl = facts::layout_handle(&layout);
                    let _ = tx.send(Raw::Key {
                        vk,
                        scan: 0,
                        mods,
                        hkl,
                        at,
                    });
                    sent += 1;
                }
            }
        }
        sent
    })
    .await
    .map_err(|e| CmdError::new("io", e.to_string()))?;
    Ok(n)
}

/// Development only: show or close the floating bar alone (to look at it; no hook, no recording).
#[cfg(debug_assertions)]
#[tauri::command]
pub fn dev_guide_bar(app: AppHandle, show: bool) {
    std::thread::spawn(move || {
        if show {
            show_bar(&app);
        } else {
            close_bar(&app);
        }
    });
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn dev_guide_bar() -> CmdResult<()> {
    Err(CmdError::new("unavailable", "development builds only"))
}

/// Development only: install both hooks and take them away again at once (the events they see are thrown away unread).
#[cfg(all(windows, debug_assertions))]
#[tauri::command]
pub fn dev_guide_hook_test() -> serde_json::Value {
    let (tx, rx) = std::sync::mpsc::channel::<Raw>();
    let paused = Arc::new(AtomicBool::new(true));
    // Paused: the callbacks drop every event, so nothing of the user's input is even copied.
    match hooks::Hooks::install(tx, paused) {
        Ok(h) => {
            std::thread::sleep(Duration::from_millis(200));
            drop(h);
            serde_json::json!({ "installed": true, "uninstalled": true, "events": rx.try_iter().count() })
        }
        Err(e) => serde_json::json!({ "installed": false, "error": e }),
    }
}

#[cfg(not(all(windows, debug_assertions)))]
#[tauri::command]
pub fn dev_guide_hook_test() -> CmdResult<()> {
    Err(CmdError::new("unavailable", "development builds only"))
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn dev_guide_start() -> CmdResult<()> {
    Err(CmdError::new("unavailable", "development builds only"))
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn dev_guide_inject() -> CmdResult<()> {
    Err(CmdError::new("unavailable", "development builds only"))
}

// --- Windows: hooks, UI Automation, window facts ---------------------------------------------------------------------------------

#[cfg(windows)]
pub mod hooks {
    use super::{Button, Mods, Raw};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::{Arc, Mutex};
    use std::time::Instant;
    use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetKeyboardLayout};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, PostThreadMessageW,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG,
        MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_MBUTTONDOWN,
        WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN,
    };

    /// What the callbacks send to: a sender and the pause flag. `try_lock`: a callback never waits.
    static OUT: Mutex<Option<(Sender<Raw>, Arc<AtomicBool>)>> = Mutex::new(None);

    pub fn cursor_pos() -> (i32, i32) {
        let mut p = POINT::default();
        // SAFETY: a valid out pointer.
        unsafe {
            let _ = GetCursorPos(&mut p);
        }
        (p.x, p.y)
    }

    /// The top centre of the primary monitor and its scale (for the bar).
    pub fn primary_top() -> Option<(i32, i32, f64)> {
        let m = crate::scrollshot::win::monitor_rect_at(0, 0)?;
        let scale = crate::scrollshot::win::scale_at(0, 0);
        Some((m.x + m.w as i32 / 2, m.y, scale))
    }

    fn mods_now() -> Mods {
        let down = |vk: i32| unsafe { GetAsyncKeyState(vk) as u16 & 0x8000 != 0 };
        Mods {
            shift: down(0x10),
            ctrl: down(0x11),
            alt: down(0x12),
            win: down(0x5B) || down(0x5C),
            caps: unsafe { GetAsyncKeyState(0x14) as u16 & 1 != 0 },
        }
    }

    unsafe extern "system" fn mouse_proc(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code >= 0 {
            let button = match wp.0 as u32 {
                WM_LBUTTONDOWN => Some(Button::Left),
                WM_RBUTTONDOWN => Some(Button::Right),
                WM_MBUTTONDOWN => Some(Button::Middle),
                _ => None,
            };
            if let Some(button) = button {
                if let Ok(g) = OUT.try_lock() {
                    if let Some((tx, paused)) = g.as_ref() {
                        if !paused.load(Ordering::Relaxed) {
                            // SAFETY: for WH_MOUSE_LL lParam points to an MSLLHOOKSTRUCT.
                            let s = unsafe { &*(lp.0 as *const MSLLHOOKSTRUCT) };
                            let _ = tx.send(Raw::Mouse {
                                button,
                                x: s.pt.x,
                                y: s.pt.y,
                                at: Instant::now(),
                            });
                        }
                    }
                }
            }
        }
        // SAFETY: passing the event on, as a hook must.
        unsafe { CallNextHookEx(None, code, wp, lp) }
    }

    unsafe extern "system" fn key_proc(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code >= 0 && (wp.0 as u32 == WM_KEYDOWN || wp.0 as u32 == WM_SYSKEYDOWN) {
            if let Ok(g) = OUT.try_lock() {
                if let Some((tx, paused)) = g.as_ref() {
                    if !paused.load(Ordering::Relaxed) {
                        // SAFETY: for WH_KEYBOARD_LL lParam points to a KBDLLHOOKSTRUCT.
                        let s = unsafe { &*(lp.0 as *const KBDLLHOOKSTRUCT) };
                        // The layout of the window that has the focus: it decides which character the key makes.
                        let hkl = unsafe { GetKeyboardLayout(0) }.0 as isize;
                        let _ = tx.send(Raw::Key {
                            vk: s.vkCode,
                            scan: s.scanCode,
                            mods: mods_now(),
                            hkl,
                            at: Instant::now(),
                        });
                    }
                }
            }
        }
        // SAFETY: passing the event on, as a hook must.
        unsafe { CallNextHookEx(None, code, wp, lp) }
    }

    /// The two hooks on their own thread. Dropping it removes them.
    pub struct Hooks {
        thread: Option<std::thread::JoinHandle<()>>,
        thread_id: u32,
    }

    impl Hooks {
        pub fn install(tx: Sender<Raw>, paused: Arc<AtomicBool>) -> Result<Self, String> {
            *OUT.lock().unwrap_or_else(|e| e.into_inner()) = Some((tx, paused));
            let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
            let thread = std::thread::spawn(move || {
                // SAFETY: hooks are installed, pumped and removed on this thread only.
                unsafe {
                    let id = windows::Win32::System::Threading::GetCurrentThreadId();
                    let hi = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).ok();
                    let m: Result<HHOOK, _> =
                        SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hi.map(|h| h.into()), 0);
                    let k: Result<HHOOK, _> =
                        SetWindowsHookExW(WH_KEYBOARD_LL, Some(key_proc), hi.map(|h| h.into()), 0);
                    match (&m, &k) {
                        (Ok(_), Ok(_)) => {
                            let _ = ready_tx.send(Ok(id));
                        }
                        _ => {
                            let _ =
                                ready_tx.send(Err("the input hooks could not be installed".into()));
                        }
                    }
                    let mut msg = MSG::default();
                    if m.is_ok() && k.is_ok() {
                        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    }
                    if let Ok(h) = m {
                        let _ = UnhookWindowsHookEx(h);
                    }
                    if let Ok(h) = k {
                        let _ = UnhookWindowsHookEx(h);
                    }
                }
            });
            match ready_rx.recv_timeout(std::time::Duration::from_secs(3)) {
                Ok(Ok(id)) => Ok(Self {
                    thread: Some(thread),
                    thread_id: id,
                }),
                Ok(Err(e)) => {
                    *OUT.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    Err(e)
                }
                Err(e) => Err(e.to_string()),
            }
        }
    }

    impl Drop for Hooks {
        fn drop(&mut self) {
            *OUT.lock().unwrap_or_else(|e| e.into_inner()) = None;
            // SAFETY: a thread message to the hook thread, which then leaves its loop.
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }
}

#[cfg(windows)]
mod facts {
    use super::{UiaFacts, WinFacts};
    use std::sync::mpsc::{channel, Sender};
    use std::time::Duration;
    use windows::core::Interface;
    use windows::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationSelectionItemPattern,
        IUIAutomationTogglePattern, ToggleState_On, UIA_SelectionItemPatternId,
        UIA_TogglePatternId,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayout, LoadKeyboardLayoutW, MapVirtualKeyExW, ToUnicodeEx, HKL,
        KLF_NOTELLSHELL, MAPVK_VK_TO_VSC,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
        WindowFromPoint, GA_ROOT,
    };

    fn process_of(hwnd: HWND) -> (u32, String) {
        let mut pid = 0u32;
        // SAFETY: a window handle and a valid out pointer.
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let mut name = String::new();
        // SAFETY: the process handle is closed again; the buffer has the length it says.
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = [0u16; 520];
                let mut len = buf.len() as u32;
                if QueryFullProcessImageNameW(
                    h,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(buf.as_mut_ptr()),
                    &mut len,
                )
                .is_ok()
                {
                    let full = String::from_utf16_lossy(&buf[..len as usize]);
                    name = std::path::Path::new(&full)
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                }
                let _ = CloseHandle(h);
            }
        }
        (pid, name)
    }

    pub fn point_belongs_to(x: i32, y: i32, pid: u32) -> bool {
        // SAFETY: plain window queries.
        unsafe {
            let h = WindowFromPoint(POINT { x, y });
            if h.0.is_null() {
                return false;
            }
            let mut p = 0u32;
            GetWindowThreadProcessId(h, Some(&mut p));
            p == pid
        }
    }

    pub fn window_at(x: i32, y: i32) -> Option<WinFacts> {
        // SAFETY: plain window queries with valid out pointers.
        unsafe {
            let h = WindowFromPoint(POINT { x, y });
            if h.0.is_null() {
                return None;
            }
            let root = GetAncestor(h, GA_ROOT);
            let root = if root.0.is_null() { h } else { root };
            let mut r = RECT::default();
            let _ = GetWindowRect(root, &mut r);
            let mut buf = [0u16; 256];
            let n = GetWindowTextW(root, &mut buf);
            let (pid, process) = process_of(root);
            Some(WinFacts {
                hwnd: root.0 as isize,
                rect: [r.left, r.top, r.right - r.left, r.bottom - r.top],
                title: String::from_utf16_lossy(&buf[..n.max(0) as usize]),
                process,
                pid,
            })
        }
    }

    /// Does the foreground window belong to a process that runs as administrator while we do not?
    pub fn foreground_is_elevated() -> bool {
        // SAFETY: plain queries; the handles are closed again.
        unsafe {
            let fg = GetForegroundWindow();
            if fg.0.is_null() {
                return false;
            }
            let (pid, _) = process_of(fg);
            let elevated = |pid: u32| -> bool {
                let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                    return false;
                };
                let mut tok = windows::Win32::Foundation::HANDLE::default();
                let mut yes = false;
                if OpenProcessToken(h, TOKEN_QUERY, &mut tok).is_ok() {
                    let mut e = TOKEN_ELEVATION::default();
                    let mut ret = 0u32;
                    if GetTokenInformation(
                        tok,
                        TokenElevation,
                        Some(&mut e as *mut _ as *mut _),
                        std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                        &mut ret,
                    )
                    .is_ok()
                    {
                        yes = e.TokenIsElevated != 0;
                    }
                    let _ = CloseHandle(tok);
                }
                let _ = CloseHandle(h);
                yes
            };
            pid != std::process::id() && elevated(pid) && !elevated(std::process::id())
        }
    }

    /// The handle of a keyboard layout for the tests ("de", "en"); 0 = the one of the current thread.
    pub fn layout_handle(name: &str) -> isize {
        let id = match name {
            "de" => "00000407",
            "en" => "00000409",
            _ => return 0,
        };
        let w: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
        // SAFETY: a null-terminated layout id.
        unsafe {
            LoadKeyboardLayoutW(windows::core::PCWSTR(w.as_ptr()), KLF_NOTELLSHELL)
                .map(|h| h.0 as isize)
                .unwrap_or(0)
        }
    }

    /// The characters a key makes with the modifiers and the layout (dead keys wait for the next key).
    pub fn to_text(vk: u32, scan: u32, mods: super::Mods, hkl: isize) -> String {
        let hkl = if hkl == 0 {
            // SAFETY: a plain query.
            unsafe { GetKeyboardLayout(0) }
        } else {
            HKL(hkl as *mut _)
        };
        let mut state = [0u8; 256];
        if mods.shift {
            state[0x10] = 0x80;
        }
        if mods.ctrl {
            state[0x11] = 0x80;
        }
        if mods.alt {
            state[0x12] = 0x80;
        }
        if mods.caps {
            state[0x14] = 1;
        }
        // SAFETY: the buffers have the sizes the functions are told.
        unsafe {
            let scan = if scan == 0 {
                MapVirtualKeyExW(vk, MAPVK_VK_TO_VSC, Some(hkl))
            } else {
                scan
            };
            let mut buf = [0u16; 8];
            let n = ToUnicodeEx(vk, scan, &state, &mut buf, 0, Some(hkl));
            if n > 0 {
                let s = String::from_utf16_lossy(&buf[..n as usize]);
                // Control characters are not text.
                return s.chars().filter(|c| !c.is_control()).collect();
            }
        }
        String::new()
    }

    // --- UI Automation on its own thread ------------------------------------------------------------------------------------

    enum Req {
        Point(i32, i32, Sender<Option<UiaFacts>>),
        Focused(Sender<Option<UiaFacts>>),
    }

    pub struct Uia {
        tx: Sender<Req>,
    }

    fn control_word(id: i32) -> &'static str {
        match id {
            50000 => "Button",
            50002 => "CheckBox",
            50003 => "ComboBox",
            50004 => "Edit",
            50005 => "Hyperlink",
            50006 => "Image",
            50007 => "ListItem",
            50008 => "List",
            50009 => "Menu",
            50010 => "MenuBar",
            50011 => "MenuItem",
            50013 => "RadioButton",
            50018 => "Tab",
            50019 => "TabItem",
            50020 => "Text",
            50021 => "ToolBar",
            50023 => "Tree",
            50024 => "TreeItem",
            50025 => "Custom",
            50026 => "Group",
            50028 => "DataGrid",
            50029 => "DataItem",
            50030 => "Document",
            50031 => "SplitButton",
            50032 => "Window",
            50033 => "Pane",
            _ => "",
        }
    }

    fn describe(auto: &IUIAutomation, el: &IUIAutomationElement) -> Option<UiaFacts> {
        // SAFETY: COM calls on the UI Automation thread on elements that came from it.
        unsafe {
            let ct = el.CurrentControlType().ok()?.0;
            let r = el.CurrentBoundingRectangle().unwrap_or_default();
            let mut f = UiaFacts {
                name: el.CurrentName().map(|b| b.to_string()).unwrap_or_default(),
                control: control_word(ct).to_string(),
                localized: el
                    .CurrentLocalizedControlType()
                    .map(|b| b.to_string())
                    .unwrap_or_default(),
                automation_id: el
                    .CurrentAutomationId()
                    .map(|b| b.to_string())
                    .unwrap_or_default(),
                rect: [r.left, r.top, r.right - r.left, r.bottom - r.top],
                ..Default::default()
            };
            if let Ok(p) = el.GetCurrentPattern(UIA_TogglePatternId) {
                if let Ok(t) = p.cast::<IUIAutomationTogglePattern>() {
                    f.toggle = t.CurrentToggleState().ok().map(|s| s == ToggleState_On);
                }
            }
            if let Ok(p) = el.GetCurrentPattern(UIA_SelectionItemPatternId) {
                if let Ok(s) = p.cast::<IUIAutomationSelectionItemPattern>() {
                    f.selected = s.CurrentIsSelected().ok().map(|b| b.as_bool());
                }
            }
            // The nearest named parents (menu, dialog, tab ...) and the path of menus.
            if let Ok(walker) = auto.ControlViewWalker() {
                let mut cur = el.clone();
                for _ in 0..8 {
                    let Ok(parent) = walker.GetParentElement(&cur) else {
                        break;
                    };
                    let pct = parent.CurrentControlType().map(|c| c.0).unwrap_or(0);
                    let pname = parent
                        .CurrentName()
                        .map(|b| b.to_string())
                        .unwrap_or_default();
                    if !pname.trim().is_empty() {
                        match control_word(pct) {
                            "Menu" | "MenuItem" => f.menu_path.insert(0, pname.clone()),
                            "Tab" | "Window" | "Group" | "ToolBar" => {}
                            _ => {}
                        }
                        if matches!(
                            control_word(pct),
                            "Menu" | "Tab" | "Window" | "Group" | "ToolBar" | "MenuItem"
                        ) && f.parents.len() < 3
                        {
                            f.parents.insert(0, pname);
                        }
                    }
                    if control_word(pct) == "Window" {
                        break;
                    }
                    cur = parent;
                }
            }
            Some(f)
        }
    }

    impl Uia {
        pub fn start() -> Self {
            let (tx, rx) = channel::<Req>();
            std::thread::spawn(move || {
                // SAFETY: COM is initialised on this thread, which owns every UI Automation object.
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                    let Ok(auto) = CoCreateInstance::<_, IUIAutomation>(
                        &CUIAutomation,
                        None,
                        CLSCTX_INPROC_SERVER,
                    ) else {
                        for r in rx {
                            match r {
                                Req::Point(.., s) | Req::Focused(s) => {
                                    let _ = s.send(None);
                                }
                            }
                        }
                        return;
                    };
                    for r in rx {
                        match r {
                            Req::Point(x, y, s) => {
                                let f = auto
                                    .ElementFromPoint(POINT { x, y })
                                    .ok()
                                    .and_then(|e| describe(&auto, &e));
                                let _ = s.send(f);
                            }
                            Req::Focused(s) => {
                                let f = auto
                                    .GetFocusedElement()
                                    .ok()
                                    .and_then(|e| describe(&auto, &e));
                                let _ = s.send(f);
                            }
                        }
                    }
                }
            });
            Self { tx }
        }

        /// The element at a point; `None` when UI Automation is late or fails (the step still gets its picture).
        pub fn at_point(&self, x: i32, y: i32, limit: Duration) -> Option<UiaFacts> {
            let (s, r) = channel();
            self.tx.send(Req::Point(x, y, s)).ok()?;
            r.recv_timeout(limit).ok().flatten()
        }

        pub fn focused(&self, limit: Duration) -> Option<UiaFacts> {
            let (s, r) = channel();
            self.tx.send(Req::Focused(s)).ok()?;
            r.recv_timeout(limit).ok().flatten()
        }
    }
}

#[cfg(not(windows))]
mod facts {
    use super::{UiaFacts, WinFacts};
    use std::time::Duration;
    pub struct Uia;
    impl Uia {
        pub fn start() -> Self {
            Self
        }
        pub fn at_point(&self, _: i32, _: i32, _: Duration) -> Option<UiaFacts> {
            None
        }
        pub fn focused(&self, _: Duration) -> Option<UiaFacts> {
            None
        }
    }
    pub fn point_belongs_to(_: i32, _: i32, _: u32) -> bool {
        false
    }
    pub fn window_at(_: i32, _: i32) -> Option<WinFacts> {
        None
    }
    pub fn foreground_is_elevated() -> bool {
        false
    }
    pub fn layout_handle(_: &str) -> isize {
        0
    }
    pub fn to_text(_: u32, _: u32, _: super::Mods, _: isize) -> String {
        String::new()
    }
}

// --- development-only test windows and scenarios -------------------------------------------------------------------------------------

#[cfg(all(windows, debug_assertions))]
mod devtest {
    use super::*;
    use std::collections::HashMap;

    /// The screen position of the centre of each element of a test window.
    pub type Targets = HashMap<&'static str, (i32, i32)>;

    /// A native window: a button, an edit control, a check box and a list box, on its own thread with a message loop.
    pub fn native_window() -> Result<(isize, Targets), String> {
        use windows::core::w;
        use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowRect,
            RegisterClassW, SendMessageW, TranslateMessage, BS_AUTOCHECKBOX, BS_PUSHBUTTON,
            CS_HREDRAW, CS_VREDRAW, LBS_NOTIFY, MSG, WINDOW_STYLE, WNDCLASSW, WS_BORDER, WS_CHILD,
            WS_EX_TOPMOST, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        unsafe extern "system" fn proc(h: HWND, m: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
            // SAFETY: the standard window procedure contract.
            unsafe { DefWindowProcW(h, m, wp, lp) }
        }
        let (tx, rx) = std::sync::mpsc::channel::<Result<(isize, Targets), String>>();
        std::thread::spawn(move || {
            // SAFETY: Win32 window creation and a message loop on this thread only.
            unsafe {
                let hi = windows::Win32::System::LibraryLoader::GetModuleHandleW(None)
                    .unwrap_or_default();
                let class = w!("SnipmunkGuideTestNative");
                let wc = WNDCLASSW {
                    style: CS_HREDRAW | CS_VREDRAW,
                    lpfnWndProc: Some(proc),
                    hInstance: hi.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                RegisterClassW(&wc);
                let Ok(top) = CreateWindowExW(
                    WS_EX_TOPMOST,
                    class,
                    w!("Guide test window"),
                    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    60,
                    60,
                    520,
                    420,
                    None,
                    None,
                    Some(hi.into()),
                    None,
                ) else {
                    let _ = tx.send(Err("the test window could not be created".into()));
                    return;
                };
                let child = |class, text, style: u32, x, y, w, h| {
                    CreateWindowExW(
                        Default::default(),
                        class,
                        text,
                        WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0 | style),
                        x,
                        y,
                        w,
                        h,
                        Some(top),
                        None,
                        Some(hi.into()),
                        None,
                    )
                };
                let save = child(
                    w!("BUTTON"),
                    w!("Save"),
                    BS_PUSHBUTTON as u32,
                    20,
                    20,
                    100,
                    30,
                )
                .ok();
                let edit = child(w!("EDIT"), w!(""), WS_BORDER.0, 20, 70, 250, 26).ok();
                let check = child(
                    w!("BUTTON"),
                    w!("Remember me"),
                    BS_AUTOCHECKBOX as u32,
                    20,
                    110,
                    200,
                    24,
                )
                .ok();
                let list = child(
                    w!("LISTBOX"),
                    w!(""),
                    WS_BORDER.0 | LBS_NOTIFY as u32,
                    20,
                    150,
                    200,
                    100,
                )
                .ok();
                if let Some(l) = list {
                    for item in ["Hamburg", "Berlin", "Munich"] {
                        let wide: Vec<u16> = item.encode_utf16().chain(Some(0)).collect();
                        let _ = SendMessageW(l, 0x0180, None, Some(LPARAM(wide.as_ptr() as isize)));
                        // LB_ADDSTRING
                    }
                }
                let rect_of = |h: Option<HWND>| {
                    let mut r = RECT::default();
                    if let Some(h) = h {
                        let _ = GetWindowRect(h, &mut r);
                    }
                    r
                };
                let centre = |h: Option<HWND>| {
                    let r = rect_of(h);
                    ((r.left + r.right) / 2, (r.top + r.bottom) / 2)
                };
                let mut t: Targets = HashMap::new();
                t.insert("save", centre(save));
                t.insert("edit", centre(edit));
                t.insert("check", centre(check));
                // The second item of the list: Berlin.
                let lr = rect_of(list);
                t.insert("list", ((lr.left + lr.right) / 2, lr.top + 2 + 16 + 6));
                let _ = tx.send(Ok((top.0 as isize, t)));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }

    pub fn close(hwnd: isize) {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
        // SAFETY: a window of this process.
        unsafe {
            let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }

    const PAGE: &str = r##"<!doctype html><html><head><meta charset=utf-8><style>
body{margin:0;font:14px Segoe UI,sans-serif;background:#fff} .a{position:absolute}
button,input,select{font:inherit} [role=tab]{padding:4px 10px;border:1px solid #888;background:#eee}
[role=menu]{border:1px solid #888;background:#fff;padding:2px;width:130px}[role=menuitem]{padding:3px 8px}
</style></head><body>
<button class=a id=save style="left:20px;top:20px;width:100px;height:32px">Save</button>
<a class=a id=link href="#more" style="left:150px;top:26px">Learn more</a>
<label class=a id=check style="left:20px;top:70px;width:160px;height:24px"><input type=checkbox> Remember me</label>
<label class=a id=r1 style="left:20px;top:110px;width:100px;height:24px"><input type=radio name=c> Hamburg</label>
<label class=a id=r2 style="left:140px;top:110px;width:100px;height:24px"><input type=radio name=c> Berlin</label>
<input class=a id=city aria-label="City" style="left:20px;top:150px;width:200px;height:28px">
<select class=a id=country aria-label="Country" style="left:20px;top:200px;width:160px;height:28px"><option>Germany</option><option>France</option></select>
<div class=a role=tablist style="left:20px;top:250px"><span role=tab id=t1 tabindex=0>General</span><span role=tab id=t2 tabindex=0>Advanced</span></div>
<div class=a role=menu aria-label="File" style="left:20px;top:300px"><div role=menuitem id=m1 tabindex=0>Save as</div><div role=menuitem id=m2 tabindex=0>Open</div></div>
</body></html>"##;

    /// The page's elements as screen positions: (css left, top, width, height) scaled and shifted by the window's place.
    fn page_targets(origin: (i32, i32), dpr: f64) -> Targets {
        let at = |x: f64, y: f64, w: f64, h: f64| {
            (
                origin.0 + ((x + w / 2.0) * dpr) as i32,
                origin.1 + ((y + h / 2.0) * dpr) as i32,
            )
        };
        let mut t: Targets = HashMap::new();
        t.insert("save", at(20.0, 20.0, 100.0, 32.0));
        t.insert("link", at(150.0, 26.0, 70.0, 20.0));
        t.insert("check", at(20.0, 70.0, 20.0, 24.0));
        t.insert("radio", at(140.0, 110.0, 20.0, 24.0));
        t.insert("city", at(20.0, 150.0, 200.0, 28.0));
        t.insert("country", at(20.0, 200.0, 160.0, 28.0));
        t.insert("tab", at(20.0 + 70.0, 250.0, 80.0, 28.0));
        t.insert("menu", at(20.0, 300.0 + 2.0 + 26.0, 130.0, 24.0));
        t
    }

    fn type_text(text: &str, layout: &str) -> Vec<Inject> {
        let mut v = Vec::new();
        for c in text.chars() {
            let (vk, mods) = match c {
                'a'..='z' => (c.to_ascii_uppercase() as u32, Mods::default()),
                'A'..='Z' => (
                    c as u32,
                    Mods {
                        shift: true,
                        ..Default::default()
                    },
                ),
                '0'..='9' => (c as u32, Mods::default()),
                ' ' => (0x20, Mods::default()),
                'ä' => (0xDE, Mods::default()),
                'ö' => (0xC0, Mods::default()),
                'ü' => (0xBA, Mods::default()),
                'ß' => (0xDB, Mods::default()),
                '@' => (
                    0x51,
                    Mods {
                        ctrl: true,
                        alt: true,
                        ..Default::default()
                    },
                ),
                _ => continue,
            };
            v.push(Inject::Key {
                vk,
                mods,
                layout: layout.into(),
            });
            v.push(Inject::Wait { ms: 15 });
        }
        v
    }

    fn click(t: &Targets, name: &str, button: Button) -> Inject {
        let (x, y) = t[name];
        Inject::Mouse { button, x, y }
    }

    fn summary(id: &str) -> serde_json::Value {
        let steps = guides::read_steps(id);
        serde_json::json!({
            "guide": id,
            "steps": steps.iter().map(|s| serde_json::json!({
                "n": s.n, "kind": s.kind, "text": steptext::plain(&s.text),
                "bold": s.text.iter().filter(|p| p.b).map(|p| p.t.clone()).collect::<Vec<_>>(),
                "control": s.element.as_ref().map(|e| e.control_type.clone()), "name": s.element.as_ref().map(|e| e.name.clone()),
                "click": s.click, "image": s.image_size, "ageMs": s.frame_age_ms, "typed": s.typed, "keys": s.keys,
                "window": s.window.as_ref().map(|w| w.title.clone()), "zoom": s.zoom,
            })).collect::<Vec<_>>(),
            "count": steps.len(),
        })
    }

    async fn run_events(app: &AppHandle, hwnd: isize, events: Vec<Inject>) -> CmdResult<String> {
        let id = start_with(app.clone(), FrameSource::Window(hwnd), true, false).await?;
        // The live pictures need a moment to start.
        pause(900).await;
        dev_guide_inject(app.clone(), events).await?;
        pause(900).await;
        Ok(id)
    }

    async fn pause(ms: u64) {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(Duration::from_millis(ms))
        })
        .await;
    }

    /// Scenario "native" / "web" / "manual": see the report of the session. Returns the steps that were written.
    pub async fn scenario(
        app: AppHandle,
        kind: String,
        lang: Option<String>,
    ) -> CmdResult<serde_json::Value> {
        let lang = lang.unwrap_or_else(|| "en".into());
        crate::commands::patch_settings(
            &app,
            serde_json::json!({ "language": lang, "docStepMode": if kind == "manual" { "manual" } else { "auto" } }),
        )?;
        let (hwnd, targets, web) = if kind == "web" {
            let file = std::env::temp_dir().join("snipmunk-guide-test.html");
            std::fs::write(&file, PAGE).map_err(|e| CmdError::new("io", e.to_string()))?;
            let url = format!(
                "file:///{}",
                file.to_string_lossy()
                    .replace(std::path::MAIN_SEPARATOR, "/")
            )
            .parse::<tauri::Url>()
            .map_err(|e| CmdError::new("io", e.to_string()))?;
            let win = tauri::WebviewWindowBuilder::new(
                &app,
                "guidetest",
                tauri::WebviewUrl::External(url),
            )
            .title("Guide test page")
            .inner_size(640.0, 480.0)
            .position(60.0, 60.0)
            .always_on_top(true)
            .focused(false)
            .decorations(false)
            .build()
            .map_err(|e| CmdError::new("io", e.to_string()))?;
            pause(1800).await;
            let dpr = win.scale_factor().unwrap_or(1.0);
            let pos = win.inner_position().map(|p| (p.x, p.y)).unwrap_or((60, 60));
            let h = win
                .hwnd()
                .map_err(|e| CmdError::new("io", e.to_string()))?
                .0 as isize;
            (h, page_targets(pos, dpr), Some(win))
        } else {
            let (h, t) = native_window().map_err(|e| CmdError::new("io", e))?;
            pause(800).await;
            (h, t, None)
        };
        let ev = |ms| Inject::Wait { ms };
        let events: Vec<Inject> = if kind == "web" {
            let mut v = vec![
                click(&targets, "save", Button::Left),
                ev(700),
                click(&targets, "link", Button::Left),
                ev(700),
                click(&targets, "check", Button::Left),
                ev(700),
                click(&targets, "radio", Button::Left),
                ev(700),
                click(&targets, "city", Button::Left),
                ev(700),
            ];
            v.extend(type_text("Hamburg", "en"));
            v.extend([
                click(&targets, "tab", Button::Left),
                ev(700),
                click(&targets, "menu", Button::Left),
                ev(700),
                click(&targets, "country", Button::Left),
                ev(700),
            ]);
            v
        } else if kind == "manual" {
            vec![
                click(&targets, "save", Button::Left),
                ev(700), // ignored in manual mode
                Inject::Take {
                    x: targets["save"].0,
                    y: targets["save"].1,
                },
                ev(500),
                Inject::Take {
                    x: targets["check"].0,
                    y: targets["check"].1,
                },
                ev(500),
            ]
        } else {
            let ctrl = Mods {
                ctrl: true,
                ..Default::default()
            };
            let mut v = vec![
                click(&targets, "save", Button::Left),
                ev(700),
                click(&targets, "edit", Button::Left),
                ev(700),
            ];
            v.extend(type_text("Hamburg", "de"));
            v.extend(type_text(" äöß@", "de"));
            v.extend([
                // The click ends the typing group; the check box is then checked.
                click(&targets, "check", Button::Left),
                ev(700),
                click(&targets, "list", Button::Left),
                ev(700),
                // A double click: two clicks 120 ms apart are ONE step.
                click(&targets, "save", Button::Left),
                ev(120),
                click(&targets, "save", Button::Left),
                ev(900),
                click(&targets, "list", Button::Right),
                ev(700),
                Inject::Key {
                    vk: 0x53,
                    mods: ctrl,
                    layout: "en".into(),
                },
                ev(500),
            ]);
            v
        };
        let id = run_events(&app, hwnd, events).await?;
        let mut out = serde_json::Value::Null;
        if kind == "native" {
            // Pause: nothing is recorded; then it goes on.
            let steps_before = guides::read_steps(&id).len();
            guide_pause(app.clone());
            dev_guide_inject(
                app.clone(),
                vec![
                    click(&targets, "save", Button::Left),
                    Inject::Wait { ms: 700 },
                ],
            )
            .await?;
            let paused_steps = guides::read_steps(&id).len();
            guide_resume(app.clone());
            out = serde_json::json!({ "stepsBeforePause": steps_before, "stepsWhilePaused": paused_steps });
        }
        let _ = guide_stop(app.clone()).await?;
        let mut v = summary(&id);
        if let serde_json::Value::Object(m) = &mut v {
            if let serde_json::Value::Object(o) = out {
                m.extend(o);
            }
            let dir = guides::dir_of(&id);
            let sizes: Vec<u64> = std::fs::read_dir(&dir)
                .map(|rd| {
                    rd.flatten()
                        .filter(|e| e.path().extension().is_some_and(|x| x == "png"))
                        .filter_map(|e| e.metadata().ok())
                        .map(|m| m.len())
                        .collect()
                })
                .unwrap_or_default();
            m.insert("pngBytes".into(), serde_json::json!(sizes));
        }
        if let Some(w) = web {
            let _ = w.close();
        }
        close(hwnd);
        crate::commands::patch_settings(
            &app,
            serde_json::json!({ "docStepMode": "auto", "language": "system" }),
        )?;
        Ok(v)
    }
}

/// Development only: run a scenario against a test window ("native", "web" or "manual"); returns the steps that were written.
#[cfg(all(windows, debug_assertions))]
#[tauri::command]
pub async fn dev_guide_scenario(
    app: AppHandle,
    kind: String,
    lang: Option<String>,
) -> CmdResult<serde_json::Value> {
    devtest::scenario(app, kind, lang).await
}

#[cfg(not(all(windows, debug_assertions)))]
#[tauri::command]
pub fn dev_guide_scenario() -> CmdResult<()> {
    Err(CmdError::new("unavailable", "development builds only"))
}
