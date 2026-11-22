//! The guides of Documents mode: where they are stored and how (see `docs/documents-storage.md`).
//!
//! One folder per guide in `<app data>\documents\guides\<id>\`: `guide.json` (title, created, state, the settings used, version),
//! `steps.jsonl` (one line per step, appended and flushed as each step is taken, so a crash loses at most the step that was being
//! written; later lines can delete or restore a step) and the step pictures `step-0001.png` ... (the whole monitor as it was at the
//! click, PNG: lossless, so text stays crisp for annotations and redaction; about 0.2–1.5 MB each). Click points, rectangles and zoom
//! areas are in the pixels of that picture, so they can be cropped and annotated later without touching it.

use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{CmdError, CmdResult};
use crate::steptext::{Kind, Part};

pub const VERSION: u32 = 1;

/// Where the guides are. `SNIPMUNK_GUIDES_DIR` moves them (the tests of this program do).
pub fn root() -> PathBuf {
    if let Some(d) = std::env::var_os("SNIPMUNK_GUIDES_DIR") {
        return PathBuf::from(d);
    }
    dawn_core::app_dir("snipmunk")
        .join("documents")
        .join("guides")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GuideInfo {
    pub version: u32,
    pub id: String,
    pub title: String,
    /// Unix time, milliseconds.
    pub created: u64,
    /// "recording" until the guide is stopped; then "done".
    pub state: String,
    /// The settings the guide was recorded with (informational).
    pub settings: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowInfo {
    /// In the pixels of the step picture.
    pub rect: [i32; 4],
    pub title: String,
    pub process: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ElementInfo {
    pub name: String,
    pub control_type: String,
    pub localized_control_type: String,
    pub automation_id: String,
    /// A toggle (check box): its state at the click.
    pub toggle: Option<bool>,
    pub selected: Option<bool>,
    /// In the pixels of the step picture.
    pub rect: [i32; 4],
    /// The names of the nearest named parents (menu, dialog, tab), outermost first.
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Step {
    pub n: u32,
    /// "" for a step; "delete" / "restore" for the lines that change one.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub op: String,
    pub kind: Option<Kind>,
    /// Unix time, milliseconds.
    pub t: u64,
    /// The monitor the picture shows: x, y, width, height on the desktop (physical pixels), and its scale.
    pub monitor: [i32; 4],
    pub scale: f64,
    pub image: String,
    pub image_size: [u32; 2],
    /// Where the click was, in picture pixels (none for a typing or shortcut step).
    pub click: Option<[i32; 2]>,
    pub window: Option<WindowInfo>,
    pub element: Option<ElementInfo>,
    pub typed: Option<String>,
    pub keys: Option<String>,
    /// A default zoom area around the click, in picture pixels (shown only when the setting is on).
    pub zoom: Option<[i32; 4]>,
    /// The step text in the language of the program at the time, as parts (see `steptext`).
    pub text: Vec<Part>,
    /// How old the picture was when the mouse went down, in milliseconds (0 = taken after the fact).
    pub frame_age_ms: u64,
    /// Set when a later line deleted the step.
    pub deleted: bool,
}

/// A line of the list of guides.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideSummary {
    pub id: String,
    pub title: String,
    pub created: u64,
    pub state: String,
    pub steps: u32,
    /// The picture of the first step (file name inside the guide), if any.
    pub first_image: Option<String>,
    pub first_size: Option<[u32; 2]>,
}

fn io(e: impl std::fmt::Display) -> CmdError {
    CmdError::new("io", e.to_string())
}

pub fn dir_of(id: &str) -> PathBuf {
    root().join(sanitize(id))
}

/// Ids and file names are plain: letters, digits, "-", "_" and ".".
fn sanitize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A new guide folder with its `guide.json` (state "recording").
pub fn create(title: &str, settings: serde_json::Value) -> CmdResult<GuideInfo> {
    let created = now_ms();
    let mut id = format!("g{created:x}");
    while dir_of(&id).exists() {
        id.push('x');
    }
    let info = GuideInfo {
        version: VERSION,
        id: id.clone(),
        title: title.to_string(),
        created,
        state: "recording".into(),
        settings,
    };
    std::fs::create_dir_all(dir_of(&id)).map_err(io)?;
    write_info(&info)?;
    Ok(info)
}

fn write_info(info: &GuideInfo) -> CmdResult<()> {
    let dir = dir_of(&info.id);
    let tmp = dir.join("guide.json.tmp");
    let bytes = serde_json::to_vec_pretty(info).map_err(io)?;
    {
        let mut f = std::fs::File::create(&tmp).map_err(io)?;
        f.write_all(&bytes).map_err(io)?;
        f.sync_all().map_err(io)?;
    }
    std::fs::rename(&tmp, dir.join("guide.json")).map_err(io)
}

pub fn read_info(id: &str) -> Option<GuideInfo> {
    let b = std::fs::read(dir_of(id).join("guide.json")).ok()?;
    serde_json::from_slice(&b).ok()
}

/// Append one line to `steps.jsonl` and flush it to disk.
pub fn append_line(id: &str, step: &Step) -> CmdResult<()> {
    let mut line = serde_json::to_string(step).map_err(io)?;
    line.push('\n');
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir_of(id).join("steps.jsonl"))
        .map_err(io)?;
    f.write_all(line.as_bytes()).map_err(io)?;
    f.sync_data().map_err(io)
}

/// Write a step picture (PNG bytes) under `name`; returns the name.
pub fn write_image(id: &str, name: &str, png: &[u8]) -> CmdResult<()> {
    let path = dir_of(id).join(sanitize(name));
    let tmp = path.with_extension("png.tmp");
    {
        let mut f = std::fs::File::create(&tmp).map_err(io)?;
        f.write_all(png).map_err(io)?;
        f.sync_data().map_err(io)?;
    }
    std::fs::rename(&tmp, &path).map_err(io)
}

/// The steps of a guide in order, with the deletions applied (`deleted` is set). A line that a crash cut off is ignored.
pub fn read_steps(id: &str) -> Vec<Step> {
    let Ok(text) = std::fs::read_to_string(dir_of(id).join("steps.jsonl")) else {
        return Vec::new();
    };
    let mut steps: Vec<Step> = Vec::new();
    for line in text.lines() {
        let Ok(s) = serde_json::from_str::<Step>(line) else {
            continue;
        };
        match s.op.as_str() {
            "delete" | "restore" => {
                if let Some(x) = steps.iter_mut().find(|x| x.n == s.n) {
                    x.deleted = s.op == "delete";
                }
            }
            _ => {
                if !steps.iter().any(|x| x.n == s.n) {
                    steps.push(s);
                }
            }
        }
    }
    steps.sort_by_key(|s| s.n);
    steps
}

pub fn finalize(id: &str) -> CmdResult<()> {
    if let Some(mut info) = read_info(id) {
        info.state = "done".into();
        write_info(&info)?;
    }
    Ok(())
}

pub fn list() -> Vec<GuideSummary> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(root()) else {
        return out;
    };
    for e in rd.flatten() {
        let Some(id) = e.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(info) = read_info(&id) else { continue };
        let steps = read_steps(&id);
        let live: Vec<&Step> = steps.iter().filter(|s| !s.deleted).collect();
        out.push(GuideSummary {
            id: info.id,
            title: info.title,
            created: info.created,
            state: info.state,
            steps: live.len() as u32,
            first_image: live.first().map(|s| s.image.clone()),
            first_size: live.first().map(|s| s.image_size),
        });
    }
    out.sort_by_key(|g| std::cmp::Reverse(g.created));
    out
}

/// The path of a picture of a guide (for the address the pages load it from).
pub fn image_path(id: &str, name: &str) -> Option<PathBuf> {
    let p = dir_of(id).join(sanitize(name));
    p.is_file().then_some(p)
}

/// Guides that were still recording when the program ended: (id, title, number of steps).
pub fn unfinished() -> Vec<(String, String, u32)> {
    list()
        .into_iter()
        .filter(|g| g.state == "recording")
        .map(|g| (g.id, g.title, g.steps))
        .collect()
}

/// A default zoom area around a click: about 640 x 400, inside the window (when known) and inside the picture.
pub fn default_zoom(click: [i32; 2], window: Option<[i32; 4]>, frame: [u32; 2]) -> [i32; 4] {
    let (fw, fh) = (frame[0] as i32, frame[1] as i32);
    let bounds = match window {
        Some([x, y, w, h]) if w > 0 && h > 0 => {
            let (x0, y0) = (x.max(0), y.max(0));
            [x0, y0, (x + w).min(fw) - x0, (y + h).min(fh) - y0]
        }
        _ => [0, 0, fw, fh],
    };
    let w = 640.min(bounds[2]).max(1);
    let h = 400.min(bounds[3]).max(1);
    let x = (click[0] - w / 2).clamp(bounds[0], (bounds[0] + bounds[2] - w).max(bounds[0]));
    let y = (click[1] - h / 2).clamp(bounds[1], (bounds[1] + bounds[3] - h).max(bounds[1]));
    [x, y, w, h]
}

// --- commands ---------------------------------------------------------------------------------------------------------------------

#[tauri::command]
pub fn guides_list() -> Vec<GuideSummary> {
    list()
}

#[tauri::command]
pub fn guide_get(id: String) -> Option<GuideInfo> {
    read_info(&id)
}

#[tauri::command]
pub fn guide_steps(id: String) -> Vec<Step> {
    read_steps(&id)
}

#[tauri::command]
pub fn guide_rename(id: String, title: String) -> CmdResult<String> {
    let title = title.trim().to_string();
    let mut info =
        read_info(&id).ok_or_else(|| CmdError::new("not_found", "the guide does not exist"))?;
    if !title.is_empty() {
        info.title = title;
        write_info(&info)?;
    }
    Ok(info.title)
}

#[tauri::command]
pub fn guide_delete(id: String) -> CmdResult<()> {
    let dir = dir_of(&id);
    if dir.starts_with(root()) && dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(io)?;
    }
    Ok(())
}

