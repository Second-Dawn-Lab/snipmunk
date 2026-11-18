import { describe, expect, it } from "vitest";
import { LOCALE_CODES } from "../language";
import { localeCategories, pluralCategories } from "../message";
import { dictionaries } from "../i18n";
import { en } from "./en";

const placeholders = (s: string) =>
  [...new Set([...s.matchAll(/\{(\w+)(?:,\s*plural)?[,}]/g)].map((m) => m[1]))].sort();
const enKeys = Object.keys(en).sort();

describe("locales", () => {
  it("there are twelve, and each is registered", () => {
    expect(LOCALE_CODES).toHaveLength(12);
    expect(Object.keys(dictionaries).sort()).toEqual([...LOCALE_CODES].sort());
  });

  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    const dict = dictionaries[code] as Record<string, string>;

    describe(code, () => {
      it("has exactly the English keys", () => {
        expect(Object.keys(dict).sort()).toEqual(enKeys);
      });

      it("uses the same placeholders as English", () => {
        for (const key of enKeys) {
          expect(placeholders(dict[key]), key).toEqual(placeholders((en as Record<string, string>)[key]));
        }
      });

      it("has no empty strings", () => {
        for (const [key, value] of Object.entries(dict)) {
          expect(value.trim().length, key).toBeGreaterThan(0);
        }
      });

      it("spells out every plural form the language needs", () => {
        // French, Spanish and Italian also have a 'many' category (millions), which falls back to 'other'.
        const optional = ["fr", "es", "it"].includes(code) ? ["many"] : [];
        const needed = localeCategories(code).filter((c) => !optional.includes(c));
        for (const key of enKeys) {
          for (const forms of pluralCategories(dict[key])) {
            expect(forms, `${key} (${code})`).toEqual(expect.arrayContaining(needed));
            expect(forms, `${key} (${code})`).toContain("other");
          }
        }
      });

      it("has plurals exactly where English has them", () => {
        for (const key of enKeys) {
          const n = pluralCategories((en as Record<string, string>)[key]).length;
          expect(pluralCategories(dict[key]).length, key).toBe(n);
        }
      });
    });
  }

  it("English plurals have one and other", () => {
    for (const key of enKeys) {
      for (const forms of pluralCategories((en as Record<string, string>)[key])) {
        expect(forms.sort(), key).toEqual(["one", "other"]);
      }
    }
  });
});
