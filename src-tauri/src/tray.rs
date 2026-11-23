//! Tray icon and the windows it opens.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub struct TrayLabels {
    open: MenuItem<Wry>,
    capture: MenuItem<Wry>,
    record: MenuItem<Wry>,
    guide: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// "Start recording" in the interface language.
fn record_label(lang: &str) -> &'static str {
    match lang {
        "de" => "Aufnahme starten",
        "es" => "Iniciar grabación",
        "fr" => "Démarrer l’enregistrement",
        "it" => "Avvia registrazione",
        "nl" => "Opname starten",
        "pl" => "Rozpocznij nagrywanie",
        "tr" => "Kaydı başlat",
        "zh-Hans" => "开始录制",
        "zh-Hant" => "開始錄製",
        "ar" => "بدء التسجيل",
        "ur" => "ریکارڈنگ شروع کریں",
        _ => "Start recording",
    }
}

/// "New guide" in the interface language (Documents mode).
fn guide_label(lang: &str) -> &'static str {
    match crate::language::resolve(lang) {
        "de" => "Neue Anleitung",
        "es" => "Nueva guía",
        "fr" => "Nouveau guide",
        "it" => "Nuova guida",
        "nl" => "Nieuwe handleiding",
        "pl" => "Nowy przewodnik",
        "tr" => "Yeni kılavuz",
        "zh-Hans" => "新建指南",
        "zh-Hant" => "新增指南",
        "ar" => "دليل جديد",
        "ur" => "نیا رہنما",
        _ => "New guide",
    }
}

/// "Stop recording" in the interface language.
fn stop_label(lang: &str) -> &'static str {
    match lang {
        "de" => "Aufnahme beenden",
        "es" => "Detener grabación",
        "fr" => "Arrêter l’enregistrement",
        "it" => "Interrompi registrazione",
        "nl" => "Opname stoppen",
        "pl" => "Zatrzymaj nagrywanie",
        "tr" => "Kaydı durdur",
        "zh-Hans" => "停止录制",
        "zh-Hant" => "停止錄製",
        "ar" => "إيقاف التسجيل",
        "ur" => "ریکارڈنگ روکیں",
        _ => "Stop recording",
    }
}

/// The recording item of the tray menu reads "Stop recording" while a recording runs, else "Start recording".
pub fn set_recording(app: &AppHandle, recording: bool) {
    let lang = app
        .state::<crate::commands::AppState>()
        .settings
        .lock()
        .unwrap()
        .language
        .clone();
    let lang = crate::language::resolve(&lang);
    // The menu is changed on the main thread, without waiting for it (a command runs on another thread).
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(l) = handle.try_state::<TrayLabels>() {
            let _ = l.record.set_text(if recording {
                stop_label(lang)
            } else {
                record_label(lang)
            });
        }
    });
}

/// Open, Add capture, Settings, Quit
fn labels(lang: &str) -> [&'static str; 4] {
    match crate::language::resolve(lang) {
        "de" => [
            "Snipmunk öffnen",
            "Aufnahme hinzufügen",
            "Einstellungen",
            "Beenden",
        ],
        "es" => ["Abrir Snipmunk", "Añadir captura", "Configuración", "Salir"],
        "fr" => [
            "Ouvrir Snipmunk",
            "Ajouter une capture",
            "Paramètres",
            "Quitter",
        ],
        "it" => ["Apri Snipmunk", "Aggiungi cattura", "Impostazioni", "Esci"],
        "nl" => [
            "Snipmunk openen",
            "Opname toevoegen",
            "Instellingen",
            "Afsluiten",
        ],
        "pl" => ["Otwórz Snipmunk", "Dodaj zrzut", "Ustawienia", "Zakończ"],
        "tr" => ["Snipmunk'ı aç", "Yakalama ekle", "Ayarlar", "Çık"],
        "zh-Hans" => ["打开 Snipmunk", "添加截图", "设置", "退出"],
        "zh-Hant" => ["開啟 Snipmunk", "新增擷取", "設定", "結束"],
        "ar" => ["فتح Snipmunk", "إضافة لقطة", "الإعدادات", "إنهاء"],
        "ur" => [
            "Snipmunk کھولیں",
            "کیپچر شامل کریں",
            "ترتیبات",
            "باہر نکلیں",
        ],
        _ => ["Open Snipmunk", "Add capture", "Settings", "Quit"],
    }
}

