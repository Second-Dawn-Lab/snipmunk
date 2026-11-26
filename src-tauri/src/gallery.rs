//! Commands of the session gallery: moving and copying several captures, group tabs, and dropped-in images.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::commands::{change_session, AppState};
use crate::error::{CmdError, CmdResult};
use crate::import;
use crate::sessions::{NewCapture, Session};

/// Move captures (in the order given) to a group, at `index` of that group's list without them (the end when none).
/// Also the way to reorder a group's list: move the captures into the group they are already in.
#[tauri::command]
pub fn move_captures(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_ids: Vec<String>,
    group_id: String,
    index: Option<usize>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.move_captures(&capture_ids, &group_id, index)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicated {
    pub session: Session,
    /// The new captures, in the order of the originals.
    pub ids: Vec<String>,
}

/// Copy captures; each copy sits right after its original and is named `<name><suffix>`.
#[tauri::command]
pub fn duplicate_captures(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_ids: Vec<String>,
    suffix: String,
) -> CmdResult<Duplicated> {
    let mut ids = Vec::new();
    let session = change_session(&app, &state, |s| {
        ids = s.duplicate_captures(&capture_ids, &suffix)?;
        Ok(())
    })?;
    Ok(Duplicated { session, ids })
}

#[tauri::command]
pub fn reorder_groups(
    app: AppHandle,
    state: State<'_, AppState>,
    group_ids: Vec<String>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| s.reorder_groups(&group_ids))
}

#[tauri::command]
pub fn set_group_color(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: String,
    color: Option<String>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.set_group_color(&group_id, color.as_deref())
    })
}

#[tauri::command]
pub fn set_group_emoji(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: String,
    emoji: Option<String>,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.set_group_emoji(&group_id, emoji.as_deref())
    })
}

/// Add one dropped image to a group. The page sends the file's bytes as the raw request body and the group and
/// the file name (percent-encoded) in the `x-group-id` and `x-file-name` headers. A file that is not a supported
/// image is an `unsupported` error, so the page can count it and go on with the next one.
#[tauri::command]
pub async fn import_image(
    app: AppHandle,
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<Session> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new("bad_request", "the image bytes are missing"));
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(crate::commands::percent_decode)
    };
    let group_id = header("x-group-id").ok_or_else(|| CmdError::new("bad_request", "no group"))?;
    let file_name = header("x-file-name").unwrap_or_default();

    // Decoding takes a while for a large photo: not while the session is locked.
    let prepared = import::prepare(bytes).map_err(|m| CmdError::new("unsupported", m))?;
    let name = import::name_from_file(&file_name, "Image");
    change_session(&app, &state, |s| {
        s.add_capture_with(
            &group_id,
            NewCapture {
                name: Some(name),
                png: &prepared.png,
                thumb: Some(&prepared.thumb),
                thumb_size: crate::thumbs::THUMB_MAX.0,
                width: prepared.width,
                height: prepared.height,
                source_window_title: None,
                source: "imported",
            },
        )
        .map(|_| ())
    })?;
    // An image that was dropped in is read like a screenshot.
    if let Some(c) = session_after_import(&app, &state) {
        crate::ocr::queue(&app, &c);
    }
    Ok(session_clone(&state))
}

/// The id of the newest capture of the session (the one just imported).
fn session_after_import(_app: &AppHandle, state: &State<'_, AppState>) -> Option<String> {
    let store = state.sessions.lock().unwrap();
    store
        .session()
        .groups
        .iter()
        .flat_map(|g| g.captures.iter())
        .max_by_key(|c| c.created_at)
        .map(|c| c.id.clone())
}

fn session_clone(state: &State<'_, AppState>) -> Session {
    state.sessions.lock().unwrap().session().clone()
}

/// Replace the annotations of a capture (the editable marks, crop and rotation). Written to disk before it returns.
#[tauri::command]
pub fn set_annotations(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_id: String,
    annotations: serde_json::Value,
) -> CmdResult<Session> {
    change_session(&app, &state, |s| {
        s.set_annotations(&capture_id, annotations.clone())
    })
}

/// Replace a capture's thumbnail with a PNG the page rendered (the image with its annotations): the PNG is the raw
/// request body, the capture is in the `x-capture-id` header.
#[tauri::command]
pub async fn set_capture_thumbnail(
    app: AppHandle,
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<Session> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new("bad_request", "the picture is missing"));
    };
    let id = request
        .headers()
        .get("x-capture-id")
        .and_then(|v| v.to_str().ok())
        .map(crate::commands::percent_decode)
        .ok_or_else(|| CmdError::new("bad_request", "no capture"))?;
    // Only a small PNG is a thumbnail: decode it before it is stored.
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map_err(|e| CmdError::new("unsupported", e))?;
    if image.width() == 0 || image.height() == 0 || image.width() > 1024 || image.height() > 1024 {
        return Err(CmdError::new(
            "bad_request",
            "the thumbnail has an unexpected size",
        ));
    }
    change_session(&app, &state, |s| {
        s.set_thumbnail(&id, bytes, crate::thumbs::THUMB_MAX.0)
    })
}

