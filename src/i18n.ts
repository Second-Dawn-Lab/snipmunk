import { useI18n } from "@seconddawn/i18n";
import { formatMessage, type Vars } from "./message";
import { ar } from "./locales/ar";
import { de } from "./locales/de";
import { en, type Key } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { nl } from "./locales/nl";
import { pl } from "./locales/pl";
import { tr } from "./locales/tr";
import { ur } from "./locales/ur";
import { zhHans } from "./locales/zh-Hans";
import { zhHant } from "./locales/zh-Hant";
import type { LocaleCode } from "./language";

export const dictionaries: Record<LocaleCode, Record<Key, string>> = {
  en,
  de,
  es,
  fr,
  it,
  nl,
  pl,
  tr,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ar,
  ur,
};

/** Typed `t`: only keys that exist in the English dictionary compile. Handles {placeholders} and plurals. */
export function useT() {
  const { t: raw, locale } = useI18n();
  // Called without variables the core translator returns the template itself.
  const t = (key: Key, vars?: Vars) => formatMessage(raw(key), vars, locale);
  return { t, locale };
}
