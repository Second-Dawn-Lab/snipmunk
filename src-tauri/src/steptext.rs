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
}

/// A name for people: trimmed, spaces collapsed, no trailing ":" "…" "...", at most 60 characters; "" for a raw id.
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
    if s.chars().count() > 60 {
        s = s
            .chars()
            .take(59)
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
}

fn templates(lang: &str) -> T {
    match lang.split('-').next().unwrap_or("en") {
        "de" => T {
            click: "Klicke auf {b0}",
            click_here: "Klicke hier",
            click_in: "Klicke in {b0}",
            right: "Klicke mit rechts auf {b0}",
            right_here: "Klicke hier mit rechts",
            dbl: "Doppelklicke auf {b0}",
            dbl_here: "Doppelklicke hier",
            select: "Wähle {b0}",
            tab: "Öffne den Tab {b0}",
            check: "Aktiviere {b0}",
            uncheck: "Deaktiviere {b0}",
            field: "Klicke in das Feld {b0}",
            type_in: "Gib „{p0}“ in {b1} ein",
            type_plain: "Gib „{p0}“ ein",
            press: "Drücke {b0}",
            in_app: " in {b0}",
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
        },
    }
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
    let name = clean_name(&m.name);
    let window = clean_name(&m.window);
    let mut parts = match kind {
        Kind::Type => {
            let text = m.typed.as_str();
            if name.is_empty() {
                render(t.type_plain, &[text])
            } else {
                render(t.type_in, &[text, &name])
            }
        }
        Kind::Key => render(t.press, &[&m.keys]),
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
            if name.is_empty() {
                if window.is_empty() {
                    render(t.click_here, &[])
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
    // The first step in a new window or app says where it happens.
    if m.new_window && !window.is_empty() && kind != Kind::Key {
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
            "Klicke auf Speichern"
        );
        assert_eq!(
            de(Kind::DoubleClick, &meta("ListItem", "Bericht.docx")),
            "Doppelklicke auf Bericht.docx"
        );
        let mut t = meta("Edit", "Stadt");
        t.typed = "Hamburg".into();
        assert_eq!(de(Kind::Type, &t), "Gib „Hamburg“ in Stadt ein");
        let mut m = meta("Button", "Speichern");
        m.new_window = true;
        assert_eq!(de(Kind::Click, &m), "Klicke auf Speichern in Notepad");
        let k = Meta {
            keys: "Strg+S".into(),
            ..Default::default()
        };
        assert_eq!(de(Kind::Key, &k), "Drücke Strg+S");
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
        assert!(clean_name(&long).chars().count() <= 60);
        // An id as the name falls back to the window.
        assert_eq!(
            plain(&step_text(Kind::Click, &meta("Button", "btnSave_1"), "en")),
            "Click in Notepad"
        );
    }
}
