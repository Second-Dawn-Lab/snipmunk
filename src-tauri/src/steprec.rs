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
        /// Is the field it goes into secret (see `secret`)? `None`: not looked at, which counts as secret (except for
        /// the injected events of the tests).
        secret: Option<bool>,
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
    /// Part of it goes into a secret field: none of it is stored. Once set, it stays for the whole group.
    pub secret: bool,
}

impl TypeGroup {
    pub fn push(&mut self, s: &str, at: Instant, secret: bool) {
        self.secret |= secret;
        // (a secret is not kept in memory either: only how many characters there are, for Backspace)
        if self.secret {
            let count = self.text.chars().count() + s.chars().count();
            self.text = "•".repeat(count);
        } else {
            self.text.push_str(s);
        }
        self.last = Some(at);
    }
    /// What the step says was typed.
    pub fn written(&self) -> String {
        if self.secret {
            crate::secret::MASK.to_string()
        } else {
            self.text.clone()
        }
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

/// A key pressed with these modifiers is a shortcut, not typing. (Ctrl with Alt is AltGr, which types.)
pub fn is_shortcut(mods: Mods) -> bool {
    (mods.ctrl && !mods.alt) || (mods.alt && !mods.ctrl) || mods.win
}

/// May this key write text? Everything the recorder could add to a typing step (and so must be judged first).
pub fn may_write(vk: u32, mods: Mods) -> bool {
    !is_modifier(vk) && !is_shortcut(mods) && !matches!(vk, 0x08 | 0x09 | 0x0D)
}

/// The stage between the hooks and the recorder, on a thread of its own so that nothing slow is ever in front of it:
/// each key that may write text is judged at once (see `secret`), and the event goes on with the verdict. It ends when
/// the hooks are gone and everything they sent has gone on.
#[cfg(windows)]
fn watch_fields(from: Receiver<Raw>, to: Sender<Raw>, typing: bool) {
    let uia = facts::Uia::start();
    let mut asked = 0isize;
    crate::secret::judge(from, to, |event| match event {
        // Typing usually follows a click: a web page clicked into is asked now, so it is ready at the first key.
        Raw::Mouse { x, y, .. } if typing => {
            let clicked = facts::root_at(x, y);
            if clicked != 0 && clicked != asked {
                asked = clicked;
                uia.prime(clicked, None);
            }
            event
        }
        Raw::Key {
            vk,
            scan,
            mods,
            hkl,
            at,
            ..
        } if typing && may_write(vk, mods) => {
            // A Chromium window is asked for its accessibility tree once, so its fields can answer.
            let front = facts::foreground_root();
            if front != 0 && front != asked {
                asked = front;
                uia.prime(front, None);
            }
            let looked = uia.focus_is_secret(crate::secret::LATE);
            Raw::Key {
                vk,
                scan,
                mods,
                hkl,
                at,
                secret: Some(crate::secret::verdict(looked, crate::secret::since(at))),
            }
        }
        other => other,
    });
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
    fn the_shell_tells_the_taskbar_the_start_menu_the_tray_and_the_desktop_apart() {
        use steptext::Area;
        let none: Vec<String> = vec![];
        assert_eq!(
            classify_shell("Shell_TrayWnd", "MSTaskListWClass", "explorer", &none, ""),
            Area::Taskbar
        );
        // Windows 11: the taskbar is one XAML window; the tray buttons are told by the class of the element
        let tray = vec!["SystemTray.NormalButton".to_string()];
        assert_eq!(
            classify_shell(
                "Shell_TrayWnd",
                "Windows.UI.Composition.DesktopWindowContentBridge",
                "explorer",
                &tray,
                ""
            ),
            Area::Tray
        );
        let task = vec!["Taskbar.TaskListButtonAutomationPeer".to_string()];
        assert_eq!(
            classify_shell(
                "Shell_SecondaryTrayWnd",
                "Windows.UI.Composition.DesktopWindowContentBridge",
                "explorer",
                &task,
                "Appid:Chrome"
            ),
            Area::Taskbar
        );
        assert_eq!(
            classify_shell("Shell_TrayWnd", "TrayClockWClass", "explorer", &none, ""),
            Area::Tray
        );
        assert_eq!(
            classify_shell("NotifyIconOverflowWindow", "", "explorer", &none, ""),
            Area::Tray
        );
        assert_eq!(
            classify_shell(
                "Windows.UI.Core.CoreWindow",
                "",
                "StartMenuExperienceHost",
                &none,
                ""
            ),
            Area::StartMenu
        );
        assert_eq!(
            classify_shell("Windows.UI.Core.CoreWindow", "", "SearchHost", &none, ""),
            Area::StartMenu
        );
        assert_eq!(
            classify_shell("Progman", "SysListView32", "explorer", &none, ""),
            Area::Desktop
        );
        assert_eq!(
            classify_shell("WorkerW", "SysListView32", "explorer", &none, ""),
            Area::Desktop
        );
        assert_eq!(
            classify_shell("CabinetWClass", "DirectUIHWND", "explorer", &none, ""),
            Area::None
        );
    }

    #[test]
    fn a_step_of_the_shell_shows_the_taskbar_the_start_menu_or_the_icon_never_the_wallpaper() {
        use steptext::Area;
        let frame = [1920, 1080];
        // The taskbar (a strip of 48 px at the bottom) with a margin of 96 px above it.
        assert_eq!(
            shell_crop(Area::Taskbar, [0, 1032, 1920, 48], None, frame),
            [0, 936, 1920, 144]
        );
        // The tray is the same taskbar.
        assert_eq!(
            shell_crop(Area::Tray, [0, 1032, 1920, 48], None, frame),
            [0, 936, 1920, 144]
        );
        // A taskbar window that fills the picture is not trusted: the clicked button with a margin.
        assert_eq!(
            shell_crop(
                Area::Taskbar,
                [0, 0, 1920, 1080],
                Some([100, 1040, 40, 40]),
                frame
            ),
            [4, 944, 232, 136]
        );
        // The Start menu: its window with a margin.
        assert_eq!(
            shell_crop(Area::StartMenu, [560, 300, 640, 700], None, frame),
            [536, 276, 688, 748]
        );
        // The desktop: the icon with a generous margin, at least 640 x 400, inside the picture; not the whole desktop window.
        let r = shell_crop(
            Area::Desktop,
            [0, 0, 1920, 1080],
            Some([40, 60, 80, 90]),
            frame,
        );
        assert!(
            r[2] >= 640
                && r[3] >= 400
                && r[0] == 0
                && r[1] == 0
                && r[0] + r[2] <= 1920
                && r[1] + r[3] <= 1080,
            "{r:?}"
        );
        assert!(r[2] < 1920);
        assert_eq!(
            shell_crop(Area::Desktop, [0, 0, 1920, 1080], None, frame),
            [0, 0, 1920, 1080]
        );
        // A normal window is left alone.
        assert_eq!(
            shell_crop(Area::None, [100, 100, 800, 600], None, frame),
            [100, 100, 800, 600]
        );
        // Everything stays inside the picture, also on the second monitor's coordinates (already relative).
        let r = shell_crop(Area::Taskbar, [0, 0, 1280, 40], None, [1280, 720]);
        assert_eq!(r, [0, 0, 1280, 136]);
    }

    #[test]
    fn a_guide_of_a_region_or_a_window_ignores_clicks_outside_of_it() {
        let region = AreaMode::Region(Rect::new(100, 100, 200, 150));
        assert!(in_area(region, 100, 100, 0), "the corner is inside");
        assert!(in_area(region, 299, 249, 0));
        assert!(!in_area(region, 300, 120, 0), "the right edge is outside");
        assert!(!in_area(region, 50, 120, 0));
        assert!(!in_area(region, 120, 250, 0));
        let window = AreaMode::Window(42);
        assert!(in_area(window, 5, 5, 42));
        assert!(!in_area(window, 5, 5, 43));
        assert!(in_area(AreaMode::Active, -10, -10, 7) && in_area(AreaMode::Screen, 99999, 5, 7));
        assert_eq!(
            clip_to_frame([-20, -10, 100, 100], [1920, 1080]),
            [0, 0, 80, 90]
        );
        assert_eq!(
            clip_to_frame([1900, 1000, 100, 100], [1920, 1080]),
            [1900, 1000, 20, 80]
        );
        assert_eq!(region.word(), "region");
    }

    #[test]
    fn the_frame_of_a_guides_area_sits_around_it_also_on_a_monitor_to_the_left() {
        assert_eq!(frame_place([100, 200, 640, 360]), ((96, 196), (648, 368)));
        assert_eq!(frame_place([-1920, 0, 800, 600]), ((-1924, -4), (808, 608)));
    }

    #[test]
    fn the_title_of_a_page_is_the_window_title_without_the_browser() {
        assert_eq!(
            page_title("Inbox (3) - Mail - Google Chrome", "Google Chrome"),
            "Inbox (3) - Mail"
        );
        assert_eq!(
            page_title("New tab - Google Chrome", "Google Chrome"),
            "New tab"
        );
        assert_eq!(
            page_title(
                "Docs and 2 more pages - Personal - Microsoft Edge",
                "Microsoft Edge"
            ),
            "Docs and 2 more pages - Personal"
        );
        assert_eq!(page_title("Something else", "Google Chrome"), "");
    }

    #[test]
    fn typed_characters_group_and_backspace_removes_the_last() {
        let t0 = Instant::now();
        let mut g = TypeGroup::default();
        g.push("Ham", t0, false);
        g.push("x", t0 + Duration::from_millis(100), false);
        g.backspace(t0 + Duration::from_millis(200));
        g.push("burg", t0 + Duration::from_millis(300), false);
        assert_eq!(g.text, "Hamburg");
        assert_eq!(g.written(), "Hamburg");
        assert!(!g.idle(t0 + Duration::from_millis(1500), TYPE_IDLE));
        assert!(g.idle(t0 + Duration::from_millis(2400), TYPE_IDLE));
    }

    #[test]
    fn nothing_of_a_group_with_a_secret_key_is_kept() {
        let t0 = Instant::now();
        let mut g = TypeGroup::default();
        g.push("s3", t0, false);
        // One key of the group went into a secret field: also what came before and what comes after.
        g.push("c", t0, true);
        g.push("ret", t0, false);
        assert!(g.secret && g.text.chars().all(|c| c == '•'), "{:?}", g.text);
        assert_eq!(g.written(), crate::secret::MASK);
        // Backspace still counts, so a field emptied again makes no step.
        for _ in 0..6 {
            g.backspace(t0);
        }
        assert!(g.is_empty());
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
    /// The shortcuts of Snipmunk itself (start guide, step, capture, record): pressing them never makes a step.
    pub own_shortcuts: Vec<dawn_hotkeys::shortcut::Shortcut>,
    /// What the guide records: the active app, the whole screen, one window or one region.
    pub area: AreaMode,
}

/// What a guide records (the "New guide" area menu).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AreaMode {
    /// Every step shows the window that was clicked.
    #[default]
    Active,
    /// Every step shows the whole monitor.
    Screen,
    /// Only clicks in this window make steps; the pictures show it (the handle of the window).
    Window(isize),
    /// Only clicks inside this region (desktop pixels) make steps; the pictures are cropped to it.
    Region(Rect),
}

impl AreaMode {
    /// The word stored in guide.json and the settings.
    pub fn word(&self) -> &'static str {
        match self {
            AreaMode::Active => "active",
            AreaMode::Screen => "screen",
            AreaMode::Window(_) => "window",
            AreaMode::Region(_) => "region",
        }
    }
}

/// Does a click belong to the area of the guide? `root` is the top window under the pointer. Pure; tested.
pub fn in_area(area: AreaMode, x: i32, y: i32, root: isize) -> bool {
    match area {
        AreaMode::Active | AreaMode::Screen => true,
        AreaMode::Window(h) => root == h,
        AreaMode::Region(r) => x >= r.x && y >= r.y && x < r.x + r.w as i32 && y < r.y + r.h as i32,
    }
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
            area: AreaMode::Active,
            own_shortcuts: [
                &s.doc_start_hotkey,
                &s.doc_step_hotkey,
                &s.capture_hotkey,
                &s.record_hotkey,
            ]
            .iter()
            .filter_map(|t| t.parse().ok())
            .collect(),
        }
    }
}

