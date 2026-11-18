import { describe, expect, it } from "vitest";
import { directionOf, LANGUAGES, localeFromTag, resolveLocale } from "./language";

describe("language", () => {
  it("lists twelve languages, each in its own name", () => {
    expect(LANGUAGES).toHaveLength(12);
    expect(LANGUAGES.find((l) => l.code === "ar")?.name).toBe("العربية");
  });

  it("maps system tags", () => {
    expect(localeFromTag("de-AT")).toBe("de");
    expect(localeFromTag("pt-BR")).toBe("en");
    expect(localeFromTag("en-US")).toBe("en");
    for (const t of ["zh-CN", "zh-SG", "zh", "zh-Hans"]) expect(localeFromTag(t)).toBe("zh-Hans");
    for (const t of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant"]) expect(localeFromTag(t)).toBe("zh-Hant");
  });

  it("follows the system only when asked", () => {
    expect(resolveLocale("system", "fr-CA")).toBe("fr");
    expect(resolveLocale("tr", "fr-CA")).toBe("tr");
    expect(resolveLocale("zh-Hant", "de")).toBe("zh-Hant");
  });

  it("takes the direction from the locale list", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("ur")).toBe("rtl");
    expect(directionOf("fa")).toBe("rtl");
    expect(directionOf("he-IL")).toBe("rtl");
    expect(directionOf("de")).toBe("ltr");
    expect(directionOf("zh-Hans")).toBe("ltr");
  });
});
