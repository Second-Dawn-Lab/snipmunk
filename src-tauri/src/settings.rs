//! App settings, persisted as JSON in the Snipmunk data folder.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "system" or one of `LANGUAGES`
    pub language: String,
    /// Start with Windows (hidden, in the tray).
    pub launch_at_login: bool,
    /// What the window's close button does: "background" | "quit" | "ask"
    pub close_action: String,
    /// The capture shortcut. Only stored in Phase 2; the keyboard hook is wired in Phase 3.
    pub capture_hotkey: String,
    pub always_on_top: bool,
    /// Where "export" puts screenshots ("" = not chosen yet).
    pub export_folder: String,
    /// What "New session" does with the current screenshots: "ask" | "autoExport" | "clear"
    pub new_session_action: String,
    /// Delete the kept session when Snipmunk quits.
    pub clear_on_exit: bool,
    /// Kept sessions older than this many days are deleted at startup (0 = keep forever).
    pub retention_days: u32,
    /// How the Copy button puts several screenshots on the clipboard: "separate" | "stack" | "grid"
    pub default_copy_mode: String,
    /// How the capture list looks: "list" | "medium" | "large"
    pub gallery_view: String,
    /// The chosen capture mode: "rectangle" | "window" | "fullscreen" | "freeform"
    pub capture_mode: String,
    /// Seconds to wait before a capture: 0, 3, 5 or 10.
    pub capture_delay: u32,
    /// What happens after a capture: "front" (bring Snipmunk to the front) | "background" (show a small notification)
    pub after_capture: String,
    /// Put every new capture on the clipboard.
    pub auto_copy_to_clipboard: bool,
    /// Show the magnifier loupe while selecting.
    pub show_magnifier: bool,
    // The last colors and sizes picked in the annotation tool popovers (used by the tools from Phase 5).
    // Colors are "#rrggbb"; the fill and outline may also be "none".
    pub last_pen_color: String,
    pub last_pen_size: u32,
    pub last_highlighter_color: String,
    pub last_highlighter_size: u32,
    pub last_fill_color: String,
    /// 0 to 100
    pub last_fill_opacity: u32,
    pub last_outline_color: String,
    /// 0 to 100
    pub last_outline_opacity: u32,
    pub last_outline_size: u32,
    // The Text tool: colour ("#rrggbb"), size in image pixels (8 to 400) and a solid label behind the text.
    pub last_text_color: String,
    pub last_text_size: u32,
    pub last_text_background: bool,
    /// Mouse wheel in the editor: "zoom" (wheel zooms, Shift pans) or "scroll" (wheel pans, Ctrl zooms).
    pub editor_wheel: String,
    /// Recognize the text of every new capture in the background.
    pub ocr_auto: bool,
    /// The OCR languages: "auto" (every one Windows has) or a comma separated list of tags ("de-DE,en-GB").
    pub ocr_languages: String,
    /// Quick redact: cover e-mail addresses / phone numbers.
    pub quick_redact_email: bool,
    pub quick_redact_phone: bool,
    /// Quick redact: credit card numbers, IBANs, passwords and secrets, the user's own words.
    pub quick_redact_card: bool,
    pub quick_redact_iban: bool,
    pub quick_redact_secret: bool,
    pub quick_redact_custom: bool,
    /// The user's own words to cover (Settings, Text recognition).
    pub quick_redact_words: Vec<String>,
    /// A custom word must be a whole word.
    pub quick_redact_whole_word: bool,
    /// The top bar mode: "screenshot" | "video"
    pub capture_kind: String,
    /// Screen recording: the area ("rectangle" | "window" | "fullscreen"), the countdown (0, 3, 5, 10 s), the frame rate (30 | 60),
    /// the quality ("standard" | "high"), system sound, microphone.
    pub rec_mode: String,
    pub rec_countdown: u32,
    pub rec_fps: u32,
    pub rec_quality: String,
    pub rec_system_sound: bool,
    pub rec_mic: bool,
    /// Save: "png" | "jpeg" | "webp" | "bmp" | "zip"
    pub save_format: String,
    /// File names: "capture" | "group" | "dateTime"
    pub save_naming: String,
    /// JPEG / WebP quality, 10 to 100.
    pub save_quality: u32,
    /// The folder the last save went to (when no export folder is set).
    pub last_save_folder: String,
}