// --- the recorder state and its commands ---------------------------------------------------------------------------------------------

struct Active {
    id: String,
    /// More steps recorded into a guide that was open: Cancel only takes those steps away.
    append: bool,
    start_n: u32,
    tx: Sender<Raw>,
    paused: Arc<AtomicBool>,
    count: Arc<AtomicU32>,
    frames: Arc<Frames>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// What the guide records, the title of the chosen window and the clicks outside the area that were ignored.
    area: AreaMode,
    target: String,
    ignored: Arc<AtomicU32>,
    #[cfg(windows)]
    hooks: Option<hooks::Hooks>,
    /// The stage between the hooks and the recorder that judges which keys are secret (`watch_fields`).
    #[cfg(windows)]
    watcher: Option<std::thread::JoinHandle<()>>,
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
    /// "active", "screen", "window" or "region".
    pub area: String,
    /// The title of the chosen window (for the bar).
    pub target: String,
    /// Clicks outside the area that were ignored (Choose window, Select area).
    pub ignored: u32,
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
                    area: a.area.word().to_string(),
                    target: a.target.clone(),
                    ignored: a.ignored.load(Ordering::SeqCst),
                },
                None => GuideState {
                    recording: false,
                    paused: false,
                    steps: 0,
                    id: String::new(),
                    area: String::new(),
                    target: String::new(),
                    ignored: 0,
                },
            },
            // (a command polled by a page never waits for the lock)
            Err(_) => GuideState {
                recording: true,
                paused: false,
                steps: 0,
                id: String::new(),
                area: String::new(),
                target: String::new(),
                ignored: 0,
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

/// A start is under way (the countdown runs): a second press of the shortcut does not start another guide.
static STARTING: AtomicBool = AtomicBool::new(false);

/// Start recording a guide (after the countdown, from its own thread): the live pictures, the pipeline, the hooks, the bar.
/// Every way of failing is told to the page (`capture-error`), also when the shortcut or the tray started it.
#[tauri::command]
pub async fn guide_start(app: AppHandle, area: Option<String>) -> CmdResult<String> {
    let word = {
        let state = app.state::<crate::commands::AppState>();
        let s = state.settings.lock().unwrap();
        area.unwrap_or_else(|| s.doc_area.clone())
    };
    let word = if ["active", "screen", "window", "region"].contains(&word.as_str()) {
        word
    } else {
        "active".to_string()
    };
    crate::commands::patch_settings(&app, serde_json::json!({ "docArea": word }))?;
    match word.as_str() {
        // Choose a window / draw a region on the selection overlay first; the guide starts when it is chosen.
        "window" | "region" => {
            if !crate::capture::pick_guide_area(&app, &word, false) {
                return Err(CmdError::new("busy", "a capture is running already"));
            }
            Ok(String::new())
        }
        "screen" => start_command(app, false, Some(AreaMode::Screen), None).await,
        _ => start_command(app, false, Some(AreaMode::Active), None).await,
    }
}

/// The overlay chose a window or a region for a guide: start it (a new one, or more steps of the open one).
pub fn area_picked(app: &AppHandle, area: AreaMode, pick: crate::capture::GuidePick) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = start_command(app, pick.append, Some(area), pick.countdown).await;
    });
}

/// "Record more steps" into the open guide: the new steps are appended to it. `area`: chosen again ("active", "screen",
/// "window", "region"); without it the one the guide was last recorded with.
#[tauri::command]
pub async fn guide_record_more(app: AppHandle, area: Option<String>) -> CmdResult<String> {
    if !crate::snpd::is_open() {
        return Err(CmdError::new("not_found", "no guide is open"));
    }
    let area = match area.as_deref() {
        Some(word @ ("window" | "region")) => {
            if !crate::capture::pick_guide_area(&app, word, true) {
                return Err(CmdError::new("busy", "a capture is running already"));
            }
            return Ok(String::new());
        }
        Some("screen") => AreaMode::Screen,
        Some("active") => AreaMode::Active,
        // The area the guide was recorded with (a window that is gone: the active app).
        _ => guides::read_info("current")
            .map(|i| area_of_info(&i.settings))
            .unwrap_or(AreaMode::Active),
    };
    start_command(app, true, Some(area), None).await
}

/// The settings a guide keeps of its area.
fn area_settings(area: AreaMode) -> serde_json::Value {
    serde_json::json!({
        "area": area.word(),
        "region": match area { AreaMode::Region(r) => serde_json::json!([r.x, r.y, r.w, r.h]), _ => serde_json::Value::Null },
        "hwnd": match area { AreaMode::Window(h) => serde_json::json!(h as i64), _ => serde_json::Value::Null },
    })
}

