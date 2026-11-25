//! The text of a guide step, written from what the recorder saw (no Windows code; unit tested).
//!
//! The text is stored as small structured parts (`Part`: a piece of text and whether it is bold), so the step editor (7.5-B) can edit
//! it and the exporters (7.5-C) can write it as HTML, Markdown, Word or PDF. The words come from one table per UI language
//! (`templates`); the element and window names are the bold parts. Names are cleaned (`clean_name`): no trailing ":" or "…", spaces
//! collapsed, capped in length, and a raw id like "btnSave_1" is never shown.

use serde::{Deserialize, Serialize};

/// A piece of step text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Part {
    pub t: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub b: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl Part {
    fn plain(t: impl Into<String>) -> Self {
        Self {
            t: t.into(),
            b: false,
        }
    }
    fn bold(t: impl Into<String>) -> Self {
        Self {
            t: t.into(),
            b: true,
        }
    }
}

/// What kind of step it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Click,
    RightClick,
    DoubleClick,
    Type,
    Key,
}

/// What the recorder knows about a step, for its text.
#[derive(Debug, Clone, Default)]
pub struct Meta {
    /// UI Automation control type as a word ("Button", "MenuItem", "CheckBox", ...); empty when unknown.
    pub control: String,
    /// The visible name of the element.
    pub name: String,
    /// The names of the parent menus (outermost first) for a menu item.
    pub menu_path: Vec<String>,
    /// A check box or toggle: its state BEFORE the click (`Some(true)` = on).
    pub toggle_before: Option<bool>,
    /// The title of the window (or the name of the app) the step happened in.
    pub window: String,
    /// The first step in a new window or app: the text says where.
    pub new_window: bool,
    /// What was typed (a typing step).
    pub typed: String,
    /// The shortcut that was pressed, "Ctrl+S" (a shortcut step).
    pub keys: String,
    /// A part of the Windows shell (taskbar, Start menu, system tray, desktop): the step says so instead of naming the app.
    pub area: Area,
    /// A standard caption button of a window (the name comes from the UI language, not from the element).
    pub caption: Option<Caption>,
    /// The title of the page or tab (Chrome, Edge, Electron, web view apps) for a click without an element name.
    pub page: String,
    /// The element holds text that is written (an editor, a text field): without a name of its own it is called that.
    pub surface: Surface,
}

/// A control that holds written text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Surface {
    #[default]
    None,
    /// A large text area: a text editor, a document.
    Editor,
    /// A text field of a form.
    Field,
}

/// What kind of text control an element is, from its control type and its window class.
pub fn surface_of(control: &str, class: &str) -> Surface {
    let class = class.to_ascii_lowercase();
    if class.starts_with("scintilla") || class.contains("richedit") || control == "Document" {
        Surface::Editor
    } else if control == "Edit" {
        Surface::Field
    } else {
        Surface::None
    }
}

/// A name longer than this is not the name of a control: it is what the control holds.
const CONTENT_LENGTH: usize = 60;

fn flat(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Is `candidate` (a name of an element) really what the element holds? `content` are the pieces of its value and text.
fn is_content(candidate: &str, content: &[String]) -> bool {
    if candidate.trim().contains(['\n', '\r']) || candidate.chars().count() > CONTENT_LENGTH {
        return true;
    }
    let name = flat(candidate);
    content.iter().map(|c| flat(c)).any(|c| {
        !c.is_empty()
            && !name.is_empty()
            && (c == name
                || (name.chars().count() >= 4 && c.starts_with(&name))
                || (c.chars().count() >= 8 && name.starts_with(&c)))
    })
}

/// The name a step may use for an element, and what to call it without one. What a text control HOLDS is never a name:
/// for a text control its label wins, then its own name when that is not its content; a Scintilla editor reports its whole
/// text as its name. `content` is only compared with, never kept.
pub fn safe_name(
    control: &str,
    class: &str,
    name: &str,
    label: &str,
    content: &[String],
) -> (String, Surface) {
    let mut surface = surface_of(control, class);
    if surface == Surface::None {
        if !is_content(name, content) {
            return (name.to_string(), Surface::None);
        }
        // Some other control whose name is its own text: a text area under another type.
        if content.iter().any(|c| !c.trim().is_empty()) {
            surface = Surface::Editor;
        }
        return (String::new(), surface);
    }
    let label = label.trim();
    if !label.is_empty() && !is_content(label, content) {
        return (label.to_string(), surface);
    }
    if !class.to_ascii_lowercase().starts_with("scintilla") && !is_content(name, content) {
        return (name.to_string(), surface);
    }
    (String::new(), surface)
}

/// A part of the Windows shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Area {
    #[default]
    None,
    Taskbar,
    StartMenu,
    Tray,
    Desktop,
}

/// The four caption buttons.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Caption {
    Minimize,
    Maximize,
    Restore,
    Close,
}

/// The caption button an element is: by its automation id (the same in every Windows language), only for buttons.
pub fn caption_of(control: &str, automation_id: &str, name: &str) -> Option<Caption> {
    if control != "Button" {
        return None;
    }
    match automation_id {
        "Minimize" | "MinimizeButton" | "minimizeButton" => Some(Caption::Minimize),
        "Maximize" | "MaximizeButton" | "maximizeButton" => Some(Caption::Maximize),
        "Restore" | "RestoreButton" | "restoreButton" => Some(Caption::Restore),
        "Close" | "CloseButton" | "closeButton" => Some(Caption::Close),
        // Classic windows name their buttons in the language of Windows and give them no id.
        _ => match name.trim().to_lowercase().as_str() {
            "minimize" | "minimise" => Some(Caption::Minimize),
            "maximize" | "maximise" => Some(Caption::Maximize),
            "restore" | "restore down" => Some(Caption::Restore),
            "close" => Some(Caption::Close),
            _ => None,
        },
    }
}