/// The interface languages (the language setting may also be "system").
pub const LANGUAGES: [&str; 12] = [
    "en", "de", "es", "fr", "it", "nl", "pl", "tr", "zh-Hans", "zh-Hant", "ar", "ur",
];

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "system".into(),
            launch_at_login: false,
            close_action: "background".into(),
            capture_hotkey: "Ctrl+Alt+PrintScreen".into(),
            always_on_top: false,
            export_folder: String::new(),
            new_session_action: "ask".into(),
            clear_on_exit: false,
            retention_days: 30,
            default_copy_mode: "separate".into(),
            gallery_view: "list".into(),
            capture_mode: "rectangle".into(),
            capture_delay: 0,
            after_capture: "front".into(),
            auto_copy_to_clipboard: true,
            show_magnifier: true,
            last_pen_color: "#E53935".into(),
            last_pen_size: 4,
            last_highlighter_color: "#FFEB3B".into(),
            last_highlighter_size: 18,
            last_fill_color: "none".into(),
            last_fill_opacity: 100,
            last_outline_color: "#E53935".into(),
            last_outline_opacity: 100,
            last_outline_size: 3,
            last_text_color: "#E53935".into(),
            last_text_size: 28,
            last_text_background: false,
            editor_wheel: "zoom".into(),
            ocr_auto: true,
            ocr_languages: "auto".into(),
            quick_redact_email: true,
            quick_redact_phone: true,
            quick_redact_card: true,
            quick_redact_iban: true,
            quick_redact_secret: true,
            quick_redact_custom: true,
            quick_redact_words: Vec::new(),
            quick_redact_whole_word: true,
            capture_kind: "screenshot".into(),
            rec_mode: "rectangle".into(),
            rec_countdown: 3,
            rec_fps: 30,
            rec_quality: "standard".into(),
            rec_system_sound: true,
            rec_mic: false,
            save_format: "png".into(),
            save_naming: "capture".into(),
            save_quality: 90,
            last_save_folder: String::new(),
        }
    }
}

/// Custom words: trimmed, not empty, not longer than 100 characters, no duplicates (case-insensitive), at most 200.
fn clean_words(words: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    words
        .into_iter()
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty() && w.chars().count() <= 100)
        .filter(|w| seen.insert(w.to_lowercase()))
        .take(200)
        .collect()
}

/// Use `value` if it is one of `allowed`, else `fallback`.
fn one_of(value: &mut String, allowed: &[&str], fallback: &str) {
    if !allowed.contains(&value.as_str()) {
        *value = fallback.into();
    }
}

/// Keep `value` if it is "#rrggbb" (or "none" when allowed), else use `fallback`.
fn color_or(value: &mut String, allow_none: bool, fallback: &str) {
    let hex = value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !(hex || (allow_none && value == "none")) {
        *value = fallback.into();
    }
}

impl Settings {
    pub fn path() -> PathBuf {
        dawn_core::app_dir("snipmunk").join("settings.json")
    }

    pub fn load() -> Self {
        let mut s: Self = dawn_core::read_json(&Self::path());
        s.normalize();
        s
    }

