//! Own guide templates (level 3): one `.snpt` file each in the templates folder, the stored-ZIP package of `.snpd` with the kind
//! `snipmunk.template`: `template.json` and the images it uses (logo, cover background). The same file is what a team shares.
//! See `docs/templates.md`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::error::{CmdError, CmdResult};
use crate::package::{self, Data, Source};

pub const KIND_TEMPLATE: &str = "snipmunk.template";
const VERSION: u32 = 1;
/// A template and its images are small; a file larger than this is not one.
const MAX_BYTES: u64 = 40 * 1024 * 1024;

fn io(e: impl std::fmt::Display) -> CmdError {
    CmdError::new("io", e.to_string())
}

/// `SNIPMUNK_TEMPLATES_DIR` in development builds, else `templates` in the app data folder.
fn dir() -> PathBuf {
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var_os("SNIPMUNK_TEMPLATES_DIR") {
            return PathBuf::from(d);
        }
    }
    crate::store::app_dir().join("templates")
}

/// An id is a file name: letters, digits and `-` only.
fn file_of(dir: &Path, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(CmdError::new("bad_request", "not a template id"));
    }
    Ok(dir.join(format!("{id}.snpt")))
}

/// The names of the images a template uses: only inserted images of a guide ("m-*.png").
fn image_names(template: &Value) -> Vec<String> {
    [&template["logo"], &template["cover"]["image"]]
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|n| is_image_name(n))
        .map(str::to_string)
        .collect()
}

fn is_image_name(n: &str) -> bool {
    n.starts_with("m-")
        && n.ends_with(".png")
        && n.len() <= 40
        && n[2..n.len() - 4]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Write the template and its images (taken from the folder `images`) to a `.snpt` file.
pub fn write(path: &Path, template: &Value, images: &Path) -> CmdResult<()> {
    if !template.is_object() {
        return Err(CmdError::new("bad_request", "not a template"));
    }
    let mut sources = vec![Source {
        name: "template.json".into(),
        data: Data::Bytes(serde_json::to_vec_pretty(template).map_err(io)?),
    }];
    let mut seen = std::collections::HashSet::new();
    for name in image_names(template) {
        let file = images.join(&name);
        if file.is_file() && seen.insert(name.clone()) {
            sources.push(Source {
                name,
                data: Data::Bytes(std::fs::read(file).map_err(io)?),
            });
        }
    }
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(io)?;
    }
    let tmp = path.with_extension("part");
    let _ = std::fs::remove_file(&tmp);
    package::create(&tmp, KIND_TEMPLATE, VERSION, &sources).map_err(io)?;
    std::fs::rename(&tmp, path).map_err(io)
}

/// Read a `.snpt` file; when `images` is given its images are copied there.
pub fn read(path: &Path, images: Option<&Path>) -> CmdResult<Value> {
    let size = std::fs::metadata(path).map_err(io)?.len();
    if size > MAX_BYTES {
        return Err(CmdError::new("bad_request", "this file is not a template"));
    }
    let pkg = package::open(path, KIND_TEMPLATE)
        .map_err(|e| CmdError::new("bad_request", e.to_string()))?;
    let template: Value =
        serde_json::from_slice(&pkg.read("template.json").map_err(io)?).map_err(io)?;
    if !template.is_object() {
        return Err(CmdError::new("bad_request", "this file is not a template"));
    }
    if let Some(to) = images {
        std::fs::create_dir_all(to).map_err(io)?;
        for name in image_names(&template) {
            if let Ok(bytes) = pkg.read(&name) {
                std::fs::write(to.join(&name), bytes).map_err(io)?;
            }
        }
    }
    Ok(template)
}

fn list_in(dir: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "snpt"))
                .filter_map(|p| {
                    let id = p.file_stem()?.to_str()?.to_string();
                    let mut t = read(&p, None).ok()?;
                    t["id"] = json!(id);
                    Some(t)
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|t| t["name"].as_str().unwrap_or("").to_lowercase());
    out
}

/// A short-lived folder in Snipmunk's temp folder for the images of a template; removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch() -> CmdResult<Scratch> {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let d = crate::projects::temp_base().join(format!("tpl-{:x}-{n}", crate::guides::now_ms()));
    std::fs::create_dir_all(&d).map_err(io)?;
    Ok(Scratch(d))
}

fn new_id() -> String {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    // (several files imported at once get an id each)
    format!("own-{:x}-{n:x}", crate::guides::now_ms())
}

#[tauri::command]
pub async fn templates_list() -> CmdResult<Vec<Value>> {
    tauri::async_runtime::spawn_blocking(|| list_in(&dir()))
        .await
        .map_err(io)
}