/// The name of a taskbar button for people: "Snipping Tool - 1 running window pinned" and "File Explorer pinned" become the app name.
/// The words around the name are in the language of Windows, so the name is cut at the first " - " (also "–", "—") and the known
/// state words are dropped at the end.
pub fn clean_taskbar_name(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    for sep in [" - ", " – ", " — ", " | "] {
        if let Some(i) = s.find(sep) {
            s.truncate(i);
        }
    }
    const STATE: &[&str] = &[
        "pinned",
        "running",
        "angeheftet",
        "epingle",
        "épinglé",
        "anclado",
        "fissato",
        "vastgemaakt",
        "przypięty",
        "sabitlenmiş",
        "已固定",
        "已釘選",
        "已钉选",
        "مثبت",
        "پن شدہ",
    ];
    loop {
        let t = s.trim_end();
        let low = t.to_lowercase();
        let hit = STATE
            .iter()
            .find(|w| low.ends_with(&w.to_lowercase()) && t.chars().count() > w.chars().count());
        match hit {
            Some(w) => {
                let keep = t.chars().count() - w.chars().count();
                s = t
                    .chars()
                    .take(keep)
                    .collect::<String>()
                    .trim_end()
                    .to_string();
            }
            None => break,
        }
    }
    clean_name(&s)
}

/// The most characters of a name in a step text.
const NAME_LENGTH: usize = 40;

/// A name for people: trimmed, spaces collapsed, no trailing ":" "…" "...", at most 40 characters; "" for a raw id.
pub fn clean_name(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut s = collapsed.trim().to_string();
    loop {
        let t = s
            .trim_end_matches(['…', ':', '：'])
            .trim_end_matches("...")
            .trim_end()
            .to_string();
        if t == s {
            break;
        }
        s = t;
    }
    if looks_like_id(&s) {
        return String::new();
    }
    if s.chars().count() > NAME_LENGTH {
        s = s
            .chars()
            .take(NAME_LENGTH - 1)
            .collect::<String>()
            .trim_end()
            .to_string()
            + "…";
    }
    s
}

/// "btnSave_1", "txt_City", "IDC_EDIT2": identifiers of programmers, not words of people.
fn looks_like_id(s: &str) -> bool {
    if s.is_empty() || s.contains(char::is_whitespace) {
        return false;
    }
    let prefixed = [
        "btn", "txt", "lbl", "chk", "cmb", "lst", "tab", "mnu", "idc", "ctl", "edt",
    ]
    .iter()
    .any(|p| {
        let l = s.to_lowercase();
        l.starts_with(p)
            && s.chars()
                .nth(p.len())
                .is_some_and(|c| c.is_uppercase() || c == '_' || c.is_ascii_digit())
    });
    let snake = s.contains('_') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    prefixed || snake
}

/// One table of words per UI language. `{b0}` `{b1}` are bold arguments, `{p0}` a plain one.
struct T {
    click: &'static str,
    click_here: &'static str,
    click_in: &'static str,
    right: &'static str,
    right_here: &'static str,
    dbl: &'static str,
    dbl_here: &'static str,
    select: &'static str,
    tab: &'static str,
    check: &'static str,
    uncheck: &'static str,
    field: &'static str,
    type_in: &'static str,
    type_plain: &'static str,
    press: &'static str,
    in_app: &'static str,
    in_taskbar: &'static str,
    in_start: &'static str,
    in_tray: &'static str,
    on_desktop: &'static str,
    click_page: &'static str,
    cap_min: &'static str,
    cap_max: &'static str,
    cap_restore: &'static str,
    cap_close: &'static str,
    click_editor: &'static str,
    click_textfield: &'static str,
    type_editor: &'static str,
    type_textfield: &'static str,
}

