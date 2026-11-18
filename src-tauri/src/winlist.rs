//! The top-level windows on screen, for the Window capture mode: which window is under the pointer, and what to call a
//! capture of it. The rules for what counts (`keep`) and the hit test are pure and unit tested; `list_windows` asks
//! Windows (the extended frame bounds from DWM, so the rectangle does not include the invisible resize border).

use serde::Serialize;

use crate::geometry::Rect;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WinInfo {
    pub hwnd: isize,
    pub title: String,
    /// Desktop physical pixels.
    pub rect: Rect,
}

/// What Windows says about a window, before deciding whether it is a window the user would want to capture.
#[derive(Debug, Clone, Default)]
pub struct RawWin {
    pub visible: bool,
    pub minimized: bool,
    /// Hidden by the shell (a window on another virtual desktop, or a suspended app): visible, but not on screen.
    pub cloaked: bool,
    pub tool_window: bool,
    /// Has the "app window" style, which shows a tool window on the taskbar anyway.
    pub app_window: bool,
    /// One of Snipmunk's own windows.
    pub own: bool,
    pub class: String,
    pub title: String,
    pub rect: Option<Rect>,
}

/// Classes of the desktop itself and of windows that only host other things.
const SKIP_CLASSES: &[&str] = &["Progman", "WorkerW", "Windows.UI.Core.CoreWindow"];
/// Windows without a title that are still real: the taskbar.
const KEEP_UNTITLED: &[&str] = &["Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

/// Whether a window is one the user could point at: visible, on screen, not a tool window, not ours, with a size.
pub fn keep(w: &RawWin) -> bool {
    let Some(rect) = w.rect else {
        return false;
    };
    w.visible
        && !w.minimized
        && !w.cloaked
        && !w.own
        && (!w.tool_window || w.app_window)
        && rect.w >= 8
        && rect.h >= 8
        && !SKIP_CLASSES.contains(&w.class.as_str())
        && (!w.title.trim().is_empty() || KEEP_UNTITLED.contains(&w.class.as_str()))
}

/// The topmost window under a point. `windows` is in z-order, topmost first (the order `EnumWindows` reports).
pub fn hit_test(windows: &[WinInfo], p: (i32, i32)) -> Option<&WinInfo> {
    windows.iter().find(|w| w.rect.contains(p))
}

#[cfg(windows)]
pub fn list_windows() -> Vec<WinInfo> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowLongW, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = unsafe { &mut *(lparam.0 as *mut Vec<WinInfo>) };
        let mut raw = RawWin {
            visible: unsafe { IsWindowVisible(hwnd) }.as_bool(),
            minimized: unsafe { IsIconic(hwnd) }.as_bool(),
            ..RawWin::default()
        };
        if !raw.visible || raw.minimized {
            return BOOL(1);
        }
        let mut cloaked = 0u32;
        let _ = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
        };
        raw.cloaked = cloaked != 0;
        let ex = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        raw.tool_window = ex & WS_EX_TOOLWINDOW.0 != 0;
        raw.app_window = ex & WS_EX_APPWINDOW.0 != 0;
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        raw.own = pid == unsafe { GetCurrentProcessId() };
        let mut class = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, &mut class) };
        raw.class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        let mut title = [0u16; 512];
        let n = unsafe { GetWindowTextW(hwnd, &mut title) };
        raw.title = String::from_utf16_lossy(&title[..n.max(0) as usize]);
        let mut frame = RECT::default();
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut frame as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
        }
        .is_ok();
        if ok {
            raw.rect = Some(Rect::new(
                frame.left,
                frame.top,
                (frame.right - frame.left).max(0) as u32,
                (frame.bottom - frame.top).max(0) as u32,
            ));
        }
        if keep(&raw) {
            if let Some(rect) = raw.rect {
                out.push(WinInfo {
                    hwnd: hwnd.0 as isize,
                    title: raw.title,
                    rect,
                });
            }
        }
        BOOL(1)
    }

    let mut list: Vec<WinInfo> = Vec::new();
    // SAFETY: `each` only runs during this call, and `list` outlives it.
    let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut list as *mut Vec<WinInfo> as isize)) };
    list
}

#[cfg(not(windows))]
pub fn list_windows() -> Vec<WinInfo> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw() -> RawWin {
        RawWin {
            visible: true,
            title: "Notepad".into(),
            class: "Notepad".into(),
            rect: Some(Rect::new(10, 10, 400, 300)),
            ..RawWin::default()
        }
    }

    #[test]
    fn an_ordinary_visible_window_is_kept() {
        assert!(keep(&raw()));
    }

    #[test]
    fn invisible_minimized_cloaked_tool_and_own_windows_are_skipped() {
        for tweak in [
            |w: &mut RawWin| w.visible = false,
            |w: &mut RawWin| w.minimized = true,
            |w: &mut RawWin| w.cloaked = true,
            |w: &mut RawWin| w.tool_window = true,
            |w: &mut RawWin| w.own = true,
            |w: &mut RawWin| w.rect = None,
            |w: &mut RawWin| w.rect = Some(Rect::new(0, 0, 4, 300)),
        ] {
            let mut w = raw();
            tweak(&mut w);
            assert!(!keep(&w), "{w:?}");
        }
    }

    #[test]
    fn a_tool_window_with_the_app_window_style_is_kept() {
        let mut w = raw();
        w.tool_window = true;
        w.app_window = true;
        assert!(keep(&w));
    }

    #[test]
    fn the_desktop_and_untitled_helper_windows_are_skipped_but_the_taskbar_is_kept() {
        let mut desktop = raw();
        desktop.class = "Progman".into();
        assert!(!keep(&desktop));
        let mut helper = raw();
        helper.title = "  ".into();
        assert!(!keep(&helper));
        helper.class = "Shell_TrayWnd".into();
        assert!(keep(&helper));
    }

    #[test]
    fn the_topmost_window_under_the_pointer_wins() {
        let list = vec![
            WinInfo {
                hwnd: 1,
                title: "front".into(),
                rect: Rect::new(100, 100, 200, 200),
            },
            WinInfo {
                hwnd: 2,
                title: "back".into(),
                rect: Rect::new(0, 0, 500, 500),
            },
        ];
        assert_eq!(hit_test(&list, (150, 150)).map(|w| w.hwnd), Some(1));
        assert_eq!(hit_test(&list, (50, 50)).map(|w| w.hwnd), Some(2));
        assert_eq!(hit_test(&list, (600, 600)), None);
        // The right and bottom edges belong to the next pixel.
        assert_eq!(hit_test(&list, (300, 150)).map(|w| w.hwnd), Some(2));
    }
}