/// Delete (or, with `restore`, bring back) a step: a line is appended, nothing is removed from disk.
#[tauri::command]
pub fn guide_step_delete(id: String, n: u32, restore: Option<bool>) -> CmdResult<()> {
    append_line(
        &id,
        &Step {
            n,
            op: if restore.unwrap_or(false) {
                "restore"
            } else {
                "delete"
            }
            .into(),
            ..Default::default()
        },
    )
}

/// Guides left over from a crash: (id, title, steps).
#[tauri::command]
pub fn guides_unfinished() -> Vec<(String, String, u32)> {
    unfinished()
}

/// Recover a guide that was recording: it is finalized as it is.
#[tauri::command]
pub fn guide_recover(id: String) -> CmdResult<()> {
    finalize(&id)
}

/// The text of every step as a numbered list (for "Copy all as text").
#[tauri::command]
pub fn guide_text(id: String) -> String {
    read_steps(&id)
        .iter()
        .filter(|s| !s.deleted)
        .enumerate()
        .map(|(i, s)| format!("{}. {}", i + 1, crate::steptext::plain(&s.text)))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The picture of a step as bytes (for "Copy picture"): the whole step picture; the page crops it.
#[tauri::command]
pub fn guide_image_path(id: String, name: String) -> Option<String> {
    image_path(&id, &name).map(|p| p.to_string_lossy().into_owned())
}

/// Development only: a finished guide with `count` generated steps (a coloured picture each), to look at a long guide.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn dev_guide_seed(count: u32) -> CmdResult<String> {
    let g = create("Seeded guide", serde_json::Value::Null)?;
    for n in 1..=count.min(500) {
        let (w, h) = (1280u32, 720u32);
        let img = image::RgbaImage::from_fn(w, h, |x, y| {
            let band = ((x / 160 + y / 90 + n) % 2) as u8;
            image::Rgba([
                (n * 37 % 255) as u8,
                60 + band * 60,
                (200 - (n * 11 % 120)) as u8,
                255,
            ])
        });
        let png = crate::thumbs::png_bytes(&img, image::codecs::png::CompressionType::Fast)
            .map_err(io)?;
        let name = format!("step-{n:04}.png");
        write_image(&g.id, &name, &png)?;
        let click = [200 + (n as i32 * 53) % 800, 150 + (n as i32 * 31) % 400];
        append_line(
            &g.id,
            &Step {
                n,
                kind: Some(Kind::Click),
                t: now_ms(),
                monitor: [0, 0, w as i32, h as i32],
                scale: 1.0,
                image: name,
                image_size: [w, h],
                click: Some(click),
                window: Some(WindowInfo {
                    rect: [100, 60, 1000, 600],
                    title: "Test".into(),
                    process: "test".into(),
                }),
                text: vec![
                    Part {
                        t: "Click ".into(),
                        b: false,
                    },
                    Part {
                        t: format!("Button {n}"),
                        b: true,
                    },
                ],
                zoom: Some(default_zoom(click, Some([100, 60, 1000, 600]), [w, h])),
                ..Default::default()
            },
        )?;
    }
    finalize(&g.id)?;
    Ok(g.id)
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn dev_guide_seed() -> CmdResult<()> {
    Err(CmdError::new("unavailable", "development builds only"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tests of this module share the environment variable, so they run one after the other.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_root<R>(f: impl FnOnce() -> R) -> R {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let base = std::env::var("SNIPMUNK_TEST_DIR").unwrap_or_else(|_| ".".into());
        let dir = tempfile::tempdir_in(base).unwrap();
        // SAFETY: the tests that read the variable hold LOCK.
        unsafe { std::env::set_var("SNIPMUNK_GUIDES_DIR", dir.path()) };
        let r = f();
        unsafe { std::env::remove_var("SNIPMUNK_GUIDES_DIR") };
        r
    }

    fn step(n: u32) -> Step {
        Step {
            n,
            kind: Some(Kind::Click),
            t: 1000 + n as u64,
            image: format!("step-{n:04}.png"),
            image_size: [100, 50],
            text: vec![Part {
                t: format!("Step {n}"),
                b: false,
            }],
            ..Default::default()
        }
    }

    #[test]
    fn a_guide_keeps_its_steps_in_order_and_deleting_and_restoring_only_appends_lines() {
        with_root(|| {
            let g = create("Guide A", serde_json::json!({"mode": "auto"})).unwrap();
            for n in 1..=3 {
                append_line(&g.id, &step(n)).unwrap();
            }
            guide_step_delete(g.id.clone(), 2, None).unwrap();
            let s = read_steps(&g.id);
            assert_eq!(
                s.iter().map(|x| (x.n, x.deleted)).collect::<Vec<_>>(),
                [(1, false), (2, true), (3, false)]
            );
            assert_eq!(guide_text(g.id.clone()), "1. Step 1\n2. Step 3");
            guide_step_delete(g.id.clone(), 2, Some(true)).unwrap();
            assert!(read_steps(&g.id).iter().all(|x| !x.deleted));
            // The list: the title, the steps and the first picture.
            let l = list();
            assert_eq!(
                (l[0].title.as_str(), l[0].steps, l[0].state.as_str()),
                ("Guide A", 3, "recording")
            );
            assert_eq!(l[0].first_image.as_deref(), Some("step-0001.png"));
            assert_eq!(
                guide_rename(g.id.clone(), "  New title ".into()).unwrap(),
                "New title"
            );
            guide_delete(g.id.clone()).unwrap();
            assert!(list().is_empty());
        });
    }

    #[test]
    fn a_crash_loses_at_most_the_line_being_written_and_the_guide_can_be_recovered() {
        with_root(|| {
            let g = create("Crashed", serde_json::Value::Null).unwrap();
            append_line(&g.id, &step(1)).unwrap();
            append_line(&g.id, &step(2)).unwrap();
            // A line cut off in the middle (the program died while writing it).
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(dir_of(&g.id).join("steps.jsonl"))
                .unwrap();
            f.write_all(b"{\"n\":3,\"kind\":\"cli").unwrap();
            drop(f);
            assert_eq!(read_steps(&g.id).len(), 2);
            assert_eq!(unfinished(), vec![(g.id.clone(), "Crashed".to_string(), 2)]);
            guide_recover(g.id.clone()).unwrap();
            assert!(unfinished().is_empty());
            assert_eq!(read_info(&g.id).unwrap().state, "done");
        });
    }

    #[test]
    fn the_default_zoom_is_around_the_click_and_stays_inside_the_window_and_the_picture() {
        // In the middle of a big window.
        assert_eq!(
            default_zoom([1000, 600], Some([0, 0, 1920, 1080]), [1920, 1080]),
            [680, 400, 640, 400]
        );
        // Near the corner of the window: pushed inside.
        assert_eq!(
            default_zoom([10, 10], Some([100, 100, 800, 600]), [1920, 1080]),
            [100, 100, 640, 400]
        );
        // A small window: the zoom is the window.
        let z = default_zoom([150, 150], Some([100, 100, 300, 200]), [1920, 1080]);
        assert_eq!(z, [100, 100, 300, 200]);
        // No window: the picture.
        assert_eq!(
            default_zoom([1900, 1070], None, [1920, 1080]),
            [1280, 680, 640, 400]
        );
    }

    #[test]
    fn ids_and_file_names_cannot_leave_the_guide_folder() {
        assert_eq!(sanitize("../../x"), "x");
        assert_eq!(sanitize("a/b\\c"), "abc");
    }
}
