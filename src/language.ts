// The interface languages: their names, the system-language mapping and the writing direction.
// The Rust twin of the mapping is src-tauri/src/language.rs (used for the tray menu).

/** Each language written in itself, in the order of the language list. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "zh-Hant", name: "繁體中文" },
  { code: "ar", name: "العربية" },
  { code: "ur", name: "اردو" },
] as const;

export type LocaleCode = (typeof LANGUAGES)[number]["code"];
export const LOCALE_CODES: LocaleCode[] = LANGUAGES.map((l) => l.code);

/** Languages written right to left. Persian and Hebrew are ready for when they get a translation. */
export const RTL_LOCALES = ["ar", "ur", "fa", "he"];

/** "rtl" or "ltr" for a locale (by its language part, so "ar-EG" and "ur" both work). */
export function directionOf(locale: string): "rtl" | "ltr" {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return RTL_LOCALES.includes(base) ? "rtl" : "ltr";
}

/**
 * Map a language tag to a supported locale. Chinese is split by script: zh-TW, zh-HK, zh-MO and zh-Hant are
 * traditional; zh, zh-CN, zh-SG and zh-Hans are simplified. Anything unsupported becomes English.
 */
export function localeFromTag(tag: string): LocaleCode {
  const parts = tag.trim().toLowerCase().replace(/_/g, "-").split("-");
  const base = parts[0];
  if (base === "zh") {
    return parts.slice(1).some((p) => ["hant", "tw", "hk", "mo"].includes(p)) ? "zh-Hant" : "zh-Hans";
  }
  return LOCALE_CODES.find((c) => c.toLowerCase() === base) ?? "en";
}

/** The locale for the language setting: "system" follows the OS, anything else is a tag. */
export function resolveLocale(preference: string, systemTag?: string): LocaleCode {
  if (preference === "system") {
    const tag = systemTag ?? (typeof navigator === "undefined" ? "en" : navigator.language);
    return localeFromTag(tag);
  }
  return localeFromTag(preference);
}
