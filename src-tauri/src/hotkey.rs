//! The capture shortcut: a keyboard hook from `dawn-hotkeys` that only observes keys. The hook callback just sends the
//! event to a worker thread; the worker starts the capture on yet another thread, so a key press never waits for us.

use std::sync::Mutex;

use dawn_hotkeys::detector::Outcome;
use dawn_hotkeys::shortcut::Shortcut;
use dawn_hotkeys::Hotkeys;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// What the user needs to know about the capture shortcut.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// "ok", "invalid" (the shortcut cannot be used) or "hook" (the keyboard hook could not be installed).
    pub state: String,
    /// The shortcut as written in the settings.
    pub shortcut: String,
    /// Why it does not work, for the notice (English detail; the page adds the translated explanation).
    pub message: String,
}

impl HotkeyStatus {
    fn ok(shortcut: &str) -> Self {
        Self {
            state: "ok".into(),
            shortcut: shortcut.into(),
            message: String::new(),
        }
    }
}

pub struct HotkeyManager {
    hook: Mutex<Option<Hotkeys>>,
    status: Mutex<HotkeyStatus>,
}

impl HotkeyManager {
    pub fn new() -> Self {
        Self {
            hook: Mutex::new(None),
            status: Mutex::new(HotkeyStatus::ok("")),
        }
    }

    pub fn status(&self) -> HotkeyStatus {
        self.status.lock().unwrap().clone()
    }
}

/// Parse the setting. The error is the reason, ready for the notice.
pub fn parse(text: &str) -> Result<Shortcut, String> {
    text.parse::<Shortcut>().map_err(|e| e.to_string())
}

/// Make the keyboard hook follow the setting (called at startup and whenever the shortcut changes). Installs the hook
/// when needed; an unusable shortcut leaves the hook without shortcuts and reports why.
pub fn apply(app: &AppHandle, text: &str) {
    let manager = app.state::<HotkeyManager>();
    let status = match parse(text) {
        Err(message) => {
            if let Some(hook) = manager.hook.lock().unwrap().as_ref() {
                hook.set_shortcuts(Vec::new());
            }
            HotkeyStatus {
                state: "invalid".into(),
                shortcut: text.into(),
                message,
            }
        }
        Ok(shortcut) => {
            let mut hook = manager.hook.lock().unwrap();
            if let Some(h) = hook.as_ref() {
                h.set_shortcuts(vec![("capture".into(), shortcut)]);
                HotkeyStatus::ok(text)
            } else {
                let handle = app.clone();
                let started =
                    Hotkeys::start(vec![("capture".into(), shortcut)], move |_, outcome| {
                        if outcome == Outcome::Fired {
                            crate::capture::trigger(&handle);
                        }
                    });
                match started {
                    Ok(h) => {
                        *hook = Some(h);
                        HotkeyStatus::ok(text)
                    }
                    Err(err) => HotkeyStatus {
                        state: "hook".into(),
                        shortcut: text.into(),
                        message: err.to_string(),
                    },
                }
            }
        }
    };
    let changed = {
        let mut current = manager.status.lock().unwrap();
        let changed = *current != status;
        *current = status.clone();
        changed
    };
    if changed {
        let _ = app.emit("hotkey-status", &status);
    }
}

/// Remove the keyboard hook (the app is quitting).
pub fn stop(app: &AppHandle) {
    if let Some(manager) = app.try_state::<HotkeyManager>() {
        manager.hook.lock().unwrap().take();
    }
}

/// How the shortcut check of the settings window answers.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutCheck {
    pub valid: bool,
    pub error: Option<String>,
    /// The shortcut in its fixed spelling ("Ctrl+Alt+PrintScreen").
    pub canonical: Option<String>,
    /// "windows" (Windows already uses it), "shared" (other programs use it too), or none.
    pub warning: Option<String>,
}

/// Shortcuts that Windows itself reacts to for screenshots. Snipmunk only observes keys, so Windows still reacts.
const WINDOWS_SCREENSHOT: &[&str] = &[
    "Alt+PrintScreen",
    "Win+PrintScreen",
    "Win+Shift+S",
    "Win+Alt+PrintScreen",
];

pub fn check(text: &str) -> ShortcutCheck {
    let shortcut = match parse(text) {
        Ok(s) => s,
        Err(e) => {
            return ShortcutCheck {
                valid: false,
                error: Some(e),
                canonical: None,
                warning: None,
            }
        }
    };
    let warning = if WINDOWS_SCREENSHOT
        .iter()
        .any(|k| k.parse::<Shortcut>().is_ok_and(|w| w.same_combo(&shortcut)))
    {
        Some("windows".to_string())
    } else if dawn_hotkeys::shortcut::known_shortcut(&shortcut).is_some()
        || dawn_hotkeys::shortcut::everyday_shortcut_warning(&shortcut).is_some()
    {
        Some("shared".to_string())
    } else {
        None
    };
    ShortcutCheck {
        valid: true,
        error: None,
        canonical: Some(shortcut.to_string()),
        warning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_shortcut_is_valid_and_has_no_warning() {
        let c = check("Ctrl+Alt+PrintScreen");
        assert!(c.valid);
        assert_eq!(c.canonical.as_deref(), Some("Ctrl+Alt+PrintScreen"));
        assert_eq!(c.warning, None);
    }

    #[test]
    fn spellings_are_made_canonical() {
        assert_eq!(
            check("alt + ctrl + prtscn").canonical.as_deref(),
            Some("Ctrl+Alt+PrintScreen")
        );
    }

    #[test]
    fn bad_shortcuts_say_why() {
        assert!(!check("PrintScreen").valid, "needs a modifier");
        assert!(!check("").valid);
        assert!(!check("Ctrl+Nope").valid);
        assert!(check("Ctrl+Nope").error.is_some());
    }

    #[test]
    fn shortcuts_windows_or_other_programs_use_are_flagged() {
        assert_eq!(check("Alt+PrintScreen").warning.as_deref(), Some("windows"));
        assert_eq!(check("Win+Shift+S").warning.as_deref(), Some("windows"));
        assert_eq!(check("Ctrl+P").warning.as_deref(), Some("shared"));
        assert_eq!(check("Ctrl+C").warning.as_deref(), Some("shared"));
    }
}