/// The area stored in a guide's settings (`area`, and `region` for a region).
fn area_of_info(settings: &serde_json::Value) -> AreaMode {
    match settings["area"].as_str() {
        Some("screen") => AreaMode::Screen,
        Some("region") => {
            let r = &settings["region"];
            match (r[0].as_i64(), r[1].as_i64(), r[2].as_u64(), r[3].as_u64()) {
                (Some(x), Some(y), Some(w), Some(h)) => {
                    AreaMode::Region(Rect::new(x as i32, y as i32, w as u32, h as u32))
                }
                _ => AreaMode::Active,
            }
        }
        Some("window") => {
            let h = settings["hwnd"].as_i64().unwrap_or(0) as isize;
            if h != 0 && facts::is_window(h) {
                AreaMode::Window(h)
            } else {
                AreaMode::Active
            }
        }
        _ => AreaMode::Active,
    }
}

async fn start_command(
    app: AppHandle,
    append: bool,
    area: Option<AreaMode>,
    countdown: Option<u32>,
) -> CmdResult<String> {
    if STARTING.swap(true, Ordering::SeqCst) {
        return Err(CmdError::new("busy", "a guide is starting already"));
    }
    let r = start_with(
        app.clone(),
        FrameSource::Monitors,
        false,
        true,
        append,
        area.unwrap_or_default(),
        countdown,
    )
    .await;
    STARTING.store(false, Ordering::SeqCst);
    if let Err(e) = &r {
        if e.code != "cancelled" {
            let _ = app.emit("capture-error", e.message.clone());
        }
    }
    r
}

/// The common start. `real_hooks`: install the hooks (never in the tests). `with_ui`: hide the window and show the bar.
pub async fn start_with(
    app: AppHandle,
    src: FrameSource,
    dev: bool,
    real_hooks: bool,
    append: bool,
    area: AreaMode,
    countdown: Option<u32>,
) -> CmdResult<String> {
    if real_hooks && crate::capture::real_capture_blocked() {
        return Err(CmdError::new(
            "unavailable",
            "this test instance records nothing real",
        ));
    }
    if app.state::<GuideRec>().active.lock().unwrap().is_some()
        || crate::recording::is_recording(&app)
    {
        return Err(CmdError::new("busy", "a recording is running already"));
    }
    let settings = {
        let mut s = RecSettings::from_app(&app);
        s.allow_own = dev;
        s.area = area;
        s
    };
    let ignored = Arc::new(AtomicU32::new(0));
    let target = match area {
        AreaMode::Window(h) => facts::window_title(h),
        _ => String::new(),
    };
    let app2 = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || -> CmdResult<String> {
        let app = app2;
        // The countdown of the recording is used (Settings → Recording), shown on the screen like the recording's; Esc cancels it.
        if real_hooks {
            let setting = app.state::<crate::commands::AppState>().settings.lock().unwrap().rec_countdown;
            let n = countdown.unwrap_or(setting);
            if n > 0 {
                // Snipmunk's window is out of the way while it counts.
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
                        let _ = w.minimize();
                    }
                }
                if !crate::popups::countdown(&app, n) {
                    crate::tray::show_main(&app);
                    return Err(CmdError::new("cancelled", "the countdown was cancelled"));
                }
            }
        }
        let frames = Arc::new(start_frames(src).map_err(|e| CmdError::new("capture", e))?);
        let info = if append {
            // The open guide goes on: it is "recording" again and its numbering continues.
            guides::set_state("current", "recording")?;
            // An area chosen again is what "the same as before" means next time.
            guides::set_settings("current", &area_settings(area))?;
            guides::read_info("current").ok_or_else(|| CmdError::new("not_found", "no guide is open"))?
        } else {
            let mut of_guide = serde_json::json!({
                "stepMode": if settings.auto { "auto" } else { "manual" }, "typing": settings.typing,
                "shortcuts": settings.shortcuts, "enterTab": settings.enter_tab, "zoom": settings.zoom_default, "lang": settings.lang,
            });
            if let (Some(all), Some(of_area)) = (of_guide.as_object_mut(), area_settings(area).as_object()) {
                all.extend(of_area.clone());
            }
            guides::create(&default_title(), of_guide)?
        };
        let start_n = guides::read_steps(&info.id).iter().map(|s| s.n).max().unwrap_or(0);
        let (tx, rx) = std::sync::mpsc::channel::<Raw>();
        let paused = Arc::new(AtomicBool::new(false));
        let count = Arc::new(AtomicU32::new(0));
        let typing = settings.typing;
        let thread = {
            let (app, frames, paused, count, id) = (app.clone(), frames.clone(), paused.clone(), count.clone(), info.id.clone());
            let ignored = ignored.clone();
            std::thread::spawn(move || pipeline(app, id, rx, frames, settings, paused, count, ignored, start_n))
        };
        // Between the hooks and the recorder: each key that may write text is looked at as it comes (see `secret`).
        #[cfg(windows)]
        let (hooks, watcher) = if real_hooks {
            let (hook_tx, hook_rx) = std::sync::mpsc::channel::<Raw>();
            let to = tx.clone();
            let watcher = std::thread::spawn(move || watch_fields(hook_rx, to, typing));
            (hooks::Hooks::install(hook_tx, paused.clone()).ok(), Some(watcher))
        } else {
            (None, None)
        };
        #[cfg(not(windows))]
        let _ = typing;
        let active = Active {
            id: info.id.clone(),
            append,
            start_n,
            tx,
            paused,
            count,
            frames,
            thread: Some(thread),
            area,
            target,
            ignored,
            #[cfg(windows)]
            hooks,
            #[cfg(windows)]
            watcher,
        };
        *app.state::<GuideRec>().active.lock().unwrap() = Some(active);
        announce(&app);
        Ok(info.id)
    })
    .await
    .map_err(|e| CmdError::new("io", e.to_string()))??;
    if real_hooks {
        ui_start(&app, area);
    }
    Ok(id)
}

/// The red frame around the chosen window or region of a guide: left out of the pictures, click-through, on the right monitor.
/// A window's frame follows it (moved, resized, hidden while minimized). It goes when the guide stops, and is dimmed while paused
/// (the page of the frame listens to the guide state). Runs on a worker thread of its own, holding no lock around window calls.
fn show_frame(app: &AppHandle, area: AreaMode) {
    let first = match area {
        AreaMode::Region(r) => Some([r.x, r.y, r.w as i32, r.h as i32]),
        AreaMode::Window(h) => facts::window_rect(h),
        _ => return,
    };
    let Some(first) = first else {
        return;
    };
    let built = crate::webview::window(
        app,
        "guideframe",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Snipmunk – Guide frame")
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    .visible(false)
    .build();
    let Ok(w) = built else {
        return;
    };
    let _ = w.set_ignore_cursor_events(true);
    place_frame(&w, first);
    crate::webview::exclude_from_capture(&w);
    let _ = w.show();
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = first;
        let mut hidden = false;
        loop {
            std::thread::sleep(Duration::from_millis(120));
            if !app.state::<GuideRec>().state().recording {
                break;
            }
            if let AreaMode::Window(h) = area {
                match facts::window_rect(h) {
                    // A minimized window is moved far off the screen by Windows.
                    Some(r) if !facts::is_iconic(h) => {
                        if r != last {
                            last = r;
                            place_frame(&w, r);
                        }
                        if hidden {
                            hidden = false;
                            let _ = w.show();
                        }
                    }
                    _ => {
                        if !hidden {
                            hidden = true;
                            let _ = w.hide();
                        }
                    }
                }
            }
        }
        let _ = w.close();
    });
}

/// The place of the frame window around an area (desktop pixels): a margin of 4 px for the red border.
pub fn frame_place(r: [i32; 4]) -> ((i32, i32), (u32, u32)) {
    const M: i32 = 4;
    (
        (r[0] - M, r[1] - M),
        ((r[2] + 2 * M).max(1) as u32, (r[3] + 2 * M).max(1) as u32),
    )
}

fn place_frame(w: &tauri::WebviewWindow, r: [i32; 4]) {
    let ((x, y), (wd, h)) = frame_place(r);
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = w.set_size(tauri::PhysicalSize::new(wd, h));
}

/// The window goes away and the bar appears (like a recording). Called after the state lock is released.
fn ui_start(app: &AppHandle, area: AreaMode) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Snipmunk's window goes away (a window that was hidden stays hidden), as when recording.
        if let Some(w) = app.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
                let _ = w.minimize();
            }
        }
        show_bar(&app);
        show_frame(&app, area);
    });
}