fn templates(lang: &str) -> T {
    match lang.split('-').next().unwrap_or("en") {
        "de" => T {
            click: "Klicken Sie auf {b0}",
            click_here: "Klicken Sie hier",
            click_in: "Klicken Sie in {b0}",
            right: "Klicken Sie mit der rechten Maustaste auf {b0}",
            right_here: "Klicken Sie hier mit der rechten Maustaste",
            dbl: "Doppelklicken Sie auf {b0}",
            dbl_here: "Doppelklicken Sie hier",
            select: "Wählen Sie {b0}",
            tab: "Öffnen Sie den Tab {b0}",
            check: "Aktivieren Sie {b0}",
            uncheck: "Deaktivieren Sie {b0}",
            field: "Klicken Sie in das Feld {b0}",
            type_in: "Geben Sie „{p0}“ in {b1} ein",
            type_plain: "Geben Sie „{p0}“ ein",
            press: "Drücken Sie {b0}",
            in_app: " in {b0}",
            in_taskbar: " in der Taskleiste",
            in_start: " im Startmenü",
            in_tray: " im Infobereich",
            on_desktop: " auf dem Desktop",
            click_page: "Klicken Sie in {b0} ({p1})",
            cap_min: "Minimieren",
            cap_max: "Maximieren",
            cap_restore: "Wiederherstellen",
            cap_close: "Schließen",
            click_editor: "Klicken Sie in den Editor",
            click_textfield: "Klicken Sie in das Textfeld",
            type_editor: "Geben Sie „{p0}“ in den Editor ein",
            type_textfield: "Geben Sie „{p0}“ in das Textfeld ein",
        },
        "es" => T {
            click: "Haz clic en {b0}",
            click_here: "Haz clic aquí",
            click_in: "Haz clic en {b0}",
            right: "Haz clic derecho en {b0}",
            right_here: "Haz clic derecho aquí",
            dbl: "Haz doble clic en {b0}",
            dbl_here: "Haz doble clic aquí",
            select: "Selecciona {b0}",
            tab: "Abre la pestaña {b0}",
            check: "Marca {b0}",
            uncheck: "Desmarca {b0}",
            field: "Haz clic en el campo {b0}",
            type_in: "Escribe «{p0}» en {b1}",
            type_plain: "Escribe «{p0}»",
            press: "Pulsa {b0}",
            in_app: " en {b0}",
            in_taskbar: " en la barra de tareas",
            in_start: " en el menú Inicio",
            in_tray: " en el área de notificaciones",
            on_desktop: " en el escritorio",
            click_page: "Haz clic en {b0} ({p1})",
            cap_min: "Minimizar",
            cap_max: "Maximizar",
            cap_restore: "Restaurar",
            cap_close: "Cerrar",
            click_editor: "Haz clic en el editor",
            click_textfield: "Haz clic en el campo de texto",
            type_editor: "Escribe «{p0}» en el editor",
            type_textfield: "Escribe «{p0}» en el campo de texto",
        },
        "fr" => T {
            click: "Cliquez sur {b0}",
            click_here: "Cliquez ici",
            click_in: "Cliquez dans {b0}",
            right: "Faites un clic droit sur {b0}",
            right_here: "Faites un clic droit ici",
            dbl: "Double-cliquez sur {b0}",
            dbl_here: "Double-cliquez ici",
            select: "Sélectionnez {b0}",
            tab: "Ouvrez l’onglet {b0}",
            check: "Cochez {b0}",
            uncheck: "Décochez {b0}",
            field: "Cliquez dans le champ {b0}",
            type_in: "Saisissez « {p0} » dans {b1}",
            type_plain: "Saisissez « {p0} »",
            press: "Appuyez sur {b0}",
            in_app: " dans {b0}",
            in_taskbar: " dans la barre des tâches",
            in_start: " dans le menu Démarrer",
            in_tray: " dans la zone de notification",
            on_desktop: " sur le Bureau",
            click_page: "Cliquez dans {b0} ({p1})",
            cap_min: "Réduire",
            cap_max: "Agrandir",
            cap_restore: "Restaurer",
            cap_close: "Fermer",
            click_editor: "Cliquez dans l’éditeur",
            click_textfield: "Cliquez dans le champ de texte",
            type_editor: "Saisissez « {p0} » dans l’éditeur",
            type_textfield: "Saisissez « {p0} » dans le champ de texte",
        },
        "it" => T {
            click: "Fai clic su {b0}",
            click_here: "Fai clic qui",
            click_in: "Fai clic in {b0}",
            right: "Fai clic con il pulsante destro su {b0}",
            right_here: "Fai clic destro qui",
            dbl: "Fai doppio clic su {b0}",
            dbl_here: "Fai doppio clic qui",
            select: "Seleziona {b0}",
            tab: "Apri la scheda {b0}",
            check: "Seleziona la casella {b0}",
            uncheck: "Deseleziona la casella {b0}",
            field: "Fai clic nel campo {b0}",
            type_in: "Digita \"{p0}\" in {b1}",
            type_plain: "Digita \"{p0}\"",
            press: "Premi {b0}",
            in_app: " in {b0}",
            in_taskbar: " nella barra delle applicazioni",
            in_start: " nel menu Start",
            in_tray: " nell’area di notifica",
            on_desktop: " sul desktop",
            click_page: "Fai clic in {b0} ({p1})",
            cap_min: "Riduci a icona",
            cap_max: "Ingrandisci",
            cap_restore: "Ripristina",
            cap_close: "Chiudi",
            click_editor: "Fai clic nell’editor",
            click_textfield: "Fai clic nel campo di testo",
            type_editor: "Digita \"{p0}\" nell’editor",
            type_textfield: "Digita \"{p0}\" nel campo di testo",
        },
        "nl" => T {
            click: "Klik op {b0}",
            click_here: "Klik hier",
            click_in: "Klik in {b0}",
            right: "Klik met rechts op {b0}",
            right_here: "Klik hier met rechts",
            dbl: "Dubbelklik op {b0}",
            dbl_here: "Dubbelklik hier",
            select: "Selecteer {b0}",
            tab: "Open het tabblad {b0}",
            check: "Schakel {b0} in",
            uncheck: "Schakel {b0} uit",
            field: "Klik op het veld {b0}",
            type_in: "Typ \"{p0}\" in {b1}",
            type_plain: "Typ \"{p0}\"",
            press: "Druk op {b0}",
            in_app: " in {b0}",
            in_taskbar: " in de taakbalk",
            in_start: " in het menu Start",
            in_tray: " in het systeemvak",
            on_desktop: " op het bureaublad",
            click_page: "Klik in {b0} ({p1})",
            cap_min: "Minimaliseren",
            cap_max: "Maximaliseren",
            cap_restore: "Herstellen",
            cap_close: "Sluiten",
            click_editor: "Klik in de editor",
            click_textfield: "Klik in het tekstveld",
            type_editor: "Typ \"{p0}\" in de editor",
            type_textfield: "Typ \"{p0}\" in het tekstveld",
        },
        "pl" => T {
            click: "Kliknij {b0}",
            click_here: "Kliknij tutaj",
            click_in: "Kliknij w {b0}",
            right: "Kliknij prawym przyciskiem {b0}",
            right_here: "Kliknij tutaj prawym przyciskiem",
            dbl: "Kliknij dwukrotnie {b0}",
            dbl_here: "Kliknij tutaj dwukrotnie",
            select: "Wybierz {b0}",
            tab: "Otwórz kartę {b0}",
            check: "Zaznacz {b0}",
            uncheck: "Odznacz {b0}",
            field: "Kliknij pole {b0}",
            type_in: "Wpisz „{p0}” w {b1}",
            type_plain: "Wpisz „{p0}”",
            press: "Naciśnij {b0}",
            in_app: " w {b0}",
            in_taskbar: " na pasku zadań",
            in_start: " w menu Start",
            in_tray: " w obszarze powiadomień",
            on_desktop: " na pulpicie",
            click_page: "Kliknij w {b0} ({p1})",
            cap_min: "Minimalizuj",
            cap_max: "Maksymalizuj",
            cap_restore: "Przywróć",
            cap_close: "Zamknij",
            click_editor: "Kliknij w edytorze",
            click_textfield: "Kliknij pole tekstowe",
            type_editor: "Wpisz „{p0}” w edytorze",
            type_textfield: "Wpisz „{p0}” w polu tekstowym",
        },
        "tr" => T {
            click: "{b0} öğesine tıklayın",
            click_here: "Buraya tıklayın",
            click_in: "{b0} içinde tıklayın",
            right: "{b0} öğesine sağ tıklayın",
            right_here: "Buraya sağ tıklayın",
            dbl: "{b0} öğesine çift tıklayın",
            dbl_here: "Buraya çift tıklayın",
            select: "{b0} öğesini seçin",
            tab: "{b0} sekmesini açın",
            check: "{b0} kutusunu işaretleyin",
            uncheck: "{b0} kutusunun işaretini kaldırın",
            field: "{b0} alanına tıklayın",
            type_in: "{b1} alanına “{p0}” yazın",
            type_plain: "“{p0}” yazın",
            press: "{b0} tuşlarına basın",
            in_app: " ({b0})",
            in_taskbar: " (görev çubuğu)",
            in_start: " (Başlat menüsü)",
            in_tray: " (sistem tepsisi)",
            on_desktop: " (masaüstü)",
            click_page: "{b0} içinde tıklayın ({p1})",
            cap_min: "Simge durumuna küçült",
            cap_max: "Ekranı kapla",
            cap_restore: "Önceki boyut",
            cap_close: "Kapat",
            click_editor: "Düzenleyicide tıklayın",
            click_textfield: "Metin alanına tıklayın",
            type_editor: "Düzenleyiciye “{p0}” yazın",
            type_textfield: "Metin alanına “{p0}” yazın",
        },
        "zh" => {
            if lang.contains("Hant") || lang.ends_with("TW") || lang.ends_with("HK") {
                T {
                    click: "點選 {b0}",
                    click_here: "點選此處",
                    click_in: "在 {b0} 中點選",
                    right: "以右鍵點選 {b0}",
                    right_here: "在此處按右鍵",
                    dbl: "按兩下 {b0}",
                    dbl_here: "在此處按兩下",
                    select: "選取 {b0}",
                    tab: "開啟 {b0} 索引標籤",
                    check: "勾選 {b0}",
                    uncheck: "取消勾選 {b0}",
                    field: "點選 {b0} 欄位",
                    type_in: "在 {b1} 中輸入「{p0}」",
                    type_plain: "輸入「{p0}」",
                    press: "按 {b0}",
                    in_app: "（在 {b0} 中）",
                    in_taskbar: "（在工作列中）",
                    in_start: "（在「開始」功能表中）",
                    in_tray: "（在系統匣中）",
                    on_desktop: "（在桌面上）",
                    click_page: "在 {b0} 中點選（{p1}）",
                    cap_min: "最小化",
                    cap_max: "最大化",
                    cap_restore: "還原",
                    cap_close: "關閉",
                    click_editor: "在編輯器中點選",
                    click_textfield: "點選文字欄位",
                    type_editor: "在編輯器中輸入「{p0}」",
                    type_textfield: "在文字欄位中輸入「{p0}」",
                }
            } else {
                T {
                    click: "点击 {b0}",
                    click_here: "点击此处",
                    click_in: "在 {b0} 中点击",
                    right: "右键点击 {b0}",
                    right_here: "在此处右键点击",
                    dbl: "双击 {b0}",
                    dbl_here: "在此处双击",
                    select: "选择 {b0}",
                    tab: "打开 {b0} 选项卡",
                    check: "勾选 {b0}",
                    uncheck: "取消勾选 {b0}",
                    field: "点击 {b0} 字段",
                    type_in: "在 {b1} 中输入“{p0}”",
                    type_plain: "输入“{p0}”",
                    press: "按 {b0}",
                    in_app: "（在 {b0} 中）",
                    in_taskbar: "（在任务栏中）",
                    in_start: "（在“开始”菜单中）",
                    in_tray: "（在系统托盘中）",
                    on_desktop: "（在桌面上）",
                    click_page: "在 {b0} 中点击（{p1}）",
                    cap_min: "最小化",
                    cap_max: "最大化",
                    cap_restore: "还原",
                    cap_close: "关闭",
                    click_editor: "在编辑器中点击",
                    click_textfield: "点击文本框",
                    type_editor: "在编辑器中输入“{p0}”",
                    type_textfield: "在文本框中输入“{p0}”",
                }
            }
        }
        "ar" => T {
            click: "انقر على {b0}",
            click_here: "انقر هنا",
            click_in: "انقر في {b0}",
            right: "انقر بزر الماوس الأيمن على {b0}",
            right_here: "انقر بزر الماوس الأيمن هنا",
            dbl: "انقر نقرًا مزدوجًا على {b0}",
            dbl_here: "انقر نقرًا مزدوجًا هنا",
            select: "اختر {b0}",
            tab: "افتح علامة التبويب {b0}",
            check: "حدّد {b0}",
            uncheck: "ألغِ تحديد {b0}",
            field: "انقر على الحقل {b0}",
            type_in: "اكتب «{p0}» في {b1}",
            type_plain: "اكتب «{p0}»",
            press: "اضغط {b0}",
            in_app: " في {b0}",
            in_taskbar: " في شريط المهام",
            in_start: " في قائمة ابدأ",
            in_tray: " في منطقة الإعلام",
            on_desktop: " على سطح المكتب",
            click_page: "انقر في {b0} ({p1})",
            cap_min: "تصغير",
            cap_max: "تكبير",
            cap_restore: "استعادة",
            cap_close: "إغلاق",
            click_editor: "انقر في المحرر",
            click_textfield: "انقر في حقل النص",
            type_editor: "اكتب «{p0}» في المحرر",
            type_textfield: "اكتب «{p0}» في حقل النص",
        },
        "ur" => T {
            click: "{b0} پر کلک کریں",
            click_here: "یہاں کلک کریں",
            click_in: "{b0} میں کلک کریں",
            right: "{b0} پر دایاں کلک کریں",
            right_here: "یہاں دایاں کلک کریں",
            dbl: "{b0} پر ڈبل کلک کریں",
            dbl_here: "یہاں ڈبل کلک کریں",
            select: "{b0} منتخب کریں",
            tab: "{b0} ٹیب کھولیں",
            check: "{b0} کو چیک کریں",
            uncheck: "{b0} کا نشان ہٹائیں",
            field: "{b0} فیلڈ پر کلک کریں",
            type_in: "{b1} میں «{p0}» لکھیں",
            type_plain: "«{p0}» لکھیں",
            press: "{b0} دبائیں",
            in_app: " میں {b0}",
            in_taskbar: " ٹاسک بار میں",
            in_start: " اسٹارٹ مینو میں",
            in_tray: " سسٹم ٹرے میں",
            on_desktop: " ڈیسک ٹاپ پر",
            click_page: "{b0} میں کلک کریں ({p1})",
            cap_min: "چھوٹا کریں",
            cap_max: "بڑا کریں",
            cap_restore: "بحال کریں",
            cap_close: "بند کریں",
            click_editor: "ایڈیٹر میں کلک کریں",
            click_textfield: "متن کے خانے میں کلک کریں",
            type_editor: "ایڈیٹر میں «{p0}» لکھیں",
            type_textfield: "متن کے خانے میں «{p0}» لکھیں",
        },
        _ => T {
            click: "Click {b0}",
            click_here: "Click here",
            click_in: "Click in {b0}",
            right: "Right-click {b0}",
            right_here: "Right-click here",
            dbl: "Double-click {b0}",
            dbl_here: "Double-click here",
            select: "Select {b0}",
            tab: "Open the {b0} tab",
            check: "Check {b0}",
            uncheck: "Uncheck {b0}",
            field: "Click the {b0} field",
            type_in: "Type '{p0}' in {b1}",
            type_plain: "Type '{p0}'",
            press: "Press {b0}",
            in_app: " in {b0}",
            in_taskbar: " in the taskbar",
            in_start: " in the Start menu",
            in_tray: " in the system tray",
            on_desktop: " on the desktop",
            click_page: "Click in {b0} ({p1})",
            cap_min: "Minimize",
            cap_max: "Maximize",
            cap_restore: "Restore",
            cap_close: "Close",
            click_editor: "Click in the editor",
            click_textfield: "Click in the text field",
            type_editor: "Type '{p0}' in the editor",
            type_textfield: "Type '{p0}' in the text field",
        },
    }
}

