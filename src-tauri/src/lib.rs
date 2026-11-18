//! Snipmunk backend: window and tray lifecycle, settings and the session store.

mod capture;
mod commands;
mod error;
mod freeform;
mod gallery;
mod geometry;
mod hotkey;
mod import;
mod language;
mod naming;
mod ocr;
mod output;
mod placement;
mod popups;
mod sessions;
mod settings;
mod startup;
mod thumbs;
mod titlebar;
mod tray;
mod webview;
mod winlist;

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use commands::AppState;

pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch just brings the running window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        // The only network access: asks GitHub for latest.json when an update check is run (see docs/releasing.md).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::load())
        .manage(capture::Capture::new())
        .manage(hotkey::HotkeyManager::new())
        .register_uri_scheme_protocol("snipmunk-img", commands::serve_image)
        .register_uri_scheme_protocol("snipmunk-cap", capture::serve)
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::open_settings,
            commands::quit_app,
            commands::close_action,
            commands::get_hotkey_status,
            commands::check_shortcut,
            hotkey::shortcut_fired,
            commands::open_url,
            commands::set_active_group,
            commands::get_current_session,
            commands::new_session,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::rename_capture,
            commands::delete_capture,
            commands::reorder_captures,
            commands::move_capture_to_group,
            gallery::move_captures,
            gallery::duplicate_captures,
            gallery::reorder_groups,
            gallery::set_group_color,
            gallery::set_group_emoji,
            gallery::import_image,
            gallery::set_annotations,
            gallery::set_capture_thumbnail,
            gallery::replace_capture_image,
            ocr::ocr_status,
            ocr::ocr_get,
            ocr::ocr_recognize,
            ocr::copy_text,
            ocr::copy_table,
            ocr::open_os_settings,
            gallery::debug_seed_session,
            titlebar::set_maximize_rect,
            capture::start_capture,
            capture::capture_overlay_info,
            capture::capture_overlay_ready,
            capture::capture_cancel,
            capture::capture_set_mode,
            capture::capture_set_delay,
            capture::capture_finish,
            popups::toast_open,
            popups::toast_close,
        ])
        .setup(|app| {
            let settings = app.state::<AppState>().settings.lock().unwrap().clone();
            tray::build(app.handle(), &settings.language)?;
            if let Some(main) = app.get_webview_window("main") {
                webview::disable_browser_accelerators(&main);
                // The window is created hidden: put it back where it was before it is shown.
                placement::restore(&main);
            }
            commands::apply(app.handle(), &settings); // also installs the capture shortcut
            capture::precreate(app.handle());
            // Sessions saved by earlier versions get sharp thumbnails for the large gallery view (background thread).
            thumbs::spawn_upgrade(app.handle().clone());
            // Only the autostart entry (`--hidden`) stays in the tray; every other start shows the window.
            if !startup::launched_hidden(std::env::args()) {
                tray::show_main(app.handle());
                startup::keep_main_shown(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        placement::track(&w);
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    let behavior = window
                        .app_handle()
                        .state::<AppState>()
                        .settings
                        .lock()
                        .unwrap()
                        .close_action
                        .clone();
                    api.prevent_close();
                    placement::flush();
                    match behavior.as_str() {
                        "background" => {
                            let _ = window.hide();
                        }
                        "quit" => window.app_handle().exit(0),
                        // The frontend shows the dialog and answers with `close_action`.
                        _ => {
                            let _ = window.emit("close-requested", ());
                        }
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Snipmunk")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                placement::flush();
                hotkey::stop(app);
                let state = app.state::<AppState>();
                if state.settings.lock().unwrap().clear_on_exit {
                    state.sessions.lock().unwrap().delete_current();
                }
            }
        });
}