/// Replace the stored picture of a capture (the PNG is the raw body, the capture is in `x-capture-id`). This burns
/// redactions into the file (and undoes that): the old picture is overwritten, and the thumbnail and the recognized text
/// of the old picture go with it. The new picture must have the size of the old one.
#[tauri::command]
pub async fn replace_capture_image(
    app: AppHandle,
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<Session> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::new("bad_request", "the picture is missing"));
    };
    let id = request
        .headers()
        .get("x-capture-id")
        .and_then(|v| v.to_str().ok())
        .map(crate::commands::percent_decode)
        .ok_or_else(|| CmdError::new("bad_request", "no capture"))?;
    let (width, height) = {
        let store = state.sessions.lock().unwrap();
        let c = store
            .session()
            .groups
            .iter()
            .flat_map(|g| g.captures.iter())
            .find(|c| c.id == id)
            .ok_or_else(|| CmdError::new("not_found", "this capture is gone"))?;
        (c.width, c.height)
    };
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map_err(|e| CmdError::new("unsupported", e))?;
    if (image.width(), image.height()) != (width, height) {
        return Err(CmdError::new(
            "bad_request",
            "the new picture has another size than the capture",
        ));
    }
    let thumb =
        crate::thumbs::thumbnail_png(&image.to_rgba8()).map_err(|m| CmdError::new("io", m))?;
    change_session(&app, &state, |s| s.replace_image(&id, bytes, Some(&thumb)))
}

/// Development only: start a new session with `count` generated captures in `groups` groups, to try the gallery with
/// hundreds of them. The generated session is an ordinary one (retention removes it); release builds refuse.
#[cfg(any(debug_assertions, feature = "measure-guard"))]
#[tauri::command]
pub fn debug_seed_session(
    app: AppHandle,
    state: State<'_, AppState>,
    count: u32,
    groups: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
) -> CmdResult<Session> {
    use image::codecs::png::CompressionType;
    use image::{Rgba, RgbaImage};

    let (w, h) = (
        width.unwrap_or(1280).clamp(16, 3840),
        height.unwrap_or(720).clamp(16, 2160),
    );
    let groups = groups.unwrap_or(1).clamp(1, 20);
    let count = count.min(5000);
    change_session(&app, &state, |s| {
        s.new_session(false, None)?;
        let mut ids = vec![s.session().groups[0].id.clone()];
        for _ in 1..groups {
            ids.push(s.create_group(None)?);
        }
        for i in 0..count {
            // A different colour and layout per capture, so neighbours are easy to tell apart.
            let hue = (i * 47 % 360) as f32;
            let img = RgbaImage::from_fn(w, h, |x, y| {
                let fx = x as f32 / w as f32;
                let fy = y as f32 / h as f32;
                let block = ((fx * 8.0) as u32 + (fy * 5.0) as u32 + i).is_multiple_of(2);
                let l = if block { 0.82 } else { 0.55 } - fy * 0.15;
                let [r, g, b] = hsl(hue + fx * 40.0, 0.55, l);
                Rgba([r, g, b, 255])
            });
            let png = crate::thumbs::png_bytes(&img, CompressionType::Fast)
                .map_err(crate::sessions::StoreError::Invalid)?;
            let thumb =
                crate::thumbs::thumbnail_png(&img).map_err(crate::sessions::StoreError::Invalid)?;
            s.add_capture_with(
                &ids[(i % groups) as usize],
                NewCapture {
                    name: Some(format!("Seed {:03}", i + 1)),
                    png: &png,
                    thumb: Some(&thumb),
                    thumb_size: crate::thumbs::THUMB_MAX.0,
                    width: w,
                    height: h,
                    source_window_title: None,
                    source: "screenshot",
                },
            )?;
        }
        Ok(())
    })
}

#[cfg(any(debug_assertions, feature = "measure-guard"))]
fn hsl(h: f32, s: f32, l: f32) -> [u8; 3] {
    let h = h.rem_euclid(360.0) / 60.0;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - (h % 2.0 - 1.0).abs());
    let (r, g, b) = match h as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = l - c / 2.0;
    [r, g, b].map(|v| ((v + m) * 255.0).round().clamp(0.0, 255.0) as u8)
}