/// The local name of a key in step texts, where one is standard (the recorder always writes the English names; the text is made
/// in the language of the program). Languages without an entry keep the English names.
fn key_names(lang: &str) -> &'static [(&'static str, &'static str)] {
    match lang.split('-').next().unwrap_or("en") {
        "de" => &[
            ("Ctrl", "Strg"),
            ("Shift", "Umschalt"),
            ("Delete", "Entf"),
            ("Enter", "Eingabe"),
            ("Home", "Pos1"),
            ("End", "Ende"),
            ("Page Up", "Bild↑"),
            ("Page Down", "Bild↓"),
            ("Insert", "Einfg"),
            ("Backspace", "Rück"),
            ("Space", "Leertaste"),
        ],
        "fr" => &[
            ("Shift", "Maj"),
            ("Delete", "Suppr"),
            ("Enter", "Entrée"),
            ("Esc", "Échap"),
            ("Backspace", "Retour arrière"),
            ("Space", "Espace"),
        ],
        "es" => &[
            ("Shift", "Mayús"),
            ("Delete", "Supr"),
            ("Enter", "Intro"),
            ("Backspace", "Retroceso"),
            ("Space", "Espacio"),
        ],
        "it" => &[
            ("Shift", "Maiusc"),
            ("Delete", "Canc"),
            ("Enter", "Invio"),
            ("Space", "Spazio"),
        ],
        _ => &[],
    }
}