/// Save a template as one of the person's own (a new id when `id` is not one of theirs); its images come from the open guide.
#[tauri::command]
pub async fn templates_save(template: Value) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut t = template;
        let id = t["id"]
            .as_str()
            .filter(|i| i.starts_with("own-"))
            .map(str::to_string)
            .unwrap_or_else(new_id);
        t["id"] = json!(id);
        let file = file_of(&dir(), &id)?;
        // Images the open guide no longer has stay as the saved file has them.
        let images = crate::snpd::work_dir();
        if file.is_file() {
            for name in image_names(&t) {
                if !images.join(&name).is_file() {
                    read(&file, Some(&images))?;
                    break;
                }
            }
        }
        write(&file, &t, &images)?;
        Ok(t)
    })
    .await
    .map_err(io)?
}

/// Use an own template in the open guide: its images are copied into the guide's working folder.
#[tauri::command]
pub async fn templates_use(id: String) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = file_of(&dir(), &id)?;
        let work = crate::snpd::work_dir();
        let images = crate::snpd::is_open().then_some(work.as_path());
        let mut t = read(&file, images)?;
        t["id"] = json!(id);
        Ok(t)
    })
    .await
    .map_err(io)?
}

/// Rename an own template, or (with `copy`) make a duplicate of it under the new name.
#[tauri::command]
pub async fn templates_rename(id: String, name: String, copy: bool) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let from = file_of(&dir(), &id)?;
        let name = name.trim().chars().take(80).collect::<String>();
        if name.is_empty() {
            return Err(CmdError::new("bad_request", "a template needs a name"));
        }
        let tmp = scratch()?;
        let mut t = read(&from, Some(tmp.path()))?;
        let id = if copy { new_id() } else { id };
        t["id"] = json!(id);
        t["name"] = json!(name);
        write(&file_of(&dir(), &id)?, &t, tmp.path())?;
        Ok(t)
    })
    .await
    .map_err(io)?
}

#[tauri::command]
pub async fn templates_delete(id: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::remove_file(file_of(&dir(), &id)?).map_err(io)
    })
    .await
    .map_err(io)?
}

/// Share: copy an own template to a file the person chose.
#[tauri::command]
pub async fn templates_export(id: String, path: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if !path.to_lowercase().ends_with(".snpt") {
            return Err(CmdError::new(
                "bad_request",
                "a template file ends in .snpt",
            ));
        }
        std::fs::copy(file_of(&dir(), &id)?, path).map_err(io)?;
        Ok(())
    })
    .await
    .map_err(io)?
}

/// A file name for a template: its name without the characters Windows does not allow.
fn file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_end_matches(['.', ' ']);
    let reserved = ["con", "prn", "aux", "nul"]
        .iter()
        .any(|r| cleaned.eq_ignore_ascii_case(r));
    if cleaned.is_empty() || reserved {
        "template".to_string()
    } else {
        cleaned.chars().take(80).collect()
    }
}

/// Write several own templates into a folder, one `.snpt` file each, named after the template. A file that is there already
/// is not overwritten: the new one gets a number.
fn export_into(own: &Path, ids: &[String], folder: &Path) -> CmdResult<u32> {
    if !folder.is_absolute() || !folder.is_dir() {
        return Err(CmdError::new("bad_request", "choose a folder"));
    }
    let mut written = 0;
    for id in ids {
        let from = file_of(own, id)?;
        let template = read(&from, None)?;
        let name = file_name(template["name"].as_str().unwrap_or(""));
        let target = (1..)
            .map(|n| {
                if n == 1 {
                    folder.join(format!("{name}.snpt"))
                } else {
                    folder.join(format!("{name} ({n}).snpt"))
                }
            })
            .find(|p| !p.exists())
            .ok_or_else(|| CmdError::new("io", "no free file name"))?;
        std::fs::copy(&from, target).map_err(io)?;
        written += 1;
    }
    Ok(written)
}

/// Share several own templates: the number of files written into the chosen folder.
#[tauri::command]
pub async fn templates_export_many(ids: Vec<String>, folder: String) -> CmdResult<u32> {
    tauri::async_runtime::spawn_blocking(move || export_into(&dir(), &ids, Path::new(&folder)))
        .await
        .map_err(io)?
}

/// Add a template file to the own templates (checked, under a new id). Every window with a list of templates is told.
#[tauri::command]
pub async fn templates_import(app: tauri::AppHandle, path: String) -> CmdResult<Value> {
    use tauri::Emitter;
    let added = tauri::async_runtime::spawn_blocking(move || {
        let tmp = scratch()?;
        let mut t = read(Path::new(&path), Some(tmp.path()))?;
        let id = new_id();
        t["id"] = json!(id);
        write(&file_of(&dir(), &id)?, &t, tmp.path())?;
        Ok::<Value, CmdError>(t)
    })
    .await
    .map_err(io)??;
    let _ = app.emit("templates-changed", ());
    Ok(added)
}