pub fn build(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let [o, c, s, q] = labels(lang);
    let open = MenuItem::with_id(app, "open", o, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", c, true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", record_label(lang), true, None::<&str>)?;
    let guide = MenuItem::with_id(app, "guide", guide_label(lang), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", s, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", q, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &capture, &record, &guide, &settings, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Snipmunk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "capture" => crate::capture::trigger(app),
            // The page starts the recording flow (the area is chosen in the overlay).
            "record" => {
                if crate::recording::is_recording(app) {
                    // Stop from the tray: the card is made and Snipmunk comes back to the front.
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = crate::recording::stop_now(&app);
                    });
                } else {
                    show_main(app);
                    let _ = tauri::Emitter::emit(app, "start-recording", ());
                }
            }
            "guide" => {
                if crate::steprec::is_recording(app) {
                    // Stop from the tray: the guide is finished and opens in the guide view.
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::steprec::guide_stop(app).await;
                    });
                } else {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::steprec::guide_start(app, None).await;
                    });
                }
            }
            "settings" => open_settings_window(app),
            "quit" => crate::projects::request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayLabels {
        open,
        capture,
        record,
        guide,
        settings,
        quit,
    });
    Ok(())
}

pub fn set_language(app: &AppHandle, lang: &str) {
    if let Some(l) = app.try_state::<TrayLabels>() {
        let [o, c, s, q] = labels(lang);
        let _ = l.open.set_text(o);
        let _ = l.capture.set_text(c);
        let _ = l.record.set_text(record_label(lang));
        let _ = l.guide.set_text(guide_label(lang));
        let _ = l.settings.set_text(s);
        let _ = l.quit.set_text(q);
    }
}

/// Show the main window and bring it to the front (also from the tray, a second launch and a finished capture).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        // A saved place on a monitor that is gone must not keep the window out of sight.
        crate::placement::ensure_on_screen(&w);
        let _ = w.set_focus();
        // Windows may refuse the focus to a program that was not used last (the second launch, the toast): a short stay
        // on top still brings the window in front of the others.
        if !w.is_focused().unwrap_or(true) {
            let _ = w.set_always_on_top(true);
            let keep = app
                .state::<crate::commands::AppState>()
                .settings
                .lock()
                .unwrap()
                .always_on_top;
            let _ = w.set_always_on_top(keep);
        }
    }
}

/// In a development build the settings window loads its page from the Vite server when it is opened (the main window loaded
/// its page once, at start). When that server is gone (stopped, or another dev session took its port) the web view shows
/// "localhost refused to connect"; a short page that says what is wrong is shown instead.
#[cfg(debug_assertions)]
fn settings_url(app: &AppHandle) -> tauri::WebviewUrl {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    if let Some(dev) = app.config().build.dev_url.clone() {
        let host = dev.host_str().unwrap_or("localhost").to_string();
        let port = dev.port_or_known_default().unwrap_or(80);
        let up = (host.as_str(), port)
            .to_socket_addrs()
            .map(|mut a| {
                a.any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok())
            })
            .unwrap_or(false);
        if !up {
            let html = format!(
                "<body style='font-family:Segoe UI,sans-serif;padding:32px'><h2>The dev server is not running</h2><p>Nothing answers at {host}:{port}, so the settings page cannot load. Close Snipmunk and start run-snipmunk.bat again (it starts the Vite server on port {port}).</p></body>"
            );
            let encoded: String = html
                .chars()
                .flat_map(|c| match c {
                    ' ' => "%20".chars().collect::<Vec<_>>(),
                    '#' => "%23".chars().collect(),
                    '%' => "%25".chars().collect(),
                    '<' => "%3C".chars().collect(),
                    '>' => "%3E".chars().collect(),
                    other => vec![other],
                })
                .collect();
            if let Ok(url) = format!("data:text/html,{encoded}").parse() {
                return tauri::WebviewUrl::External(url);
            }
        }
    }
    tauri::WebviewUrl::default()
}

