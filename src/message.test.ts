import { describe, expect, it } from "vitest";
import { formatMessage, localeCategories } from "./message";

const en = "{count, plural, one {# capture} other {# captures}} left";

describe("formatMessage", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(formatMessage("Hi {name}, {x}", { name: "Ann" }, "en")).toBe("Hi Ann, {x}");
    expect(formatMessage("plain", undefined, "en")).toBe("plain");
  });

  it("picks the English forms", () => {
    expect(formatMessage(en, { count: 1 }, "en")).toBe("1 capture left");
    expect(formatMessage(en, { count: 0 }, "en")).toBe("0 captures left");
    expect(formatMessage(en, { count: 3 }, "en")).toBe("3 captures left");
  });

  it("uses all six Arabic forms", () => {
    const ar = "{n, plural, zero {Z} one {O} two {T} few {# F} many {# M} other {# X}}";
    const pick = (n: number) => formatMessage(ar, { n }, "ar");
    expect(pick(0)).toBe("Z");
    expect(pick(1)).toBe("O");
    expect(pick(2)).toBe("T");
    expect(pick(3)).toBe("3 F");
    expect(pick(11)).toBe("11 M");
    expect(pick(100)).toBe("100 X");
  });

  it("uses the Polish forms one, few, many and other", () => {
    const pl = "{n, plural, one {# a} few {# b} many {# c} other {# d}}";
    const pick = (n: number) => formatMessage(pl, { n }, "pl");
    expect(pick(1)).toBe("1 a");
    expect(pick(3)).toBe("3 b");
    expect(pick(5)).toBe("5 c");
    expect(pick(22)).toBe("22 b");
    expect(pick(12)).toBe("12 c");
    expect(pick(1.5)).toBe("1.5 d");
  });

  it("falls back to other when a language lacks a category", () => {
    expect(formatMessage("{n, plural, other {# x}}", { n: 1 }, "zh-Hans")).toBe("1 x");
    // French has a 'many' category (millions) that translators may leave out.
    expect(formatMessage("{n, plural, one {# a} other {# b}}", { n: 1_000_000 }, "fr")).toBe(
      "1000000 b",
    );
  });

  it("allows placeholders inside a form", () => {
    const t = "{count, plural, one {{name} has # item} other {{name} has # items}}";
    expect(formatMessage(t, { count: 2, name: "Ann" }, "en")).toBe("Ann has 2 items");
  });
});

describe("localeCategories", () => {
  it("lists the categories of a language", () => {
    expect(localeCategories("en")).toEqual(["one", "other"]);
    expect(localeCategories("ar")).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(localeCategories("pl")).toEqual(["one", "few", "many", "other"]);
    expect(localeCategories("zh-Hans")).toEqual(["other"]);
  });
});
