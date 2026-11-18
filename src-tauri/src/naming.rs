//! What a new capture is called: the title of the window it shows, cleaned up, else "Screenshot 10:42".

/// A word for "screenshot" in each interface language, for the fallback name.
pub fn screenshot_word(lang: &str) -> &'static str {
    match crate::language::resolve(lang) {
        "de" => "Screenshot",
        "es" => "Captura",
        "fr" => "Capture",
        "it" => "Cattura",
        "nl" => "Schermafbeelding",
        "pl" => "Zrzut",
        "tr" => "Ekran görüntüsü",
        "zh-Hans" => "截图",
        "zh-Hant" => "擷取",
        "ar" => "لقطة",
        "ur" => "کیپچر",
        _ => "Screenshot",
    }
}

/// "Screenshot 10:42"
pub fn fallback_name(lang: &str, hour: u32, minute: u32) -> String {
    format!("{} {:02}:{:02}", screenshot_word(lang), hour, minute)
}

/// Strip a trailing application name such as " - Google Chrome" or " — Mozilla Firefox", but only in the simple case: a
/// short last part after the last separator and a real title before it. Anything else is kept whole. `None` when the
/// title is empty.
pub fn clean_title(title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    for sep in [" - ", " \u{2014} ", " \u{2013} ", " | "] {
        if let Some(at) = title.rfind(sep) {
            let (head, tail) = (title[..at].trim(), title[at + sep.len()..].trim());
            let words = tail.split_whitespace().count();
            if head.chars().count() >= 3
                && !tail.is_empty()
                && tail.chars().count() <= 28
                && words <= 3
            {
                return Some(head.to_string());
            }
        }
    }
    Some(title.chars().take(80).collect())
}

/// Pick the name of a capture: the cleaned window title, or the fallback.
pub fn capture_name(title: Option<&str>, lang: &str, hour: u32, minute: u32) -> String {
    title
        .and_then(clean_title)
        .unwrap_or_else(|| fallback_name(lang, hour, minute))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_application_suffixes_are_stripped() {
        assert_eq!(
            clean_title("Inbox (3) - Google Chrome").as_deref(),
            Some("Inbox (3)")
        );
        assert_eq!(
            clean_title("Report.docx - Word").as_deref(),
            Some("Report.docx")
        );
        assert_eq!(
            clean_title("Page \u{2014} Mozilla Firefox").as_deref(),
            Some("Page")
        );
        assert_eq!(
            clean_title("Untitled | Notepad").as_deref(),
            Some("Untitled")
        );
    }

    #[test]
    fn only_the_last_part_is_stripped() {
        assert_eq!(
            clean_title("a - b - Microsoft Edge").as_deref(),
            Some("a - b")
        );
    }

    #[test]
    fn a_title_that_is_not_simple_stays_whole() {
        assert_eq!(clean_title("Notepad").as_deref(), Some("Notepad"));
        // The tail is too long to be an application name.
        let long = "Release notes - a very long description of the page content that is not an app";
        assert_eq!(clean_title(long).as_deref(), Some(long));
        // Too little is left before the separator.
        assert_eq!(clean_title("A - Chrome").as_deref(), Some("A - Chrome"));
    }

    #[test]
    fn empty_titles_give_nothing_and_long_ones_are_shortened() {
        assert_eq!(clean_title("   "), None);
        assert_eq!(
            clean_title(&"x".repeat(200)).map(|s| s.chars().count()),
            Some(80)
        );
    }

    #[test]
    fn the_fallback_name_has_the_time_and_follows_the_language() {
        assert_eq!(fallback_name("en", 10, 42), "Screenshot 10:42");
        assert_eq!(fallback_name("de", 9, 5), "Screenshot 09:05");
        assert_eq!(fallback_name("es", 9, 5), "Captura 09:05");
        assert_eq!(capture_name(None, "en", 10, 42), "Screenshot 10:42");
        assert_eq!(capture_name(Some("  "), "en", 10, 42), "Screenshot 10:42");
        assert_eq!(capture_name(Some("Notes - Notepad"), "en", 10, 42), "Notes");
    }
}
