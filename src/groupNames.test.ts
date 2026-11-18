import { describe, expect, it } from "vitest";
import { defaultGroupNumber, digitsToNumber, lowestFreeNumber, nextGroupName } from "./groupNames";
import { dictionaries } from "./i18n";
import { LOCALE_CODES } from "./language";

const en = ["Group {number}"];
const all = LOCALE_CODES.map((c) => (dictionaries[c] as Record<string, string>)["groups.defaultName"]);

describe("digits", () => {
  it("are read in Latin, Arabic-Indic and Persian form", () => {
    expect(digitsToNumber("12")).toBe(12);
    expect(digitsToNumber("١٢")).toBe(12);
    expect(digitsToNumber("۱۲")).toBe(12);
    expect(digitsToNumber("1a")).toBeNull();
    expect(digitsToNumber("")).toBeNull();
  });
});

describe("default group names", () => {
  it("are recognised with their number", () => {
    expect(defaultGroupNumber("Group 3", en)).toBe(3);
    expect(defaultGroupNumber("Gruppe 3", ["Gruppe {number}"])).toBe(3);
    expect(defaultGroupNumber("المجموعة ٣", ["المجموعة {number}"])).toBe(3);
  });

  it("are not names that merely look similar", () => {
    for (const name of ["Group", "Group ", "Group 0", "Group 01", "group 2", "Group 2 old", "My Group 2", "Group 2.5", "Gruppe 2"]) {
      expect(defaultGroupNumber(name, en), name).toBeNull();
    }
  });

  it("are recognised in every language, whatever the interface language is", () => {
    for (const template of all) {
      expect(defaultGroupNumber(template.replace("{number}", "4"), all), template).toBe(4);
    }
  });

  it("are not confused by punctuation in a template", () => {
    expect(defaultGroupNumber("(a+b) 2", ["(a+b) {number}"])).toBe(2);
    expect(defaultGroupNumber("xa+b 2", ["(a+b) {number}"])).toBeNull();
  });
});

describe("the number of a new group", () => {
  it("is the lowest free one", () => {
    expect(lowestFreeNumber([], en)).toBe(1);
    expect(lowestFreeNumber(["Group 1"], en)).toBe(2);
    expect(lowestFreeNumber(["Group 1", "Group 3"], en)).toBe(2);
    expect(lowestFreeNumber(["Group 2", "Group 3"], en)).toBe(1);
    expect(lowestFreeNumber(["Group 1", "Group 2", "Group 3"], en)).toBe(4);
  });

  it("ignores renamed groups", () => {
    expect(lowestFreeNumber(["Bug report", "Group 1 (old)", "Docs"], en)).toBe(1);
    expect(lowestFreeNumber(["Group 1", "Notes 2"], en)).toBe(2);
  });

  it("counts groups made in another language", () => {
    expect(lowestFreeNumber(["Gruppe 1", "Group 2"], ["Group {number}", "Gruppe {number}"])).toBe(3);
  });
});

describe("a new group's name", () => {
  it("is Group 2 when Group 1 exists, and Group 2 again when Group 1 and 3 exist", () => {
    expect(nextGroupName(["Group 1"], "Group {number}", "en", all)).toBe("Group 2");
    expect(nextGroupName(["Group 1", "Group 3"], "Group {number}", "en", all)).toBe("Group 2");
  });

  it("is in the language of the interface", () => {
    expect(nextGroupName(["Gruppe 1"], "Gruppe {number}", "de", all)).toBe("Gruppe 2");
  });

  it("uses the digits of the language", () => {
    const ar = nextGroupName(["المجموعة ١"], "المجموعة {number}", "ar", all);
    expect(ar.startsWith("المجموعة ")).toBe(true);
    expect(digitsToNumber(ar.split(" ").pop() as string)).toBe(2);
  });

  it("has a default name template in every language, with the number placeholder", () => {
    expect(all).toHaveLength(12);
    for (const t of all) expect(t).toContain("{number}");
  });
});