/// The name in a template file, for the question before it is imported. Fails for a file that is not a template.
#[tauri::command]
pub async fn templates_peek(path: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || name_in(Path::new(&path)))
        .await
        .map_err(io)?
}

fn name_in(path: &Path) -> CmdResult<String> {
    let template = read(path, None)?;
    let name = template["name"].as_str().unwrap_or_default().trim();
    if name.is_empty() {
        // (a template without a name is shown by its file's)
        return Ok(path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default());
    }
    Ok(name.chars().take(120).collect())
}

/// "Import template…": a file dialog for one or several `.snpt` files. Empty when cancelled.
#[tauri::command]
pub async fn pick_templates_open(app: tauri::AppHandle) -> CmdResult<Vec<String>> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Snipmunk template", &["snpt"]);
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.pick_files(move |f| {
        let _ = tx.send(f);
    });
    let chosen = rx.recv().map_err(io)?;
    Ok(chosen
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        crate::testdir::new()
    }

    #[test]
    fn the_question_before_an_import_names_the_template_and_refuses_other_files() {
        let d = tmp();
        let file = d.path().join("From the team.snpt");
        write(&file, &json!({ "name": "  Team report " }), d.path()).unwrap();
        assert_eq!(name_in(&file).unwrap(), "Team report");
        write(&file, &json!({}), d.path()).unwrap();
        assert_eq!(name_in(&file).unwrap(), "From the team");
        std::fs::write(&file, b"not a package").unwrap();
        assert!(name_in(&file).is_err());
    }

    #[test]
    fn a_template_file_carries_its_images_and_unknown_fields_and_another_kind_is_refused() {
        let d = tmp();
        let images = d.path().join("images");
        std::fs::create_dir_all(&images).unwrap();
        std::fs::write(images.join("m-logo.png"), b"logo").unwrap();
        std::fs::write(images.join("m-bg.png"), b"bg").unwrap();
        std::fs::write(images.join("secret.txt"), b"no").unwrap();
        let t = json!({ "name": "Team", "logo": "m-logo.png", "cover": { "image": "m-bg.png" }, "future": 7 });
        let file = d.path().join("t").join("own-1.snpt");
        write(&file, &t, &images).unwrap();
        let out = d.path().join("out");
        let back = read(&file, Some(&out)).unwrap();
        assert_eq!(back, t);
        assert_eq!(std::fs::read(out.join("m-logo.png")).unwrap(), b"logo");
        assert_eq!(std::fs::read(out.join("m-bg.png")).unwrap(), b"bg");
        assert_eq!(list_in(&d.path().join("t"))[0]["id"], "own-1");
        // A path is never taken as an image name, and a guide file is not a template.
        let bad = json!({ "name": "x", "logo": "../secret.txt" });
        assert!(image_names(&bad).is_empty());
        let other = d.path().join("g.snpd");
        package::create(&other, crate::snpd::KIND_DOC, 1, &[]).unwrap();
        assert!(read(&other, None).is_err());
        assert!(file_of(d.path(), "../x").is_err());
    }

    #[test]
    fn several_templates_are_written_as_files_named_after_them_without_overwriting() {
        let d = tmp();
        let own = d.path().join("own");
        let images = d.path().join("images");
        std::fs::create_dir_all(&images).unwrap();
        for (id, name) in [
            ("own-1", "Team: A/B"),
            ("own-2", "Team  A B"),
            ("own-3", "con"),
        ] {
            write(
                &own.join(format!("{id}.snpt")),
                &json!({ "name": name }),
                &images,
            )
            .unwrap();
        }
        let out = d.path().join("shared").canonicalize();
        assert!(out.is_err());
        std::fs::create_dir_all(d.path().join("shared")).unwrap();
        let out = d.path().join("shared").canonicalize().unwrap();
        let ids: Vec<String> = ["own-1", "own-2", "own-3"].map(String::from).to_vec();
        assert_eq!(export_into(&own, &ids, &out).unwrap(), 3);
        assert_eq!(
            read(&out.join("Team A B.snpt"), None).unwrap()["name"],
            "Team: A/B"
        );
        assert!(out.join("Team A B (2).snpt").is_file() && out.join("template.snpt").is_file());
        assert!(export_into(&own, &["../x".to_string()], &out).is_err());
        assert!(export_into(&own, &ids, Path::new("relative")).is_err());
    }
}