/// A shortcut such as "Ctrl+Shift+S" with the key names of the language.
pub fn localize_keys(keys: &str, lang: &str) -> String {
    let table = key_names(lang);
    keys.split('+')
        .map(|k| {
            table
                .iter()
                .find(|(en, _)| *en == k)
                .map_or(k, |(_, local)| *local)
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Fill a template: `{b0}`/`{b1}` become bold parts, `{p0}` a plain one.
fn render(tpl: &str, args: &[&str]) -> Vec<Part> {
    let mut parts: Vec<Part> = Vec::new();
    let mut rest = tpl;
    while let Some(i) = rest.find('{') {
        if i > 0 {
            parts.push(Part::plain(&rest[..i]));
        }
        let Some(j) = rest[i..].find('}') else { break };
        let token = &rest[i + 1..i + j];
        let n = token[1..].parse::<usize>().unwrap_or(0);
        let value = args.get(n).copied().unwrap_or("");
        parts.push(if token.starts_with('b') {
            Part::bold(value)
        } else {
            Part::plain(value)
        });
        rest = &rest[i + j + 1..];
    }
    if !rest.is_empty() {
        parts.push(Part::plain(rest));
    }
    parts
}

/// The text of a step in the language `lang` ("en", "de-DE", "zh-Hans", ...).
pub fn step_text(kind: Kind, m: &Meta, lang: &str) -> Vec<Part> {
    let t = templates(lang);
    let mut name = match m.area {
        Area::Taskbar => clean_taskbar_name(&m.name),
        _ => clean_name(&m.name),
    };
    // A caption button is named in the language of the guide, whatever Windows or the app calls it.
    if let Some(c) = m.caption {
        name = match c {
            Caption::Minimize => t.cap_min,
            Caption::Maximize => t.cap_max,
            Caption::Restore => t.cap_restore,
            Caption::Close => t.cap_close,
        }
        .to_string();
    }
    let window = clean_name(&m.window);
    let page = clean_name(&m.page);
    let mut parts = match kind {
        Kind::Type => {
            let text = m.typed.as_str();
            if name.is_empty() {
                match m.surface {
                    Surface::Editor => render(t.type_editor, &[text]),
                    Surface::Field => render(t.type_textfield, &[text]),
                    Surface::None => render(t.type_plain, &[text]),
                }
            } else {
                render(t.type_in, &[text, &name])
            }
        }
        Kind::Key => render(t.press, &[&localize_keys(&m.keys, lang)]),
        Kind::RightClick => {
            if name.is_empty() {
                render(t.right_here, &[])
            } else {
                render(t.right, &[&name])
            }
        }
        Kind::DoubleClick => {
            if name.is_empty() {
                render(t.dbl_here, &[])
            } else {
                render(t.dbl, &[&name])
            }
        }
        Kind::Click => {
            if name.is_empty() && m.surface != Surface::None {
                render(
                    if m.surface == Surface::Editor {
                        t.click_editor
                    } else {
                        t.click_textfield
                    },
                    &[],
                )
            } else if name.is_empty() {
                if window.is_empty() {
                    render(t.click_here, &[])
                } else if !page.is_empty() && page != window {
                    // A web page whose elements have no names: the page (tab) title, then the app.
                    render(t.click_page, &[&page, &window])
                } else {
                    render(t.click_in, &[&window])
                }
            } else {
                match m.control.as_str() {
                    "MenuItem" => {
                        let mut path: Vec<String> = m
                            .menu_path
                            .iter()
                            .map(|p| clean_name(p))
                            .filter(|p| !p.is_empty())
                            .collect();
                        path.push(name.clone());
                        // The path is one bold part with the arrows between the names.
                        render(t.select, &[&path.join(" › ")])
                    }
                    "TabItem" => render(t.tab, &[&name]),
                    "CheckBox" => match m.toggle_before {
                        Some(true) => render(t.uncheck, &[&name]),
                        Some(false) => render(t.check, &[&name]),
                        None => render(t.click, &[&name]),
                    },
                    "RadioButton" | "ListItem" | "TreeItem" | "DataItem" => {
                        render(t.select, &[&name])
                    }
                    "Edit" | "ComboBox" | "Document" => render(t.field, &[&name]),
                    _ => render(t.click, &[&name]),
                }
            }
        }
    };
    // The shell says where it is ("in the taskbar"); the app of the shell (File Explorer) is not named.
    let suffix = match m.area {
        Area::Taskbar => Some(t.in_taskbar),
        Area::StartMenu => Some(t.in_start),
        Area::Tray => Some(t.in_tray),
        Area::Desktop => Some(t.on_desktop),
        Area::None => None,
    };
    if let (Some(sfx), true) = (suffix, kind != Kind::Key && kind != Kind::Type) {
        parts.push(Part::plain(sfx));
        return parts;
    }
    // The first step in a new window or app says where it happens.
    // (a click that named the page already said where it was)
    let page_used = kind == Kind::Click
        && name.is_empty()
        && m.surface == Surface::None
        && !window.is_empty()
        && !page.is_empty()
        && page != window;
    if m.new_window && !window.is_empty() && kind != Kind::Key && !page_used {
        let already = parts.iter().any(|p| p.b && p.t == window);
        if !already {
            parts.extend(render(t.in_app, &[&window]));
        }
    }
    parts
}

/// The step text as plain text (for "Copy all as text"): the parts joined.
pub fn plain(parts: &[Part]) -> String {
    parts.iter().map(|p| p.t.as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(control: &str, name: &str) -> Meta {
        Meta {
            control: control.into(),
            name: name.into(),
            window: "Notepad".into(),
            ..Default::default()
        }
    }

    fn bold(parts: &[Part]) -> Vec<&str> {
        parts.iter().filter(|p| p.b).map(|p| p.t.as_str()).collect()
    }

    #[test]
    fn english_texts_follow_the_control_type_and_bold_the_names() {
        let en = |k, m: &Meta| step_text(k, m, "en");
        let p = en(Kind::Click, &meta("Button", "Save"));
        assert_eq!(plain(&p), "Click Save");
        assert_eq!(bold(&p), ["Save"]);
        let mut m = meta("MenuItem", "Save as…");
        m.menu_path = vec!["File".into()];
        assert_eq!(plain(&en(Kind::Click, &m)), "Select File › Save as");
        assert_eq!(bold(&en(Kind::Click, &m)), ["File › Save as"]);
        assert_eq!(
            plain(&en(Kind::Click, &meta("TabItem", "Settings"))),
            "Open the Settings tab"
        );
        let mut c = meta("CheckBox", "Remember me");
        assert_eq!(plain(&en(Kind::Click, &c)), "Click Remember me");
        c.toggle_before = Some(false);
        assert_eq!(plain(&en(Kind::Click, &c)), "Check Remember me");
        c.toggle_before = Some(true);
        assert_eq!(plain(&en(Kind::Click, &c)), "Uncheck Remember me");
        assert_eq!(
            plain(&en(Kind::Click, &meta("ListItem", "Hamburg"))),
            "Select Hamburg"
        );
        assert_eq!(
            plain(&en(Kind::Click, &meta("Edit", "City"))),
            "Click the City field"
        );
        assert_eq!(
            plain(&en(Kind::RightClick, &meta("ListItem", "Report.docx"))),
            "Right-click Report.docx"
        );
        assert_eq!(
            plain(&en(Kind::DoubleClick, &meta("ListItem", "Report.docx"))),
            "Double-click Report.docx"
        );
        let mut t = meta("Edit", "City");
        t.typed = "Hamburg".into();
        let p = en(Kind::Type, &t);
        assert_eq!(plain(&p), "Type 'Hamburg' in City");
        assert_eq!(bold(&p), ["City"], "the typed text is not bold");
        let mut k = meta("", "");
        k.keys = "Ctrl+S".into();
        assert_eq!(plain(&en(Kind::Key, &k)), "Press Ctrl+S");
        assert_eq!(bold(&en(Kind::Key, &k)), ["Ctrl+S"]);
    }

    #[test]
    fn taskbar_buttons_are_named_by_the_app_and_the_step_says_where() {
        assert_eq!(
            clean_taskbar_name("Snipping Tool - 1 running window pinned"),
            "Snipping Tool"
        );
        assert_eq!(
            clean_taskbar_name("Google Chrome - 3 running windows"),
            "Google Chrome"
        );
        assert_eq!(clean_taskbar_name("File Explorer pinned"), "File Explorer");
        assert_eq!(
            clean_taskbar_name("Snipping Tool – 1 laufendes Fenster angeheftet"),
            "Snipping Tool"
        );
        assert_eq!(clean_taskbar_name("Notepad"), "Notepad");
        let m = Meta {
            control: "Button".into(),
            name: "Snipping Tool - 1 running window pinned".into(),
            window: "File Explorer".into(),
            new_window: true,
            area: Area::Taskbar,
            ..Default::default()
        };
        let p = step_text(Kind::Click, &m, "en");
        assert_eq!(plain(&p), "Click Snipping Tool in the taskbar");
        assert_eq!(bold(&p), ["Snipping Tool"]);
        assert_eq!(
            plain(&step_text(Kind::Click, &m, "de")),
            "Klicken Sie auf Snipping Tool in der Taskleiste"
        );
        let start = Meta {
            area: Area::StartMenu,
            name: "Settings".into(),
            control: "Button".into(),
            window: "Start".into(),
            new_window: true,
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::Click, &start, "en")),
            "Click Settings in the Start menu"
        );
        assert_eq!(
            plain(&step_text(Kind::Click, &start, "de")),
            "Klicken Sie auf Settings im Startmenü"
        );
        let tray = Meta {
            area: Area::Tray,
            name: "Volume".into(),
            control: "Button".into(),
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::Click, &tray, "en")),
            "Click Volume in the system tray"
        );
        let desk = Meta {
            area: Area::Desktop,
            name: "Recycle Bin".into(),
            control: "ListItem".into(),
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::DoubleClick, &desk, "en")),
            "Double-click Recycle Bin on the desktop"
        );
        assert_eq!(
            plain(&step_text(Kind::Click, &desk, "de")),
            "Wählen Sie Recycle Bin auf dem Desktop"
        );
    }

    #[test]
    fn caption_buttons_use_the_words_of_the_guide_language() {
        assert_eq!(
            caption_of("Button", "Maximize", "Maximise"),
            Some(Caption::Maximize)
        );
        assert_eq!(
            caption_of("Button", "", "Minimise"),
            Some(Caption::Minimize)
        );
        assert_eq!(caption_of("Button", "", "Schließen"), None);
        assert_eq!(caption_of("Edit", "Close", ""), None);
        let m = Meta {
            control: "Button".into(),
            name: "Maximise".into(),
            window: "Snipping Tool".into(),
            new_window: true,
            caption: Some(Caption::Maximize),
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::Click, &m, "en")),
            "Click Maximize in Snipping Tool"
        );
        assert_eq!(
            plain(&step_text(Kind::Click, &m, "de")),
            "Klicken Sie auf Maximieren in Snipping Tool"
        );
        let c = Meta {
            caption: Some(Caption::Close),
            ..m.clone()
        };
        assert_eq!(
            plain(&step_text(Kind::Click, &c, "de")),
            "Klicken Sie auf Schließen in Snipping Tool"
        );
    }

    #[test]
    fn a_web_page_without_element_names_falls_back_to_the_page_title() {
        let m = Meta {
            window: "Google Chrome".into(),
            page: "Inbox (3) - Mail".into(),
            ..Default::default()
        };
        let p = step_text(Kind::Click, &m, "en");
        assert_eq!(plain(&p), "Click in Inbox (3) - Mail (Google Chrome)");
        assert_eq!(bold(&p), ["Inbox (3) - Mail"]);
        assert_eq!(
            plain(&step_text(Kind::Click, &m, "de")),
            "Klicken Sie in Inbox (3) - Mail (Google Chrome)"
        );
        let none = Meta {
            window: "Google Chrome".into(),
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::Click, &none, "en")),
            "Click in Google Chrome"
        );
    }

    #[test]
    fn the_first_step_in_a_window_says_where_and_a_missing_name_has_a_fallback() {
        let mut m = meta("Button", "Save");
        m.new_window = true;
        let p = step_text(Kind::Click, &m, "en");
        assert_eq!(plain(&p), "Click Save in Notepad");
        assert_eq!(bold(&p), ["Save", "Notepad"]);
        assert_eq!(
            plain(&step_text(Kind::Click, &meta("Pane", ""), "en")),
            "Click in Notepad"
        );
        let nameless = Meta::default();
        assert_eq!(
            plain(&step_text(Kind::Click, &nameless, "en")),
            "Click here"
        );
        assert_eq!(
            plain(&step_text(Kind::RightClick, &nameless, "en")),
            "Right-click here"
        );
    }

    #[test]
    fn german_texts() {
        let de = |k, m: &Meta| plain(&step_text(k, m, "de-DE"));
        assert_eq!(
            de(Kind::Click, &meta("Button", "Speichern")),
            "Klicken Sie auf Speichern"
        );
        assert_eq!(
            de(Kind::DoubleClick, &meta("ListItem", "Bericht.docx")),
            "Doppelklicken Sie auf Bericht.docx"
        );
        assert_eq!(
            de(Kind::RightClick, &meta("ListItem", "Bericht.docx")),
            "Klicken Sie mit der rechten Maustaste auf Bericht.docx"
        );
        let mut mi = meta("MenuItem", "Speichern unter…");
        mi.menu_path = vec!["Datei".into()];
        assert_eq!(de(Kind::Click, &mi), "Wählen Sie Datei › Speichern unter");
        let mut t = meta("Edit", "Stadt");
        t.typed = "Hamburg".into();
        assert_eq!(de(Kind::Type, &t), "Geben Sie „Hamburg“ in Stadt ein");
        let mut m = meta("Button", "Speichern");
        m.new_window = true;
        assert_eq!(de(Kind::Click, &m), "Klicken Sie auf Speichern in Notepad");
        let k = Meta {
            keys: "Ctrl+S".into(),
            ..Default::default()
        };
        assert_eq!(de(Kind::Key, &k), "Drücken Sie Strg+S");
        // Key names: the local ones where they are standard, English elsewhere.
        assert_eq!(
            localize_keys("Ctrl+Shift+Delete", "de"),
            "Strg+Umschalt+Entf"
        );
        assert_eq!(localize_keys("Alt+Tab", "de-DE"), "Alt+Tab");
        assert_eq!(localize_keys("Ctrl+Page Down", "de"), "Strg+Bild↓");
        assert_eq!(localize_keys("Shift+Delete", "fr"), "Maj+Suppr");
        assert_eq!(localize_keys("Shift+Delete", "es"), "Mayús+Supr");
        assert_eq!(localize_keys("Shift+Delete", "it"), "Maiusc+Canc");
        assert_eq!(localize_keys("Shift+Delete", "nl"), "Shift+Delete");
        assert_eq!(localize_keys("Ctrl+S", "tr"), "Ctrl+S");
    }

    #[test]
    fn right_to_left_text_keeps_the_order_of_its_parts_and_bolds_the_name() {
        let p = step_text(Kind::Click, &meta("Button", "حفظ"), "ar");
        assert_eq!(p, vec![Part::plain("انقر على "), Part::bold("حفظ")]);
        let mut t = meta("Edit", "المدينة");
        t.typed = "جدة".into();
        let p = step_text(Kind::Type, &t, "ar");
        assert_eq!(plain(&p), "اكتب «جدة» في المدينة");
        assert_eq!(bold(&p), ["المدينة"]);
        // Every language has all the words (no empty template).
        for l in [
            "en", "de", "es", "fr", "it", "nl", "pl", "tr", "zh-Hans", "zh-Hant", "ar", "ur",
        ] {
            let p = step_text(Kind::Click, &meta("Button", "X"), l);
            assert!(plain(&p).contains('X'), "{l}");
            assert!(
                plain(&step_text(Kind::Click, &Meta::default(), l)).len() > 2,
                "{l}"
            );
        }
    }

    #[test]
    fn what_a_text_control_holds_is_never_its_name() {
        let held =
            "Name : Sam\r\nemail : k@qmail.com\r\npassword: 7741kqz558w\r\nIban: DE89 3704 0044";
        let content = vec![held.to_string()];
        // Notepad++: a Scintilla pane that gives its whole text as its name.
        assert_eq!(
            safe_name("Pane", "Scintilla", held, "", &content),
            (String::new(), Surface::Editor)
        );
        // Scintilla's name is its text even when nothing else says so.
        assert_eq!(
            safe_name("Pane", "Scintilla", "secret", "", &[]),
            (String::new(), Surface::Editor)
        );
        // An edit box named by its value; one with a label; one with a name of its own.
        let value = vec!["7741kqz558w".to_string()];
        assert_eq!(
            safe_name("Edit", "Edit", "7741kqz558w", "", &value),
            (String::new(), Surface::Field)
        );
        assert_eq!(
            safe_name("Edit", "Edit", "7741kqz558w", "Password", &value),
            ("Password".into(), Surface::Field)
        );
        assert_eq!(
            safe_name("Edit", "", "City", "", &["Hamburg".into()]),
            ("City".into(), Surface::Field)
        );
        // A browser textarea or contenteditable area whose name is the beginning of what was written.
        assert_eq!(
            safe_name(
                "Group",
                "",
                "Dear Ali, your code is",
                "",
                &["Dear Ali, your code is 4711".into()]
            ),
            (String::new(), Surface::Editor)
        );
        // A rich edit with the name of the app's editor.
        assert_eq!(
            safe_name("Document", "RichEditD2DPT", "Text editor", "", &content),
            ("Text editor".into(), Surface::Editor)
        );
        // A long text on a page is not a name; a button keeps its name.
        assert_eq!(
            safe_name("Text", "", &"word ".repeat(30), "", &[]),
            (String::new(), Surface::None)
        );
        assert_eq!(
            safe_name("Button", "", "Save", "", &[]),
            ("Save".into(), Surface::None)
        );
    }

    #[test]
    fn an_unnamed_text_control_is_called_the_editor_or_the_text_field() {
        let m = Meta {
            control: "Pane".into(),
            window: "Notepad++".into(),
            new_window: true,
            surface: Surface::Editor,
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::Click, &m, "en")),
            "Click in the editor in Notepad++"
        );
        let m = Meta {
            surface: Surface::Field,
            typed: "abc".into(),
            window: "App".into(),
            ..Default::default()
        };
        assert_eq!(
            plain(&step_text(Kind::Type, &m, "en")),
            "Type 'abc' in the text field"
        );
        assert_eq!(
            plain(&step_text(Kind::Click, &m, "de")),
            "Klicken Sie in das Textfeld"
        );
    }

    #[test]
    fn names_are_cleaned_and_raw_ids_are_never_shown() {
        assert_eq!(clean_name("  Save   as…  "), "Save as");
        assert_eq!(clean_name("City:"), "City");
        assert_eq!(clean_name("Name ..."), "Name");
        assert_eq!(clean_name("btnSave_1"), "");
        assert_eq!(clean_name("txt_City"), "");
        assert_eq!(clean_name("IDC_EDIT2"), "");
        assert_eq!(clean_name("Save"), "Save");
        assert_eq!(clean_name("Sparkasse Hamburg"), "Sparkasse Hamburg");
        let long = "x ".repeat(80);
        assert!(clean_name(&long).chars().count() <= 40);
        // An id as the name falls back to the window.
        assert_eq!(
            plain(&step_text(Kind::Click, &meta("Button", "btnSave_1"), "en")),
            "Click in Notepad"
        );
    }
}
