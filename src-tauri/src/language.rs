//! Which interface language to use: the setting, or the system's when the setting is "system".
//! Only the tray menu is translated in Rust; the web page does the same mapping in `src/i18n.ts`.

use crate::settings::LANGUAGES;

/// Map a language tag ("de-AT", "zh-TW", "zh_CN", "pt-BR") to one of the supported languages; English when
/// there is none. Chinese is split by script: zh-TW, zh-HK, zh-MO and zh-Hant are traditional, everything
/// else (zh, zh-CN, zh-SG, zh-Hans) is simplified.
pub fn from_tag(tag: &str) -> &'static str {
    let lower = tag.trim().to_ascii_lowercase().replace('_', "-");
    let parts: Vec<&str> = lower.split('-').collect();
    let base = parts.first().copied().unwrap_or("");
    if base == "zh" {
        let traditional = parts
            .iter()
            .skip(1)
            .any(|p| matches!(*p, "hant" | "tw" | "hk" | "mo"));
        return if traditional { "zh-Hant" } else { "zh-Hans" };
    }
    LANGUAGES
        .iter()
        .find(|l| l.eq_ignore_ascii_case(base))
        .copied()
        .unwrap_or("en")
}

/// The Windows display language, such as "de-DE" (empty when it cannot be read).
#[cfg(windows)]
fn system_tag() -> String {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    let mut buf = [0u16; 85];
    let n = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if n > 1 {
        String::from_utf16_lossy(&buf[..(n as usize - 1)])
    } else {
        String::new()
    }
}

#[cfg(not(windows))]
fn system_tag() -> String {
    std::env::var("LANG").unwrap_or_default()
}

/// The language to show for a language setting ("system" or a supported tag).
pub fn resolve(pref: &str) -> &'static str {
    if pref == "system" {
        from_tag(&system_tag())
    } else {
        from_tag(pref)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_and_regional_tags_map_to_their_language() {
        assert_eq!(from_tag("de"), "de");
        assert_eq!(from_tag("de-AT"), "de");
        assert_eq!(from_tag("pt-BR"), "en", "not supported: English");
        assert_eq!(from_tag("AR-EG"), "ar");
        assert_eq!(from_tag("ur_PK"), "ur");
        assert_eq!(from_tag(""), "en");
    }

    #[test]
    fn chinese_is_split_by_script() {
        for t in ["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "zh_CN"] {
            assert_eq!(from_tag(t), "zh-Hans", "{t}");
        }
        for t in ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-TW"] {
            assert_eq!(from_tag(t), "zh-Hant", "{t}");
        }
    }

    #[test]
    fn a_chosen_language_wins_over_the_system() {
        assert_eq!(resolve("fr"), "fr");
        assert_eq!(resolve("zh-Hant"), "zh-Hant");
    }
}
