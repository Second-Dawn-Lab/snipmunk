//! How a recording looks when it is played and exported (the cursor, the click effects, the webcam overlay, the trim) and what an
//! export is asked to make. The effects are stored in the recording's `recording.json` (key `effects`), so they can be changed after
//! the recording; the page edits them (`src/recording/effects.ts` has the same shape) and the export draws them
//! (`render.rs` with the shapes of `compose.rs`).

use serde::{Deserialize, Serialize};

use crate::compose::{Aspect, Fit, Shape};
use crate::settings::{is_hex_color, Settings};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CursorFx {
    pub show: bool,
    /// "1" | "1.5" | "2"
    pub size: String,
    pub halo: bool,
    pub halo_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ClickFx {
    /// "off" | "ripple" | "burst"
    pub kind: String,
    pub left: String,
    pub right: String,
    /// "small" | "medium" | "large"
    pub size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WebcamFx {
    pub show: bool,
    /// "circle" | "rounded" | "rect"
    pub shape: String,
    /// "s" | "m" | "l"
    pub size: String,
    /// "top-left" | "top-right" | "bottom-left" | "bottom-right" | "free" (then `x`, `y` is the centre, as fractions of the picture)
    pub position: String,
    pub x: f32,
    pub y: f32,
    pub border: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Trim {
    pub start_ms: u64,
    /// `None` = to the end.
    pub end_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Effects {
    pub cursor: CursorFx,
    pub click: ClickFx,
    pub webcam: WebcamFx,
    pub trim: Trim,
}

impl Default for CursorFx {
    fn default() -> Self {
        Self {
            show: true,
            size: "1".into(),
            halo: false,
            halo_color: "#FFD60A".into(),
        }
    }
}

impl Default for ClickFx {
    fn default() -> Self {
        Self {
            kind: "ripple".into(),
            left: "#3B82F6".into(),
            right: "#F97316".into(),
            size: "medium".into(),
        }
    }
}

impl Default for WebcamFx {
    fn default() -> Self {
        Self {
            show: true,
            shape: "circle".into(),
            size: "m".into(),
            position: "bottom-right".into(),
            x: 0.85,
            y: 0.85,
            border: true,
        }
    }
}

impl Effects {
    /// The defaults a new recording starts with (the settings of the Recording page).
    pub fn from_settings(s: &Settings) -> Self {
        Self {
            cursor: CursorFx {
                show: s.cursor_show,
                size: s.cursor_size.clone(),
                halo: s.cursor_halo,
                halo_color: s.cursor_halo_color.clone(),
            },
            click: ClickFx {
                kind: s.click_effect.clone(),
                left: s.click_left_color.clone(),
                right: s.click_right_color.clone(),
                size: s.click_size.clone(),
            },
            webcam: WebcamFx {
                show: true,
                shape: s.webcam_shape.clone(),
                size: s.webcam_size.clone(),
                position: s.webcam_position.clone(),
                x: 0.85,
                y: 0.85,
                border: s.webcam_border,
            },
            trim: Trim::default(),
        }
    }

    /// Every field valid: what is not one of the allowed values becomes the default.
    pub fn cleaned(mut self) -> Self {
        let d = Effects::default();
        fn one(v: &mut String, allowed: &[&str], d: &str) {
            if !allowed.contains(&v.as_str()) {
                *v = d.to_string();
            }
        }
        fn colour(v: &mut String, d: &str) {
            if !is_hex_color(v) {
                *v = d.to_string();
            }
        }
        one(&mut self.cursor.size, &["1", "1.5", "2"], &d.cursor.size);
        colour(&mut self.cursor.halo_color, &d.cursor.halo_color);
        one(
            &mut self.click.kind,
            &["off", "ripple", "burst"],
            &d.click.kind,
        );
        colour(&mut self.click.left, &d.click.left);
        colour(&mut self.click.right, &d.click.right);
        one(
            &mut self.click.size,
            &["small", "medium", "large"],
            &d.click.size,
        );
        one(
            &mut self.webcam.shape,
            &["circle", "rounded", "rect"],
            &d.webcam.shape,
        );
        one(&mut self.webcam.size, &["s", "m", "l"], &d.webcam.size);
        one(
            &mut self.webcam.position,
            &[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
                "free",
            ],
            &d.webcam.position,
        );
        self.webcam.x = self.webcam.x.clamp(0.0, 1.0);
        self.webcam.y = self.webcam.y.clamp(0.0, 1.0);
        if let Some(end) = self.trim.end_ms {
            if end <= self.trim.start_ms {
                self.trim.end_ms = None;
            }
        }
        self
    }

    pub fn cursor_scale(&self) -> f32 {
        match self.cursor.size.as_str() {
            "2" => 2.0,
            "1.5" => 1.5,
            _ => 1.0,
        }
    }

    /// The click effect's radius as a fraction of the picture height.
    pub fn click_radius(&self) -> f32 {
        match self.click.size.as_str() {
            "small" => 0.03,
            "large" => 0.08,
            _ => 0.05,
        }
    }

    pub fn webcam_shape(&self) -> Shape {
        match self.webcam.shape.as_str() {
            "rounded" => Shape::Rounded,
            "rect" => Shape::Rect,
            _ => Shape::Circle,
        }
    }

    /// The width of the webcam picture as a fraction of the video width.
    pub fn webcam_width(&self) -> f32 {
        match self.webcam.size.as_str() {
            "s" => 0.14,
            "l" => 0.28,
            _ => 0.20,
        }
    }

    /// The webcam rectangle (x, y, w, h) on a picture of `w` x `h` pixels.
    pub fn webcam_rect(&self, w: u32, h: u32) -> (i32, i32, i32, i32) {
        let rw = (w as f32 * self.webcam_width()).round().max(2.0);
        let rh = if self.webcam.shape == "rect" {
            (rw * 9.0 / 16.0).round()
        } else {
            rw
        };
        let margin = (w as f32 * 0.02).round();
        let (cx, cy) = if self.webcam.position == "free" {
            (self.webcam.x * w as f32, self.webcam.y * h as f32)
        } else {
            let x = if self.webcam.position.ends_with("left") {
                margin + rw / 2.0
            } else {
                w as f32 - margin - rw / 2.0
            };
            let y = if self.webcam.position.starts_with("top") {
                margin + rh / 2.0
            } else {
                h as f32 - margin - rh / 2.0
            };
            (x, y)
        };
        // Inside the picture, wherever it was dragged to.
        let x = (cx - rw / 2.0).clamp(0.0, (w as f32 - rw).max(0.0));
        let y = (cy - rh / 2.0).clamp(0.0, (h as f32 - rh).max(0.0));
        (x.round() as i32, y.round() as i32, rw as i32, rh as i32)
    }
}

/// What an export is asked to make.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportSettings {
    /// "mp4" | "gif"
    pub format: String,
    /// MP4: "high" | "standard" | "small". GIF: "low" | "high".
    pub quality: String,
    /// "original" | "1080" | "720" | "480" (the shorter side; nothing is made larger)
    pub resolution: String,
    pub aspect: Aspect,
    pub fit: Fit,
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            format: "mp4".into(),
            quality: "standard".into(),
            resolution: "original".into(),
            aspect: Aspect::Original,
            fit: Fit::Bars,
        }
    }
}

impl ExportSettings {
    /// What Copy, drag out and Share make: the original size, MP4, at the quality the recording was made with.
    pub fn standard(recording_quality: &str) -> Self {
        Self {
            quality: if recording_quality == "high" {
                "high"
            } else {
                "standard"
            }
            .into(),
            ..Self::default()
        }
    }

    pub fn is_gif(&self) -> bool {
        self.format == "gif"
    }

    /// The limit of the shorter side for the resolution (None = the original), tightened for a GIF of low quality.
    pub fn short_side(&self) -> Option<u32> {
        let chosen = match self.resolution.as_str() {
            "1080" => Some(1080),
            "720" => Some(720),
            "480" => Some(480),
            _ => None,
        };
        if self.is_gif() {
            // A GIF is large: low quality is small, high quality clear but not larger than 720.
            let cap = if self.quality == "low" { 360 } else { 720 };
            return Some(chosen.map_or(cap, |c: u32| c.min(cap)));
        }
        chosen
    }

    /// Frames per second of a GIF (10 for low, 15 for high).
    pub fn gif_fps(&self) -> u32 {
        if self.quality == "low" {
            10
        } else {
            15
        }
    }

    /// The video bitrate for the MP4 given the recording's size and frame rate.
    pub fn bitrate(&self, w: u32, h: u32, fps: u32) -> u32 {
        match self.quality.as_str() {
            "high" => crate::recording::bitrate_for(w, h, fps, "high"),
            "small" => crate::recording::bitrate_for(w, h, fps, "standard") / 2,
            _ => crate::recording::bitrate_for(w, h, fps, "standard"),
        }
        .max(300_000)
    }

    pub fn extension(&self) -> &'static str {
        if self.is_gif() {
            "gif"
        } else {
            "mp4"
        }
    }

    /// Text that changes whenever anything that changes the exported file changes (for the cache).
    pub fn key(&self) -> String {
        format!(
            "{}|{}|{}|{:?}|{:?}",
            self.format, self.quality, self.resolution, self.aspect, self.fit
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_recordings_start_from_the_settings_and_bad_values_become_defaults() {
        let s = Settings {
            cursor_size: "2".into(),
            click_effect: "burst".into(),
            webcam_shape: "rect".into(),
            ..Settings::default()
        };
        let fx = Effects::from_settings(&s);
        assert_eq!(fx.cursor.size, "2");
        assert_eq!(fx.click.kind, "burst");
        assert_eq!(fx.webcam.shape, "rect");
        let mut bad = Effects::default();
        bad.cursor.size = "9".into();
        bad.click.left = "red".into();
        bad.webcam.x = 5.0;
        bad.trim = Trim {
            start_ms: 5000,
            end_ms: Some(1000),
        };
        let ok = bad.cleaned();
        assert_eq!(ok.cursor.size, "1");
        assert_eq!(ok.click.left, "#3B82F6");
        assert_eq!(ok.webcam.x, 1.0);
        assert_eq!(ok.trim.end_ms, None, "an end before the start is no end");
        // Stored and read back, with fields that are missing taking their defaults.
        let json = serde_json::to_string(&ok).unwrap();
        assert!(json.contains("haloColor") && json.contains("startMs"));
        let partial: Effects = serde_json::from_str(r#"{"cursor":{"halo":true}}"#).unwrap();
        assert!(partial.cursor.halo && partial.cursor.show && partial.click.kind == "ripple");
    }

    #[test]
    fn the_webcam_sits_in_a_corner_or_where_it_was_dragged_and_stays_inside_the_picture() {
        let mut fx = Effects::default();
        let (x, y, w, h) = fx.webcam_rect(1000, 500);
        assert_eq!((w, h), (200, 200));
        assert!(
            x > 600 && y > 250 && x + w <= 1000 && y + h <= 500,
            "{x} {y}"
        );
        fx.webcam.position = "top-left".into();
        let (x, y, _, _) = fx.webcam_rect(1000, 500);
        assert!(x < 40 && y < 40);
        fx.webcam.shape = "rect".into();
        let (_, _, w, h) = fx.webcam_rect(1000, 500);
        assert_eq!((w, h), (200, 113));
        fx.webcam.position = "free".into();
        fx.webcam.x = 1.0;
        fx.webcam.y = 1.0;
        let (x, y, w, h) = fx.webcam_rect(1000, 500);
        assert_eq!(
            (x + w, y + h),
            (1000, 500),
            "dragged to the corner: still inside"
        );
    }

    #[test]
    fn export_settings_give_the_size_limits_the_gif_rates_and_the_bitrates() {
        let mut e = ExportSettings::default();
        assert_eq!(e.short_side(), None);
        e.resolution = "720".into();
        assert_eq!(e.short_side(), Some(720));
        let small = ExportSettings {
            quality: "small".into(),
            ..ExportSettings::default()
        };
        let high = ExportSettings {
            quality: "high".into(),
            ..ExportSettings::default()
        };
        assert!(small.bitrate(1920, 1080, 30) < e.bitrate(1920, 1080, 30));
        assert!(e.bitrate(1920, 1080, 30) < high.bitrate(1920, 1080, 30));
        let gif_low = ExportSettings {
            format: "gif".into(),
            quality: "low".into(),
            ..ExportSettings::default()
        };
        let gif_high = ExportSettings {
            format: "gif".into(),
            quality: "high".into(),
            ..ExportSettings::default()
        };
        assert_eq!((gif_low.gif_fps(), gif_high.gif_fps()), (10, 15));
        assert!(gif_low.short_side().unwrap() < gif_high.short_side().unwrap());
        assert_eq!(gif_low.extension(), "gif");
        assert_eq!(ExportSettings::standard("high").quality, "high");
        assert_ne!(small.key(), high.key());
    }
}

/// Change how a recording looks (the effects panel of the page): written into the recording's `recording.json` before this
/// returns. Returns the effects as they were stored (invalid values replaced by the defaults).
#[tauri::command]
pub fn set_effects(
    state: tauri::State<'_, crate::commands::AppState>,
    capture_id: String,
    effects: Effects,
) -> crate::error::CmdResult<Effects> {
    let dir = state
        .sessions
        .lock()
        .unwrap()
        .recording_dir(&capture_id)
        .ok_or_else(|| crate::error::CmdError::new("not_found", "this recording does not exist"))?;
    store_effects(&dir, effects).map_err(|e| crate::error::CmdError::new("io", e.to_string()))
}

/// Write `effects` (cleaned) into the `recording.json` of `dir`, keeping everything else in the file.
pub fn store_effects(dir: &std::path::Path, effects: Effects) -> std::io::Result<Effects> {
    let path = dir.join("recording.json");
    let mut doc: serde_json::Value = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let clean = effects.cleaned();
    doc["effects"] = serde_json::to_value(&clean).map_err(std::io::Error::other)?;
    let tmp = dir.join("recording.json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(&doc).map_err(std::io::Error::other)?,
    )?;
    std::fs::rename(&tmp, &path)?;
    Ok(clean)
}

#[cfg(test)]
mod store_tests {
    use super::*;

    #[test]
    fn effects_are_stored_in_the_recording_file_next_to_everything_else() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("recording.json"),
            r#"{"width":640,"fps":30}"#,
        )
        .unwrap();
        let mut fx = Effects::default();
        fx.cursor.halo = true;
        fx.trim = Trim {
            start_ms: 500,
            end_ms: Some(2500),
        };
        fx.click.left = "bad".into();
        let stored = store_effects(dir.path(), fx).unwrap();
        assert_eq!(stored.click.left, "#3B82F6");
        let back: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("recording.json")).unwrap())
                .unwrap();
        assert_eq!(back["width"], 640);
        assert_eq!(back["effects"]["cursor"]["halo"], true);
        assert_eq!(back["effects"]["trim"]["endMs"], 2500);
        assert!(!dir.path().join("recording.json.tmp").exists());
    }
}