    /// Replace values a hand-edited or newer settings file could hold that this version cannot use.
    pub fn normalize(&mut self) {
        let d = Self::default();
        one_of(&mut self.theme, &["system", "light", "dark"], &d.theme);
        if self.language != "system" && !LANGUAGES.contains(&self.language.as_str()) {
            self.language = d.language.clone();
        }
        one_of(
            &mut self.gallery_view,
            &["list", "medium", "large"],
            &d.gallery_view,
        );
        one_of(
            &mut self.capture_mode,
            &["rectangle", "window", "fullscreen", "freeform"],
            &d.capture_mode,
        );
        one_of(
            &mut self.after_capture,
            &["front", "background"],
            &d.after_capture,
        );
        if ![0, 3, 5, 10].contains(&self.capture_delay) {
            self.capture_delay = d.capture_delay;
        }
        color_or(&mut self.last_pen_color, false, &d.last_pen_color);
        color_or(
            &mut self.last_highlighter_color,
            false,
            &d.last_highlighter_color,
        );
        color_or(&mut self.last_fill_color, true, &d.last_fill_color);
        color_or(&mut self.last_outline_color, true, &d.last_outline_color);
        self.last_fill_opacity = self.last_fill_opacity.min(100);
        self.last_outline_opacity = self.last_outline_opacity.min(100);
        self.last_pen_size = self.last_pen_size.clamp(1, 60);
        self.last_highlighter_size = self.last_highlighter_size.clamp(1, 60);
        self.last_outline_size = self.last_outline_size.clamp(1, 60);
        self.last_text_size = self.last_text_size.clamp(8, 400);
        one_of(&mut self.editor_wheel, &["zoom", "scroll"], &d.editor_wheel);
        // Language tags only: letters, digits and dashes, separated by commas.
        let ok = self.ocr_languages == "auto"
            || self.ocr_languages.split(',').all(|t| {
                !t.is_empty()
                    && t.len() <= 16
                    && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            });
        if !ok {
            self.ocr_languages = d.ocr_languages.clone();
        }
        color_or(&mut self.last_text_color, false, &d.last_text_color);
        one_of(
            &mut self.save_format,
            &["png", "jpeg", "webp", "bmp", "zip"],
            &d.save_format,
        );
        one_of(
            &mut self.save_naming,
            &["capture", "group", "dateTime"],
            &d.save_naming,
        );
        self.save_quality = self.save_quality.clamp(10, 100);
        one_of(
            &mut self.capture_kind,
            &["screenshot", "video"],
            &d.capture_kind,
        );
        one_of(
            &mut self.rec_mode,
            &["rectangle", "window", "fullscreen"],
            &d.rec_mode,
        );
        one_of(&mut self.rec_quality, &["standard", "high"], &d.rec_quality);
        if ![0, 3, 5, 10].contains(&self.rec_countdown) {
            self.rec_countdown = d.rec_countdown;
        }
        if ![30, 60].contains(&self.rec_fps) {
            self.rec_fps = d.rec_fps;
        }
        self.quick_redact_words = clean_words(std::mem::take(&mut self.quick_redact_words));
        one_of(
            &mut self.close_action,
            &["background", "quit", "ask"],
            &d.close_action,
        );
        one_of(
            &mut self.new_session_action,
            &["ask", "autoExport", "clear"],
            &d.new_session_action,
        );
        one_of(
            &mut self.default_copy_mode,
            &["separate", "stack", "grid"],
            &d.default_copy_mode,
        );
        if self.capture_hotkey.trim().is_empty() {
            self.capture_hotkey = d.capture_hotkey;
        }
    }

    pub fn save(&self) -> std::io::Result<()> {
        dawn_core::write_json(&Self::path(), self)
    }