#[cfg(windows)]
fn show_bar(app: &AppHandle) {
    let (x, y, scale) = hooks::primary_top().unwrap_or((0, 0, 1.0));
    let (w, h) = ((460.0 * scale) as u32, (76.0 * scale) as u32);
    let built =
        crate::webview::window(app, "guidebar", tauri::WebviewUrl::App("index.html".into()))
            .title("Snipmunk – Guide bar")
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
    if let Some(w) = app.get_webview_window("guideframe") {
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
    {
        drop(a.hooks.take());
        // The keys still on their way through the watcher reach the recorder before "Stop" does.
        if let Some(w) = a.watcher.take() {
            let _ = w.join();
        }
    }
    let _ = a.tx.send(Raw::Stop);
    if let Some(t) = a.thread.take() {
        let _ = t.join();
    }
    a.frames.stop();
    let id = a.id.clone();
    if keep {
        let _ = guides::finalize(&id);
    } else if a.append {
        // The steps of this recording are taken away (appended delete lines); the guide goes back to "done".
        let last = guides::read_steps(&id)
            .iter()
            .map(|s| s.n)
            .max()
            .unwrap_or(0);
        for n in a.start_n + 1..=last {
            let _ = guides::guide_step_delete(id.clone(), n, None);
        }
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

impl Snapshot {
    /// Is the element of this snapshot a field whose content must not be written down (see `secret`)?
    fn on_secret_field(&self) -> bool {
        self.uia.as_ref().is_some_and(|u| {
            crate::secret::field_is_secret(u.password, &u.control, &u.name, &u.automation_id)
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct WinFacts {
    pub hwnd: isize,
    /// The name of the app for people ("Google Chrome"); the title of the window is in `title`.
    pub app: String,
    /// Screen coordinates.
    pub rect: [i32; 4],
    pub title: String,
    pub process: String,
    #[allow(dead_code)]
    pub pid: u32,
    /// The window class of the top window and of the (child) window under the point.
    pub class: String,
    pub point_class: String,
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
    /// The class names of the element and of its nearest parents (the shell tells its parts apart by them).
    pub classes: Vec<String>,
    /// A text control (an editor, a text field). `name` never holds what it contains.
    pub surface: steptext::Surface,
    /// The element says it is a password field.
    pub password: bool,
}

/// Which part of the Windows shell a click was in (the taskbar and the Start menu are not "File Explorer"). Pure; tested.
pub fn classify_shell(
    root_class: &str,
    point_class: &str,
    process: &str,
    uia_classes: &[String],
    automation_id: &str,
) -> steptext::Area {
    use steptext::Area;
    let proc = process.to_ascii_lowercase();
    if matches!(
        proc.as_str(),
        "startmenuexperiencehost" | "searchhost" | "searchapp" | "searchui" | "startmenu"
    ) {
        return Area::StartMenu;
    }
    if proc == "shellexperiencehost" {
        return Area::Tray;
    }
    let tray_class = |c: &str| {
        matches!(
            c,
            "TrayNotifyWnd"
                | "SysPager"
                | "TrayClockWClass"
                | "TrayShowDesktopButtonWClass"
                | "NotifyIconOverflowWindow"
                | "TopLevelWindowForOverflowXamlIsland"
        )
    };
    match root_class {
        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" => {
            if tray_class(point_class)
                || (point_class == "ToolbarWindow32")
                || uia_classes
                    .iter()
                    .any(|c| c.starts_with("SystemTray") || c.starts_with("NotificationArea"))
                || automation_id.contains("SystemTray")
                || automation_id.contains("NotificationArea")
            {
                Area::Tray
            } else {
                Area::Taskbar
            }
        }
        c if tray_class(c) => Area::Tray,
        "Progman" | "WorkerW" => Area::Desktop,
        _ => Area::None,
    }
}

/// A rectangle inside the picture (at least 1 x 1).
pub fn clip_to_frame(r: [i32; 4], frame: [i32; 2]) -> [i32; 4] {
    let (x0, y0) = (r[0].max(0).min(frame[0] - 1), r[1].max(0).min(frame[1] - 1));
    let (x1, y1) = (
        (r[0] + r[2]).min(frame[0]).max(x0 + 1),
        (r[1] + r[3]).min(frame[1]).max(y0 + 1),
    );
    [x0, y0, x1 - x0, y1 - y0]
}

/// The area a step of the Windows shell shows, in picture pixels: never the window of the desktop (the wallpaper), and not only a thin
/// strip. The taskbar and the tray: the taskbar window with a margin of 96 px (what is above it). The Start menu: its window with a
/// margin. The desktop: the clicked icon with a generous margin (at least 640 x 400). A shell window without a usable size shows the
/// whole picture. The result is inside the picture.
pub fn shell_crop(
    area: steptext::Area,
    win: [i32; 4],
    elem: Option<[i32; 4]>,
    frame: [i32; 2],
) -> [i32; 4] {
    use steptext::Area;
    let whole = [0, 0, frame[0], frame[1]];
    let inflate = |r: [i32; 4], m: i32| {
        let (x0, y0) = ((r[0] - m).max(0), (r[1] - m).max(0));
        let (x1, y1) = (
            (r[0] + r[2] + m).min(frame[0]),
            (r[1] + r[3] + m).min(frame[1]),
        );
        [x0, y0, (x1 - x0).max(1), (y1 - y0).max(1)]
    };
    let usable = |r: [i32; 4]| r[2] >= 8 && r[3] >= 8;
    match area {
        Area::None => win,
        Area::Taskbar | Area::Tray => {
            // A taskbar that fills the whole picture is not one: use the clicked element or everything.
            if usable(win) && !(win[2] >= frame[0] && win[3] >= frame[1]) {
                inflate(win, 96)
            } else {
                elem.filter(|e| usable(*e))
                    .map_or(whole, |e| inflate(e, 96))
            }
        }
        Area::StartMenu => {
            if usable(win) {
                inflate(win, 24)
            } else {
                whole
            }
        }
        Area::Desktop => {
            match elem.filter(|e| usable(*e) && !(e[2] >= frame[0] && e[3] >= frame[1])) {
                Some(e) => {
                    let r = inflate(e, 240);
                    // at least 640 x 400, around the icon
                    let (w, h) = (r[2].max(640).min(frame[0]), r[3].max(400).min(frame[1]));
                    let cx = e[0] + e[2] / 2;
                    let cy = e[1] + e[3] / 2;
                    let x = (cx - w / 2).clamp(0, (frame[0] - w).max(0));
                    let y = (cy - h / 2).clamp(0, (frame[1] - h).max(0));
                    [x, y, w, h]
                }
                None => whole,
            }
        }
    }
}

/// The title of a page without the name of the browser: "Inbox - Mail - Google Chrome" is "Inbox - Mail".
pub fn page_title(window_title: &str, app: &str) -> String {
    let t = window_title.trim();
    for sep in [" - ", " – ", " — "] {
        let suffix = format!("{sep}{app}");
        if let Some(head) = t.strip_suffix(&suffix) {
            return head.trim().to_string();
        }
        // Edge: "Title - Profile - Microsoft Edge": cut at the app name wherever it stands.
        if let Some(i) = t.rfind(&suffix) {
            return t[..i].trim().to_string();
        }
    }
    String::new()
}

struct Pipe {
    /// Clicks outside the area of the guide (Choose window, Select area) that were ignored.
    ignored: Arc<AtomicU32>,
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
    /// The last click was on a secret field: what is typed next is secret.
    clicked_secret: bool,
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
    ignored: Arc<AtomicU32>,
    start_n: u32,
) {
    let mut p = Pipe {
        ignored,
        app,
        id,
        settings,
        frames,
        paused,
        count,
        uia: facts::Uia::start(),
        n: start_n,
        pending: None,
        typing: TypeGroup::default(),
        typing_facts: None,
        clicked_secret: false,
        last_hwnd: 0,
        hint_sent: false,
        own_pid: std::process::id(),
        dev_pointer: (0, 0),
    };
    // (one second ago: the first look at the foreground window is at once)
    let mut last_poll = Instant::now() - Duration::from_secs(2);
    let mut last_foreground = 0isize;
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
            // A Chromium window that comes to the front is asked for its accessibility tree now, so the first click in it has names.
            // (Not in the tests: the foreground window of the real desktop is never looked at there.)
            if !p.settings.allow_own {
                let fg = facts::foreground_root();
                if fg != 0 && fg != last_foreground {
                    last_foreground = fg;
                    p.uia.prime(fg, None);
                }
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
                if self.outside_area(x, y) {
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
                        self.clicked_secret = snap.on_secret_field();
                        self.pending = Some((PendingClick { at, x, y }, snap));
                    }
                    Button::Right | Button::Middle => {
                        self.flush_pending();
                        let snap = self.snapshot((x, y), at);
                        self.clicked_secret = snap.on_secret_field();
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
                if self.is_own(x, y) || self.outside_area(x, y) {
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
                secret,
            } => {
                // A key nobody looked at is secret; only the tests' injected events are taken as they say.
                let secret = secret.unwrap_or(!self.settings.allow_own);
                self.key(vk, scan, mods, hkl, at, secret)
            }
            Raw::Stop => {}
        }
    }

    /// A click outside the area of the guide: ignored, counted, and the bar says so. (Region: only the rectangle is looked at;
    /// Window: the top window under the pointer.)
    fn outside_area(&self, x: i32, y: i32) -> bool {
        let area = self.settings.area;
        let root = match area {
            AreaMode::Window(_) => facts::root_at(x, y),
            _ => 0,
        };
        if in_area(area, x, y, root) {
            return false;
        }
        self.ignored.fetch_add(1, Ordering::SeqCst);
        announce(&self.app);
        true
    }

    fn pointer_now(&self) -> (i32, i32) {
        if self.settings.allow_own {
            self.dev_pointer
        } else {
            pointer()
        }
    }

    /// Clicks on Snipmunk's own windows never become steps (in every build; only the test injection may bypass it).
    fn is_own(&self, x: i32, y: i32) -> bool {
        if self.settings.allow_own {
            return false;
        }
        let own: Vec<isize> = self
            .app
            .webview_windows()
            .values()
            .filter_map(|w| w.hwnd().ok().map(|h| h.0 as isize))
            .collect();
        facts::point_belongs_to(x, y, self.own_pid, &own)
    }

    fn key(&mut self, vk: u32, scan: u32, mods: Mods, hkl: isize, at: Instant, secret: bool) {
        if is_modifier(vk) {
            return;
        }
        // Snipmunk's own shortcuts (start guide, take step, ...) are not steps.
        if self.settings.own_shortcuts.iter().any(|s| {
            s.key.0 == vk
                && s.ctrl == mods.ctrl
                && s.alt == mods.alt
                && s.shift == mods.shift
                && s.win == mods.win
        }) {
            return;
        }
        if is_shortcut(mods) {
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
            // The focus goes on: the field that was clicked no longer says anything about what comes.
            self.clicked_secret = false;
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
        let mut secret = secret || self.clicked_secret;
        if self.typing.is_empty() {
            self.typing = TypeGroup::default();
            // The element that has the focus at the first character is the field of the group.
            let (x, y) = self.pointer_now();
            let snap = self.snapshot_focus((x, y), at);
            secret |= snap.on_secret_field();
            self.typing_facts = Some(snap);
        }
        self.typing.push(&text, at, secret);
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
        let group = std::mem::take(&mut self.typing);
        if let Some(mut snap) = self.typing_facts.take() {
            // The picture of a typing step is taken at its end: it shows the typed text. For a secret it stays the one
            // from before the first key (a password field may show what is in it).
            if !group.secret {
                let mi = snap.monitor;
                snap.frame = self.frames.monitors.get(mi).and_then(|m| m.at(at));
            }
            snap.at = at;
            self.commit(snap, Kind::Type, Some(group.written()), None);
        }
    }

    /// What there is at a point at the time of a click: the picture, the window and the element.
    fn snapshot(&mut self, pt: (i32, i32), at: Instant) -> Snapshot {
        let monitor = self.frames.monitor_for(pt.0, pt.1);
        let frame = self.frames.monitors.get(monitor).and_then(|m| m.at(at));
        let win = facts::window_at(pt.0, pt.1);
        // A Chromium window that was not asked yet (a click before the poll saw it): ask now, a moment is worth the names.
        if let Some(w) = win.as_ref() {
            self.uia.prime(w.hwnd, Some(Duration::from_millis(400)));
        }
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
        // Every failure is logged: a step without a picture must never be silent (it shows "Picture missing" in the editor).
        match image::RgbaImage::from_raw(fw as u32, fh as u32, rgba) {
            Some(img) => {
                match crate::thumbs::png_bytes(&img, image::codecs::png::CompressionType::Fast) {
                    Ok(png) => {
                        if let Err(e) = guides::write_image(&self.id, &image, &png) {
                            eprintln!(
                                "[guide] step {n}: the picture {image} was not written: {e:?}"
                            );
                        }
                    }
                    Err(e) => eprintln!("[guide] step {n}: the picture could not be encoded: {e}"),
                }
            }
            None => eprintln!(
                "[guide] step {n}: the frame has {} bytes, not {fw} x {fh} x 4",
                bgra.len()
            ),
        }
        let click = matches!(kind, Kind::Click | Kind::RightClick | Kind::DoubleClick)
            .then(|| [snap.pt.0 - origin.0, snap.pt.1 - origin.1]);
        let shell_area = snap.win.as_ref().map_or(steptext::Area::None, |w| {
            classify_shell(
                &w.class,
                &w.point_class,
                &w.process,
                snap.uia.as_ref().map_or(&[][..], |u| &u.classes[..]),
                snap.uia.as_ref().map_or("", |u| &u.automation_id),
            )
        });
        let window = snap.win.as_ref().map(|w| WindowInfo {
            // The area of a step of the shell is the shell element, not the window under the point (the desktop is the wallpaper).
            rect: shell_crop(
                shell_area,
                to_frame(w.rect),
                snap.uia.as_ref().map(|u| to_frame(u.rect)),
                [fw as i32, fh as i32],
            ),
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
        // A guide of one window or one region: the pictures show exactly that (frame pixels, inside the picture).
        let window = match (self.settings.area, window) {
            (AreaMode::Region(r), w) => Some(WindowInfo {
                rect: clip_to_frame(
                    to_frame([r.x, r.y, r.w as i32, r.h as i32]),
                    [fw as i32, fh as i32],
                ),
                title: w.as_ref().map(|w| w.title.clone()).unwrap_or_default(),
                process: w.as_ref().map(|w| w.process.clone()).unwrap_or_default(),
            }),
            (AreaMode::Window(h), w) => match facts::window_rect(h) {
                Some(r) => Some(WindowInfo {
                    rect: clip_to_frame(to_frame(r), [fw as i32, fh as i32]),
                    title: w.as_ref().map(|w| w.title.clone()).unwrap_or_default(),
                    process: w.as_ref().map(|w| w.process.clone()).unwrap_or_default(),
                }),
                None => w,
            },
            (_, w) => w,
        };
        let hwnd = snap.win.as_ref().map_or(0, |w| w.hwnd);
        let area = shell_area;
        let caption = snap
            .uia
            .as_ref()
            .and_then(|u| steptext::caption_of(&u.control, &u.automation_id, &u.name));
        // Chromium (Chrome, Edge, Electron): when the page gave no element name, the title of the page tells where the click was.
        let page = snap
            .win
            .as_ref()
            .filter(|w| w.class.starts_with("Chrome_WidgetWin"))
            .map(|w| page_title(&w.title, &w.app))
            .unwrap_or_default();
        let new_window = hwnd != 0 && hwnd != self.last_hwnd;
        if hwnd != 0 {
            self.last_hwnd = hwnd;
        }
        let window_name = snap
            .win
            .as_ref()
            .map(|w| {
                if !w.app.trim().is_empty() {
                    w.app.clone()
                } else {
                    w.process.clone()
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
            area,
            caption,
            page,
            surface: snap.uia.as_ref().map(|u| u.surface).unwrap_or_default(),
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
#[cfg(debug_assertions)]
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
        /// As if the focused field were a password field.
        #[serde(default)]
        secret: bool,
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
    start_with(app, src, true, false, false, AreaMode::Active, None).await
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
                Inject::Key {
                    vk,
                    mods,
                    layout,
                    secret,
                } => {
                    let hkl = facts::layout_handle(&layout);
                    let _ = tx.send(Raw::Key {
                        vk,
                        scan: 0,
                        mods,
                        hkl,
                        at,
                        secret: Some(secret),
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
                            // (looked at by the next stage: nothing slow happens in a hook)
                            secret: None,
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
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT, WPARAM};
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
        IUIAutomationTextPattern, IUIAutomationTogglePattern, IUIAutomationValuePattern,
        ToggleState_On, UIA_SelectionItemPatternId, UIA_TextPatternId, UIA_TogglePatternId,
        UIA_ValuePatternId,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayout, MapVirtualKeyExW, ToUnicodeEx, HKL, MAPVK_VK_TO_VSC,
    };
    #[cfg(debug_assertions)]
    use windows::Win32::UI::Input::KeyboardAndMouse::{LoadKeyboardLayoutW, KLF_NOTELLSHELL};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowRect,
        GetWindowTextW, GetWindowThreadProcessId, SendMessageTimeoutW, WindowFromPoint, GA_ROOT,
        SMTO_ABORTIFHUNG, WM_GETOBJECT,
    };

    /// (process id, exe name without ".exe", full path of the exe).
    fn process_of(hwnd: HWND) -> (u32, String, String) {
        let mut pid = 0u32;
        // SAFETY: a window handle and a valid out pointer.
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let (mut name, mut full) = (String::new(), String::new());
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
                    full = String::from_utf16_lossy(&buf[..len as usize]);
                    name = std::path::Path::new(&full)
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                }
                let _ = CloseHandle(h);
            }
        }
        (pid, name, full)
    }

    /// The name of an app for people, looked up once per exe: the display name of the package (Microsoft Store and MSIX apps:
    /// "Snipping Tool"), else the short product name from the exe's version info (see `pick_app_name`), else the exe name
    /// without ".exe". The title of a window is used only for the frame of a Store app or without an exe name.
    pub fn app_name(pid: u32, path: &str, stem: &str, title: &str) -> String {
        static CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, String>>> =
            std::sync::Mutex::new(None);
        let key = path.to_lowercase();
        let cached = CACHE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .and_then(|m| m.get(&key).cloned());
        let from_exe = match cached {
            Some(v) => v,
            None => {
                let found = if stem.eq_ignore_ascii_case("explorer") {
                    "File Explorer".to_string()
                } else if stem.eq_ignore_ascii_case("ApplicationFrameHost") {
                    // The frame of a UWP app: the app is the window (its title is the name of the app).
                    String::new()
                } else {
                    package_display_name(pid)
                        .or_else(|| {
                            pick_app_name(
                                version_string(path, "FileDescription"),
                                version_string(path, "ProductName"),
                                stem,
                            )
                        })
                        .unwrap_or_default()
                };
                // Only a name that belongs to the exe is cached (the title of a window changes).
                CACHE
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get_or_insert_with(Default::default)
                    .insert(key, found.clone());
                found
            }
        };
        if !from_exe.is_empty() {
            return from_exe;
        }
        // The frame of a Store app is named by its window; every other program has at least the name of its exe.
        let t = title.trim();
        let frame = stem.eq_ignore_ascii_case("ApplicationFrameHost") || stem.is_empty();
        if frame && !t.is_empty() && t.chars().count() <= 40 {
            return t.to_string();
        }
        stem.to_string()
    }

    /// A version-info string as a name: without a description after it ("Notepad++ : a free (GNU) source code editor",
    /// "Foo - the file manager"), and whether it had one. `None` when empty or a file name.
    fn short_name(v: Option<String>) -> Option<(String, bool)> {
        let v = v?;
        let full = v.trim().trim_end_matches('\0').trim();
        let cut = [" : ", ": ", " - ", " \u{2013} ", " \u{2014} ", " | "]
            .iter()
            .filter_map(|sep| full.find(sep))
            .filter(|i| *i > 0)
            .min();
        let name = cut.map_or(full, |i| &full[..i]).trim();
        (!name.is_empty() && !name.to_lowercase().ends_with(".exe"))
            .then(|| (name.to_string(), cut.is_some()))
    }

    /// The name of a program from its FileDescription and ProductName: the description, unless it is a long sentence and
    /// the product name is short; the product name of Windows itself is not the name of a program. A name that only repeats
    /// the exe name is used when there is no other.
    pub(super) fn pick_app_name(
        description: Option<String>,
        product: Option<String>,
        stem: &str,
    ) -> Option<String> {
        let description = short_name(description);
        let product = short_name(product).filter(|(p, _)| !p.contains("Operating System"));
        let wordy = description
            .as_ref()
            .is_some_and(|(d, had_more)| *had_more || d.chars().count() > 40);
        let order = if wordy {
            [product, description]
        } else {
            [description, product]
        };
        let names: Vec<String> = order
            .into_iter()
            .flatten()
            .map(|(n, _)| n)
            .filter(|n| n.chars().count() <= 60)
            .collect();
        names
            .iter()
            .find(|n| !n.eq_ignore_ascii_case(stem))
            .or(names.first())
            .cloned()
    }

    /// The display name of the package of a process (Microsoft Store / MSIX apps), the way the Start menu shows it: the name of the
    /// app's entry in `shell:AppsFolder\<AppUserModelId>`. `None` for a process without package identity.
    pub fn package_display_name(pid: u32) -> Option<String> {
        use windows::core::{PCWSTR, PWSTR};
        use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
        use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
        use windows::Win32::System::Com::{
            CoInitializeEx, CoTaskMemFree, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{
            IShellItem, SHCreateItemFromParsingName, SIGDN_NORMALDISPLAY,
        };
        // The shell wants a single-threaded apartment: a short-lived thread of its own (the result is cached per exe).
        let worker = std::thread::spawn(move || -> Option<String> {
            // SAFETY: the process handle is closed again; the buffers have the sizes the functions are told; COM is initialised
            // and uninitialised on this thread.
            unsafe {
                let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
                let mut len = 0u32;
                let first = GetApplicationUserModelId(h, &mut len, None);
                if first != ERROR_INSUFFICIENT_BUFFER || len == 0 {
                    let _ = CloseHandle(h);
                    return None; // no package identity
                }
                let mut buf = vec![0u16; len as usize];
                let r = GetApplicationUserModelId(h, &mut len, Some(PWSTR(buf.as_mut_ptr())));
                let _ = CloseHandle(h);
                if r.0 != 0 {
                    return None;
                }
                let aumid = String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)]);
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                let path: Vec<u16> = format!("shell:AppsFolder\\{aumid}")
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                let name = SHCreateItemFromParsingName::<_, _, IShellItem>(
                    PCWSTR(path.as_ptr()),
                    None::<&IBindCtx>,
                )
                .ok()
                .and_then(|item| {
                    let p = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
                    let s = p.to_string().ok();
                    CoTaskMemFree(Some(p.0 as *const _));
                    s
                })
                .filter(|s| !s.trim().is_empty());
                CoUninitialize();
                name
            }
        });
        // Never wait for the shell for long: a step without the name is better than a late step.
        let start = std::time::Instant::now();
        while !worker.is_finished() {
            if start.elapsed() > Duration::from_millis(800) {
                return None;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        worker.join().ok().flatten()
    }

    fn version_string(path: &str, field: &str) -> Option<String> {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
        };
        if path.is_empty() {
            return None;
        }
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        // SAFETY: the buffers have the sizes the functions are told; the pointers VerQueryValueW returns point into `data`.
        unsafe {
            let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(
                PCWSTR(wide.as_ptr()),
                None,
                size,
                data.as_mut_ptr() as *mut _,
            )
            .ok()?;
            // The language and code page of the first translation, else US English.
            let mut tp: *mut std::ffi::c_void = std::ptr::null_mut();
            let mut tl = 0u32;
            let tr: Vec<u16> = "\\VarFileInfo\\Translation"
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let lang = if VerQueryValueW(
                data.as_ptr() as *const _,
                PCWSTR(tr.as_ptr()),
                &mut tp,
                &mut tl,
            )
            .as_bool()
                && tl >= 4
            {
                let p = tp as *const u16;
                (*p, *p.add(1))
            } else {
                (0x0409, 0x04B0)
            };
            for (l, c) in [lang, (0x0409, 0x04B0), (0x0409, 0x04E4)] {
                let q: Vec<u16> = format!("\\StringFileInfo\\{l:04x}{c:04x}\\{field}")
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                let mut vp: *mut std::ffi::c_void = std::ptr::null_mut();
                let mut vl = 0u32;
                if VerQueryValueW(
                    data.as_ptr() as *const _,
                    PCWSTR(q.as_ptr()),
                    &mut vp,
                    &mut vl,
                )
                .as_bool()
                    && vl > 1
                {
                    let s = std::slice::from_raw_parts(vp as *const u16, vl as usize - 1);
                    return Some(String::from_utf16_lossy(s));
                }
            }
            None
        }
    }

    /// Is the window at this point one of Snipmunk's own? The window under the point is often a child that belongs to the web view's
    /// own process, so the TOP window is looked at: it is Snipmunk's when its handle is one of `own` or it belongs to our process.
    pub fn point_belongs_to(x: i32, y: i32, pid: u32, own: &[isize]) -> bool {
        // SAFETY: plain window queries.
        unsafe {
            let h = WindowFromPoint(POINT { x, y });
            if h.0.is_null() {
                return false;
            }
            let root = GetAncestor(h, GA_ROOT);
            let root = if root.0.is_null() { h } else { root };
            if own.contains(&(root.0 as isize)) || own.contains(&(h.0 as isize)) {
                return true;
            }
            let mut p = 0u32;
            GetWindowThreadProcessId(root, Some(&mut p));
            p == pid
        }
    }

    /// The window class of a window.
    fn class_of(h: HWND) -> String {
        let mut b = [0u16; 128];
        // SAFETY: a window handle and a buffer of the length it says.
        let n = unsafe { GetClassNameW(h, &mut b) };
        String::from_utf16_lossy(&b[..n.max(0) as usize])
    }

    /// The top window under a point (0 when none).
    pub fn root_at(x: i32, y: i32) -> isize {
        // SAFETY: plain window queries.
        unsafe {
            let h = WindowFromPoint(POINT { x, y });
            if h.0.is_null() {
                return 0;
            }
            let root = GetAncestor(h, GA_ROOT);
            (if root.0.is_null() { h } else { root }).0 as isize
        }
    }

    /// The rectangle of a window (desktop pixels), `None` when it is gone.
    pub fn window_rect(h: isize) -> Option<[i32; 4]> {
        let mut r = RECT::default();
        // SAFETY: a window handle and a valid out pointer.
        unsafe { GetWindowRect(HWND(h as *mut _), &mut r).ok()? };
        Some([r.left, r.top, r.right - r.left, r.bottom - r.top])
    }

    pub fn window_title(h: isize) -> String {
        let mut buf = [0u16; 256];
        // SAFETY: a window handle and a buffer of the length it says.
        let n = unsafe { GetWindowTextW(HWND(h as *mut _), &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    pub fn is_iconic(h: isize) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::IsIconic;
        // SAFETY: a plain query.
        unsafe { IsIconic(HWND(h as *mut _)).as_bool() }
    }

    pub fn is_window(h: isize) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::IsWindow;
        // SAFETY: a plain query.
        unsafe { IsWindow(Some(HWND(h as *mut _))).as_bool() }
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
            let (pid, process, full) = process_of(root);
            let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
            let app = app_name(pid, &full, &process, &title);
            Some(WinFacts {
                app,
                hwnd: root.0 as isize,
                rect: [r.left, r.top, r.right - r.left, r.bottom - r.top],
                title,
                process,
                pid,
                class: class_of(root),
                point_class: class_of(h),
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
            let (pid, _, _) = process_of(fg);
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
    #[cfg(debug_assertions)]
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
        /// Is the focused field secret? (Only what that needs is read.)
        Secret(Sender<Option<bool>>),
        /// Make a Chromium window (Chrome, Edge, Electron, a web view) build its accessibility tree: the top window handle and,
        /// when someone waits, the number of render hosts that were asked.
        Prime(isize, Option<Sender<usize>>),
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

    /// Replace the name of an element by one a step may show (`steptext::safe_name`): for a control that holds text, its
    /// label, or its name when that is not its text. The value and the text are read only to compare with and end here.
    ///
    /// # Safety
    /// Called on the UI Automation thread with an element that came from it.
    unsafe fn safe_text_name(el: &IUIAutomationElement, f: &mut UiaFacts) {
        let class = f.classes.first().cloned().unwrap_or_default();
        let holds_text =
            crate::steptext::surface_of(&f.control, &class) != crate::steptext::Surface::None;
        let long = f.name.chars().count() > 20 || f.name.contains(['\n', '\r']);
        let mut content: Vec<String> = Vec::new();
        let mut label = String::new();
        if holds_text || long || f.control == "ComboBox" {
            // SAFETY: COM calls on the thread that owns the element.
            unsafe {
                if let Ok(v) = el
                    .GetCurrentPattern(UIA_ValuePatternId)
                    .and_then(|p| p.cast::<IUIAutomationValuePattern>())
                {
                    if let Ok(value) = v.CurrentValue() {
                        content.push(value.to_string().chars().take(200).collect());
                    }
                }
                if let Ok(t) = el
                    .GetCurrentPattern(UIA_TextPatternId)
                    .and_then(|p| p.cast::<IUIAutomationTextPattern>())
                {
                    if let Ok(text) = t.DocumentRange().and_then(|r| r.GetText(200)) {
                        content.push(text.to_string());
                    }
                }
                if holds_text {
                    if let Ok(name) = el.CurrentLabeledBy().and_then(|l| l.CurrentName()) {
                        label = name.to_string();
                    }
                }
            }
        }
        // The value of a combo box is the chosen entry, which is what its click is about, not written text.
        if f.control == "ComboBox" {
            content.clear();
        }
        (f.name, f.surface) =
            crate::steptext::safe_name(&f.control, &class, &f.name, &label, &content);
    }

    /// What a field says about itself that decides whether typing into it is secret; `None` when it does not answer.
    /// Nothing of its content is read.
    fn secret_of(el: &IUIAutomationElement) -> Option<bool> {
        // SAFETY: COM calls on the thread that owns the element.
        unsafe {
            let control = control_word(el.CurrentControlType().ok()?.0);
            let password = el.CurrentIsPassword().ok()?.as_bool();
            let text = |t: windows::core::Result<windows::core::BSTR>| {
                t.map(|b| b.to_string()).unwrap_or_default()
            };
            Some(crate::secret::field_is_secret(
                password,
                control,
                &text(el.CurrentName()),
                &text(el.CurrentAutomationId()),
            ))
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
            if let Ok(c) = el.CurrentClassName() {
                f.classes.push(c.to_string());
            }
            f.password = el.CurrentIsPassword().is_ok_and(|b| b.as_bool());
            safe_text_name(el, &mut f);
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
                    if f.classes.len() < 4 {
                        if let Ok(c) = parent.CurrentClassName() {
                            f.classes.push(c.to_string());
                        }
                    }
                    cur = parent;
                }
            }
            Some(f)
        }
    }

    /// The render hosts of a Chromium window ("Chrome_RenderWidgetHostHWND", also inside the window of a web view app).
    fn render_hosts(root: HWND) -> Vec<isize> {
        use windows::core::BOOL;
        unsafe extern "system" fn each(h: HWND, l: LPARAM) -> BOOL {
            // SAFETY: `l` is the address of the Vec that `render_hosts` passes and that outlives the enumeration.
            let out = unsafe { &mut *(l.0 as *mut Vec<isize>) };
            if class_of(h).starts_with("Chrome_RenderWidgetHostHWND") {
                out.push(h.0 as isize);
            }
            true.into()
        }
        let mut out: Vec<isize> = Vec::new();
        if class_of(root).starts_with("Chrome_RenderWidgetHostHWND") {
            out.push(root.0 as isize);
        }
        // SAFETY: the callback only pushes into `out`, which lives until the call returns.
        unsafe {
            let _ = EnumChildWindows(Some(root), Some(each), LPARAM(&mut out as *mut _ as isize));
        }
        out
    }

    /// Chromium builds its accessibility tree only when a client asks for it: the first answer of a page that nobody asked about
    /// before has no names. So the render hosts of the window are asked once, early (WM_GETOBJECT with UiaRootObjectId, which Chromium
    /// takes as "a UI Automation client is here"), and the root and its first child are read, which makes the renderer build the tree.
    fn prime_chromium(
        auto: &IUIAutomation,
        root: isize,
        primed: &mut std::collections::HashSet<isize>,
    ) -> usize {
        let mut asked = 0;
        for h in render_hosts(HWND(root as *mut _)) {
            if !primed.insert(h) {
                continue;
            }
            let hwnd = HWND(h as *mut _);
            let mut res = 0usize;
            // SAFETY: a window handle; UiaRootObjectId is -25; the result goes to a local.
            unsafe {
                let _ = SendMessageTimeoutW(
                    hwnd,
                    WM_GETOBJECT,
                    WPARAM(0),
                    LPARAM(-25),
                    SMTO_ABORTIFHUNG,
                    300,
                    Some(&mut res),
                );
                if let Ok(el) = auto.ElementFromHandle(hwnd) {
                    let _ = el.CurrentName();
                    if let Ok(w) = auto.ControlViewWalker() {
                        let _ = w.GetFirstChildElement(&el);
                    }
                }
            }
            asked += 1;
        }
        asked
    }

    /// The top window that has the focus (0 when none).
    pub fn foreground_root() -> isize {
        // SAFETY: plain queries.
        unsafe {
            let fg = GetForegroundWindow();
            if fg.0.is_null() {
                return 0;
            }
            let root = GetAncestor(fg, GA_ROOT);
            (if root.0.is_null() { fg } else { root }).0 as isize
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
                                Req::Secret(s) => {
                                    let _ = s.send(None);
                                }
                                Req::Prime(_, s) => {
                                    if let Some(s) = s {
                                        let _ = s.send(0);
                                    }
                                }
                            }
                        }
                        return;
                    };
                    let mut primed: std::collections::HashSet<isize> = Default::default();
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
                            Req::Secret(s) => {
                                let secret =
                                    auto.GetFocusedElement().ok().and_then(|e| secret_of(&e));
                                let _ = s.send(secret);
                            }
                            Req::Prime(root, s) => {
                                let n = prime_chromium(&auto, root, &mut primed);
                                if let Some(s) = s {
                                    let _ = s.send(n);
                                }
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

        /// Is what goes into the focused field to be kept out of the guide? `None`: it could not be looked at in time.
        pub fn focus_is_secret(&self, limit: Duration) -> Option<bool> {
            let (s, r) = channel();
            self.tx.send(Req::Secret(s)).ok()?;
            r.recv_timeout(limit).ok().flatten()
        }

        /// Ask a Chromium window to build its accessibility tree (once per window); `wait`: how long to wait for the answer. Returns
        /// the number of render hosts that were asked (0 when the window has none, or on a timeout).
        pub fn prime(&self, root: isize, wait: Option<Duration>) -> usize {
            match wait {
                Some(limit) => {
                    let (s, r) = channel();
                    if self.tx.send(Req::Prime(root, Some(s))).is_err() {
                        return 0;
                    }
                    r.recv_timeout(limit).unwrap_or(0)
                }
                None => {
                    let _ = self.tx.send(Req::Prime(root, None));
                    0
                }
            }
        }
    }

    #[cfg(test)]
    mod secret_tests {
        use super::*;
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, DispatchMessageW, PeekMessageW, MSG, PM_REMOVE,
            WINDOW_STYLE, WS_CHILD, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };

        /// A real password box and a real ordinary box of Windows, in a window of this test that is never shown, asked
        /// through UI Automation by their handles (no other window is looked at).
        #[test]
        fn windows_says_which_of_two_real_edit_boxes_is_for_a_password() {
            const ES_PASSWORD: u32 = 0x0020;
            let (handles_tx, handles_rx) = channel::<(isize, isize)>();
            let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let done2 = done.clone();
            // The window's thread answers UI Automation while the test asks.
            let owner = std::thread::spawn(move || {
                // SAFETY: the windows are made, pumped and destroyed on this thread.
                unsafe {
                    let top = CreateWindowExW(
                        Default::default(),
                        w!("STATIC"),
                        w!("Snipmunk secret test"),
                        WS_OVERLAPPEDWINDOW,
                        0,
                        0,
                        300,
                        160,
                        None,
                        None,
                        None,
                        None,
                    )
                    .unwrap();
                    let edit = |style: u32, y: i32| {
                        CreateWindowExW(
                            Default::default(),
                            w!("EDIT"),
                            w!(""),
                            WINDOW_STYLE((WS_CHILD | WS_VISIBLE).0 | style),
                            10,
                            y,
                            200,
                            24,
                            Some(top),
                            None,
                            None,
                            None,
                        )
                        .unwrap()
                    };
                    let (password, plain) = (edit(ES_PASSWORD, 10), edit(0, 50));
                    handles_tx
                        .send((password.0 as isize, plain.0 as isize))
                        .unwrap();
                    let mut msg = MSG::default();
                    while !done2.load(std::sync::atomic::Ordering::SeqCst) {
                        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                            DispatchMessageW(&msg);
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    let _ = DestroyWindow(top);
                }
            });
            let (password, plain) = handles_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            // SAFETY: COM on this thread; the handles are the test's own windows.
            let answers = unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let auto: IUIAutomation =
                    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).unwrap();
                [password, plain].map(|h| {
                    let el = auto.ElementFromHandle(HWND(h as *mut _)).unwrap();
                    let facts = describe(&auto, &el).unwrap();
                    (secret_of(&el), facts.password)
                })
            };
            done.store(true, std::sync::atomic::Ordering::SeqCst);
            owner.join().unwrap();
            assert_eq!(answers, [(Some(true), true), (Some(false), false)]);
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
        pub fn prime(&self, _: isize, _: Option<Duration>) -> usize {
            0
        }
        pub fn focused(&self, _: Duration) -> Option<UiaFacts> {
            None
        }
        pub fn focus_is_secret(&self, _: Duration) -> Option<bool> {
            None
        }
    }
    pub fn point_belongs_to(_: i32, _: i32, _: u32, _: &[isize]) -> bool {
        false
    }
    pub fn window_at(_: i32, _: i32) -> Option<WinFacts> {
        None
    }
    pub fn foreground_is_elevated() -> bool {
        false
    }
    pub fn foreground_root() -> isize {
        0
    }
    pub fn root_at(_: i32, _: i32) -> isize {
        0
    }
    pub fn window_rect(_: isize) -> Option<[i32; 4]> {
        None
    }
    pub fn window_title(_: isize) -> String {
        String::new()
    }
    pub fn is_window(_: isize) -> bool {
        false
    }
    pub fn is_iconic(_: isize) -> bool {
        false
    }
    #[cfg(debug_assertions)]
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
                secret: false,
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

    async fn run_events(
        app: &AppHandle,
        hwnd: isize,
        events: Vec<Inject>,
        area: AreaMode,
    ) -> CmdResult<String> {
        let id = start_with(
            app.clone(),
            FrameSource::Window(hwnd),
            true,
            false,
            false,
            area,
            None,
        )
        .await?;
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
            let win = crate::webview::window(&app, "guidetest", tauri::WebviewUrl::External(url))
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
        let events: Vec<Inject> = if kind == "region" {
            vec![
                click(&targets, "save", Button::Left),
                ev(700),
                // outside the region: ignored
                click(&targets, "list", Button::Left),
                ev(700),
                click(&targets, "save", Button::Right),
                ev(700),
            ]
        } else if kind == "web" {
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
                    secret: false,
                },
                ev(500),
            ]);
            v
        };
        // "region": a guide of one area (around the Save button of the test window); a click outside it is ignored.
        let area = if kind == "region" {
            let (sx, sy) = targets["save"];
            AreaMode::Region(Rect::new(sx - 90, sy - 50, 180, 100))
        } else {
            AreaMode::Active
        };
        let id = run_events(&app, hwnd, events, area).await?;
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
        if kind == "region" {
            out = serde_json::json!({ "ignored": app.state::<GuideRec>().state().ignored, "area": app.state::<GuideRec>().state().area });
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

#[cfg(all(test, windows))]
mod app_name_tests {
    use super::facts;

    #[test]
    fn the_name_of_an_app_falls_back_from_the_package_to_the_product_to_the_exe_name() {
        // This test program has no package identity: no package name, and no lookup of any other process.
        assert_eq!(facts::package_display_name(std::process::id()), None);
        let exe = std::env::current_exe().unwrap();
        let stem = exe.file_stem().unwrap().to_string_lossy().into_owned();
        let name = facts::app_name(
            std::process::id(),
            &exe.to_string_lossy(),
            &stem,
            "A window title",
        );
        assert!(
            !name.is_empty() && !name.to_lowercase().ends_with(".exe") && name != "A window title",
            "{name}"
        );
        // An exe without version information: its name, never the title of the window.
        assert_eq!(
            facts::app_name(0, r"C:\nowhere\Foo.exe", "Foo", "Calculator"),
            "Foo"
        );
        assert_eq!(
            facts::app_name(0, "", "", "Calculator"),
            "Calculator",
            "nothing but the title"
        );
        // The frame of a UWP app is named by its window.
        assert_eq!(
            facts::app_name(
                0,
                r"C:\nowhere\ApplicationFrameHost.exe",
                "ApplicationFrameHost",
                "Calculator"
            ),
            "Calculator"
        );
    }

    #[test]
    fn a_long_file_description_gives_way_to_the_product_name() {
        let pick = |d: &str, p: &str, stem: &str| {
            facts::pick_app_name(Some(d.into()), Some(p.into()), stem)
        };
        let npp = Some("Notepad++".to_string());
        assert_eq!(
            pick(
                "Notepad++ : a free (GNU) source code editor",
                "Notepad++",
                "notepad++"
            ),
            npp
        );
        assert_eq!(pick("Notepad++", "Notepad++", "notepad++"), npp);
        // A description with more after a dash is cut; a product that is Windows itself is no name.
        assert_eq!(
            pick("Total Commander - file manager", "", "totalcmd"),
            Some("Total Commander".into())
        );
        assert_eq!(
            pick(
                "Notepad",
                "Microsoft\u{ae} Windows\u{ae} Operating System",
                "notepad"
            ),
            Some("Notepad".into())
        );
        assert_eq!(
            pick("Google Chrome", "Google Chrome", "chrome"),
            Some("Google Chrome".into())
        );
        // A file name is no name; a name that differs from the exe wins over one that repeats it.
        assert_eq!(
            pick("SnippingTool.exe", "Snipping Tool", "SnippingTool"),
            Some("Snipping Tool".into())
        );
        assert_eq!(facts::pick_app_name(None, None, "x"), None);
    }
}