#[cfg(not(debug_assertions))]
fn settings_url(_: &AppHandle) -> tauri::WebviewUrl {
    tauri::WebviewUrl::default()
}

/// Open (or focus) the settings window.
///
/// The window is built on a separate thread: building a window from the main thread
/// (a sync command or a tray handler) can deadlock on Windows and leave it blank.
pub fn open_settings_window(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window("settings") {
            center_over_main(&app, &w);
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            return;
        }
        let built = tauri::WebviewWindowBuilder::new(&app, "settings", settings_url(&app))
            .title("Snipmunk – Settings")
            .inner_size(880.0, 640.0)
            .min_inner_size(700.0, 460.0)
            .decorations(false)
            .shadow(true)
            .visible(false)
            .build();
        match built {
            Ok(w) => {
                crate::webview::disable_browser_accelerators(&w);
                center_over_main(&app, &w);
                let _ = w.show();
                let _ = w.set_focus();
            }
            Err(err) => eprintln!("could not open settings window: {err}"),
        }
    });
}

/// Where a window of `size` pixels goes to be centered over a window at `outer` (physical pixels).
pub fn centered_over(outer: (i32, i32, u32, u32), size: (u32, u32)) -> (i32, i32) {
    (
        outer.0 + (outer.2 as i32 - size.0 as i32) / 2,
        outer.1 + (outer.3 as i32 - size.1 as i32) / 2,
    )
}

/// Put `window` in the middle of the main window, on the same monitor. When the main window is hidden (the tray)
/// or minimized, the window is centered on its monitor instead.
pub fn center_over_main(app: &AppHandle, window: &tauri::WebviewWindow) {
    let main = app
        .get_webview_window("main")
        .filter(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(false));
    let (Some(main), Ok(size)) = (main, window.outer_size()) else {
        let _ = window.center();
        return;
    };
    if let (Ok(pos), Ok(main_size)) = (main.outer_position(), main.outer_size()) {
        let (x, y) = centered_over(
            (pos.x, pos.y, main_size.width, main_size.height),
            (size.width, size.height),
        );
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    } else {
        let _ = window.center();
    }
}

#[cfg(test)]
mod tests {
    use super::{centered_over, labels};

    #[test]
    fn a_window_is_centered_over_another_even_when_it_is_larger_or_on_a_second_monitor() {
        assert_eq!(centered_over((100, 50, 1000, 700), (800, 600)), (200, 100));
        assert_eq!(
            centered_over((100, 50, 600, 400), (800, 600)),
            (0, -50),
            "larger: it hangs over evenly"
        );
        assert_eq!(
            centered_over((-1920, 0, 1920, 1080), (620, 640)),
            (-1920 + 650, 220),
            "a monitor left of the primary one"
        );
    }

    #[test]
    fn the_tray_menu_has_four_entries_in_every_language() {
        assert_eq!(labels("en")[1], "Add capture");
        assert_eq!(labels("de")[3], "Beenden");
        assert_eq!(labels("xx"), labels("en"));
        assert_eq!(labels("zh-TW")[3], "結束");
        for l in crate::settings::LANGUAGES {
            let set = labels(l);
            assert!(set.iter().all(|s| !s.trim().is_empty()), "{l}");
            if l != "en" {
                assert_ne!(set, labels("en"), "{l} is translated");
            }
        }
    }
}