    /// Merge a partial JSON object into the settings (unknown keys are ignored).
    pub fn merge(&mut self, patch: Value) -> Result<(), serde_json::Error> {
        let mut current = serde_json::to_value(&*self)?;
        if let (Value::Object(base), Value::Object(extra)) = (&mut current, patch) {
            base.extend(extra);
        }
        *self = serde_json::from_value(current)?;
        self.normalize();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_spec() {
        let s = Settings::default();
        assert_eq!(s.capture_hotkey, "Ctrl+Alt+PrintScreen");
        assert_eq!(s.close_action, "background");
        assert_eq!(s.new_session_action, "ask");
        assert_eq!(s.retention_days, 30);
        assert_eq!(s.default_copy_mode, "separate");
        assert!(!s.clear_on_exit && !s.launch_at_login && !s.always_on_top);
    }

    #[test]
    fn copying_each_capture_is_on_for_new_installs_and_fresh_files() {
        assert!(Settings::default().auto_copy_to_clipboard);
        // A settings file without the key (an older version, or an empty file) gets the default: on.
        let fresh: Settings = serde_json::from_str("{}").unwrap();
        assert!(fresh.auto_copy_to_clipboard);
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(old.auto_copy_to_clipboard);
    }

    #[test]
    fn the_recording_settings_are_checked() {
        let mut s = Settings::default();
        assert_eq!(
            (
                s.capture_kind.as_str(),
                s.rec_fps,
                s.rec_countdown,
                s.rec_system_sound,
                s.rec_mic
            ),
            ("screenshot", 30, 3, true, false)
        );
        s.merge(serde_json::json!({"captureKind": "video", "recFps": 60, "recQuality": "high", "recMode": "fullscreen", "recCountdown": 10}))
            .unwrap();
        assert_eq!(
            (s.capture_kind.as_str(), s.rec_fps, s.rec_quality.as_str()),
            ("video", 60, "high")
        );
        s.merge(serde_json::json!({"captureKind": "gif", "recFps": 24, "recQuality": "x", "recMode": "freeform", "recCountdown": 7}))
            .unwrap();
        assert_eq!(
            (
                s.capture_kind.as_str(),
                s.rec_fps,
                s.rec_quality.as_str(),
                s.rec_mode.as_str(),
                s.rec_countdown
            ),
            ("screenshot", 30, "standard", "rectangle", 3)
        );
    }

    #[test]
    fn the_gallery_view_is_checked() {
        assert_eq!(Settings::default().gallery_view, "list");
        let mut s = Settings::default();
        s.merge(serde_json::json!({"galleryView": "large"}))
            .unwrap();
        assert_eq!(s.gallery_view, "large");
        s.merge(serde_json::json!({"galleryView": "huge"})).unwrap();
        assert_eq!(
            s.gallery_view, "list",
            "an unknown view falls back to the list"
        );
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(old.gallery_view, "list");
    }

    #[test]
    fn the_text_tool_settings_are_checked() {
        let mut s = Settings::default();
        assert_eq!((s.last_text_size, s.last_text_background), (28, false));
        s.merge(serde_json::json!({"lastTextColor": "none", "lastTextSize": 9000, "lastTextBackground": true}))
            .unwrap();
        assert_eq!(s.last_text_color, "#E53935", "text has no 'none' colour");
        assert_eq!(s.last_text_size, 400);
        assert!(s.last_text_background);
        s.merge(serde_json::json!({"lastTextColor": "#112233", "lastTextSize": 2}))
            .unwrap();
        assert_eq!(
            (s.last_text_color.as_str(), s.last_text_size),
            ("#112233", 8)
        );
    }

    #[test]
    fn the_text_recognition_and_wheel_settings_are_checked() {
        let s = Settings::default();
        assert_eq!(
            (
                s.editor_wheel.as_str(),
                s.ocr_auto,
                s.ocr_languages.as_str()
            ),
            ("zoom", true, "auto")
        );
        assert!(s.quick_redact_email && s.quick_redact_phone);
        let mut s = s;
        s.merge(serde_json::json!({"editorWheel": "scroll", "ocrLanguages": "de-DE,en-GB", "ocrAuto": false}))
            .unwrap();
        assert_eq!(
            (
                s.editor_wheel.as_str(),
                s.ocr_languages.as_str(),
                s.ocr_auto
            ),
            ("scroll", "de-DE,en-GB", false)
        );
        s.merge(serde_json::json!({"editorWheel": "fly", "ocrLanguages": "de,, x y"}))
            .unwrap();
        assert_eq!(
            (s.editor_wheel.as_str(), s.ocr_languages.as_str()),
            ("zoom", "auto")
        );
    }

    #[test]
    fn old_or_partial_files_load_with_defaults() {
        let s: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.retention_days, 30);
        assert_eq!(s.language, "system");
    }

