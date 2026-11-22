import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";
import type { Key } from "../locales/en";
import { fold, INDEX, searchSettings, TABS } from "./model";

const tIn = (locale: keyof typeof dictionaries) => (key: Key) => dictionaries[locale][key];

describe("the settings index", () => {
  it("has unique ids and every entry on a known page, with text in every language", () => {
    expect(new Set(INDEX.map((e) => e.id)).size).toBe(INDEX.length);
    const tabs = new Set(TABS.map((t) => t.id));
    for (const e of INDEX) {
      expect(tabs.has(e.tab), e.id).toBe(true);
      for (const code of Object.keys(dictionaries) as (keyof typeof dictionaries)[]) {
        expect(tIn(code)(e.title).length, `${e.id} ${code}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("searchSettings", () => {
  const en = tIn("en");

  it("finds nothing for an empty query", () => {
    expect(searchSettings("", en, "en")).toEqual([]);
    expect(searchSettings("   ", en, "en")).toEqual([]);
  });

  it("finds settings by title and groups them by page", () => {
    const found = searchSettings("capture", en, "en");
    expect(found.map((g) => g.tab)).toEqual(["screenshots", "documents", "sessions", "ocr"]);
    const ids = found.flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).toContain("captureHotkey");
    expect(ids).toContain("autoCopy");
  });

  it("also looks in the description", () => {
    const found = searchSettings("ctrl+v", en, "en").flatMap((g) => g.entries.map((e) => e.id));
    expect(found).toEqual(["autoCopy"]);
  });

  it("needs every word, in any order", () => {
    expect(searchSettings("clipboard copy", en, "en").flatMap((g) => g.entries.map((e) => e.id))).toEqual(["autoCopy"]);
    expect(searchSettings("copy zebra", en, "en")).toEqual([]);
  });

  it("is case and accent insensitive", () => {
    expect(fold("Über Ayarlar", "tr")).toBe("uber ayarlar");
    expect(searchSettings("LUPE", tIn("de"), "de").flatMap((g) => g.entries.map((e) => e.id))).toContain("magnifier");
    expect(searchSettings("lupe", tIn("de"), "de").length).toBeGreaterThan(0);
  });

  it("searches in the active language, not in English", () => {
    expect(searchSettings("Zwischenablage", tIn("de"), "de").flatMap((g) => g.entries.map((e) => e.id))).toContain("autoCopy");
    expect(searchSettings("Zwischenablage", en, "en")).toEqual([]);
  });

  it("works for scripts without letter case", () => {
    expect(searchSettings("放大镜", tIn("zh-Hans"), "zh-Hans").flatMap((g) => g.entries.map((e) => e.id))).toEqual(["magnifier"]);
    expect(searchSettings("اللغة", tIn("ar"), "ar").flatMap((g) => g.entries.map((e) => e.id))).toContain("language");
  });
});