    #[test]
    fn camel_case_keys_are_used() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        for key in [
            "launchAtLogin",
            "closeAction",
            "captureHotkey",
            "alwaysOnTop",
            "exportFolder",
            "newSessionAction",
            "clearOnExit",
            "retentionDays",
            "defaultCopyMode",
            "captureMode",
            "captureDelay",
            "afterCapture",
            "autoCopyToClipboard",
            "showMagnifier",
            "lastPenColor",
            "lastOutlineSize",
        ] {
            assert!(v.get(key).is_some(), "{key}");
        }
    }

    #[test]
    fn merge_applies_a_patch_and_ignores_unknown_keys() {
        let mut s = Settings::default();
        s.merge(serde_json::json!({"retentionDays": 0, "nope": 1, "theme": "light"}))
            .unwrap();
        assert_eq!(s.retention_days, 0);
        assert_eq!(s.theme, "light");
    }

    #[test]
    fn unusable_values_fall_back_to_the_defaults() {
        let mut s = Settings::default();
        s.merge(serde_json::json!({"closeAction": "explode", "defaultCopyMode": "x", "captureHotkey": " ", "language": "xx"}))
            .unwrap();
        assert_eq!(s.close_action, "background");
        assert_eq!(s.default_copy_mode, "separate");
        assert_eq!(s.capture_hotkey, "Ctrl+Alt+PrintScreen");
        assert_eq!(s.language, "system");
    }

    #[test]
    fn every_interface_language_and_system_are_accepted() {
        for l in LANGUAGES.iter().chain(["system"].iter()) {
            let mut s = Settings::default();
            s.merge(serde_json::json!({ "language": l })).unwrap();
            assert_eq!(s.language, *l);
        }
    }

    #[test]
    fn capture_and_tool_settings_are_checked() {
        let mut s = Settings::default();
        assert_eq!((s.capture_mode.as_str(), s.capture_delay), ("rectangle", 0));
        assert_eq!(s.after_capture, "front");
        assert!(s.auto_copy_to_clipboard && s.show_magnifier);
        s.merge(serde_json::json!({"afterCapture": "elsewhere", "autoCopyToClipboard": false}))
            .unwrap();
        assert_eq!(s.after_capture, "front");
        assert!(!s.auto_copy_to_clipboard);
        s.merge(serde_json::json!({
            "captureMode": "freeform", "captureDelay": 5,
            "lastPenColor": "#00ff00", "lastFillColor": "none", "lastFillOpacity": 40,
            "lastPenSize": 12
        }))
        .unwrap();
        assert_eq!((s.capture_mode.as_str(), s.capture_delay), ("freeform", 5));
        assert_eq!(s.last_pen_color, "#00ff00");
        assert_eq!(
            (s.last_fill_color.as_str(), s.last_fill_opacity),
            ("none", 40)
        );
        s.merge(serde_json::json!({
            "captureMode": "scribble", "captureDelay": 7, "lastPenColor": "none",
            "lastFillColor": "red", "lastFillOpacity": 900, "lastPenSize": 0, "lastOutlineSize": 999
        }))
        .unwrap();
        assert_eq!((s.capture_mode.as_str(), s.capture_delay), ("rectangle", 0));
        assert_eq!(s.last_pen_color, "#E53935", "the pen has no 'none'");
        assert_eq!(s.last_fill_color, "none");
        assert_eq!(s.last_fill_opacity, 100);
        assert_eq!((s.last_pen_size, s.last_outline_size), (1, 60));
    }

    #[test]
    fn a_wrong_type_is_an_error_not_a_silent_reset() {
        let mut s = Settings::default();
        assert!(s
            .merge(serde_json::json!({"retentionDays": "many"}))
            .is_err());
    }

    #[test]
    fn the_phase_6_settings_are_checked() {
        let mut s = Settings::default();
        assert!(
            s.quick_redact_card
                && s.quick_redact_iban
                && s.quick_redact_secret
                && s.quick_redact_custom
        );
        assert_eq!(
            (
                s.save_format.as_str(),
                s.save_naming.as_str(),
                s.save_quality
            ),
            ("png", "capture", 90)
        );
        s.merge(serde_json::json!({
            "saveFormat": "tiff", "saveNaming": "random", "saveQuality": 3,
            "quickRedactWords": ["  Falcon ", "falcon", "", "Project X"]
        }))
        .unwrap();
        assert_eq!(
            (
                s.save_format.as_str(),
                s.save_naming.as_str(),
                s.save_quality
            ),
            ("png", "capture", 10)
        );
        assert_eq!(
            s.quick_redact_words,
            vec!["Falcon".to_string(), "Project X".to_string()]
        );
        s.merge(serde_json::json!({"saveFormat": "zip", "saveQuality": 500}))
            .unwrap();
        assert_eq!((s.save_format.as_str(), s.save_quality), ("zip", 100));
    }
}
