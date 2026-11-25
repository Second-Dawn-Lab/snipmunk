// Quick redact on the readings Windows really made of editor screenshots with smoothed (ClearType) type: pictures drawn by
// scripts/gen-editor-fixture.ps1 with made-up values. Lines were dropped, "IBAN:" came back as "IBM:" or "IRQ' :", digits as
// letters. `inks` are the answers of the backend for what follows each label.
import { describe, expect, it } from "vitest";
import { findMatches } from "../ocr/pii";
import { findGarbledIbans } from "../ocr/sensitive";
import { addAfterLabels, findInPicture, labelsIn, type Finding } from "./redact";
import shots from "./fixtures/editor-readings.json";
import thin from "./fixtures/thin-reading.json";
import type { Rect } from "./model";

const options = { email: true, phone: false, card: true, iban: true, secret: true, custom: null };

/** The lines of the fixture that hold a secret: their number (from 0), the label and the whole line. */
const SECRETS: [number, string][] = [
  [1, "email : k@example.com"],
  [2, "password: 8842kqzw771m"],
  [3, "Iban: DE89 3704 0044 0532 0130 00"],
  [4, "IBAN: DE89-1111-2222-3333-4444-55"],
  [6, "IBAN: DE89111122223333444455"],
  [8, "password : 47qrt$9191"],
];

/** Where line `i` of a picture stands, as the generator draws it (it rounds halves to even). */
function place(name: string, i: number, line: string) {
  const m = /^(cons|cour)-\d+x\d+-(\d+)-(\d+)pt/.exec(name);
  const [face, percent, points] = m ? [m[1], Number(m[2]), Number(m[3])] : ["cons", name.endsWith("100") ? 100 : 125, name.startsWith("dark") ? 11 : 10];
  const s = percent / 100;
  const px = (v: number) => {
    const x = v * s;
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  };
  const height = px(Math.ceil(((points * 96) / 72) * 1.22));
  const letter = Math.round(Math.round(((points * 96) / 72) * s) * (face === "cons" ? 0.55 : 0.6));
  const value = /^\w+\s*:\s*/.exec(line)![0].length;
  return { y: px(104) + px(1) + i * height + height / 2, x0: px(66) + value * letter, x1: px(66) + line.length * letter };
}

function covered(found: readonly Finding[], at: ReturnType<typeof place>): number {
  const width = found
    .filter((f) => f.rect![1] <= at.y && f.rect![1] + f.rect![3] >= at.y)
    .reduce((sum, f) => sum + Math.max(0, Math.min(at.x1, f.rect![0] + f.rect![2]) - Math.max(at.x0, f.rect![0])), 0);
  return width / (at.x1 - at.x0);
}

describe("quick redact on editor screenshots with smoothed type", () => {
  for (const shot of shots) {
    it(`covers every secret value on ${shot.name}`, () => {
      let found = findInPicture("b", shot, options);
      const labels = labelsIn(shot, options);
      expect(labels.map((l) => l.box)).toEqual(shot.labels);
      found = addAfterLabels("b", shot, found, labels, shot.inks as (Rect | null)[]);
      for (const [i, line] of SECRETS) expect(covered(found, place(shot.name, i, line)), `${shot.name}: ${line}`).toBeGreaterThan(0.85);
      // The ordinary lines stay readable.
      for (const i of [0, 10]) {
        const at = place(shot.name, i, i === 0 ? "Name : Test Person" : "end :");
        expect(found.filter((f) => f.rect![1] <= at.y && f.rect![1] + f.rect![3] >= at.y)).toEqual([]);
      }
    });
  }
});

// The thin Courier New of an editor at 100 %: "@" came back as "€", "DE89" as "DEB9", "5555" as "ssss" and a final "00" as
// "oo", so no check digits are right, and a colon read as a dot once kept a whole line from being covered.
describe("quick redact on thin typewriter type", () => {
  const lines = ["email : k@qmail.com", "password: 8842kqzw771m", "Iban: DE89 3704 0044 0532 0130 00", "IBAN: DE89-8888-1188-0888-2288-00", "IBAN: DE89888800008888555588", "IBAN: DE89888800008888555588"];
  const rows = [1, 2, 3, 4, 6, 8];
  const found = () => addAfterLabels("b", thin, findInPicture("b", thin, options), labelsIn(thin, options), thin.inks as (Rect | null)[]);

  it("covers every value from its first to its last letter, and nothing else", () => {
    expect(labelsIn(thin, options).map((l) => l.box)).toEqual(thin.labels);
    const marks = found();
    rows.forEach((row, i) => {
      const start = /^\w+\s*:\s*/.exec(lines[i])![0].length;
      const at = { y: 104 + row * 17 + 8, x0: 69 + start * 8, x1: 69 + lines[i].length * 8 };
      expect(covered(marks, at), lines[i]).toBeGreaterThan(0.97);
    });
    // The name above, the word below and the line numbers stay.
    for (const row of [0, 11]) expect(marks.filter((f) => f.rect![1] <= 104 + row * 17 + 8 && f.rect![1] + f.rect![3] >= 104 + row * 17 + 8)).toEqual([]);
    expect(marks.every((f) => f.rect![0] > 100)).toBe(true);
  });

  it("covers what follows a label also where a colon was read as a dot", () => {
    const word = (text: string, x: number) => ({ text, words: [{ text, x, y: 40, w: text.length * 8, h: 10 }] });
    const reading = { width: 600, height: 100, language: "de-DE", lines: [word("Iban:", 20), word("Iban", 20), word("•", 58), word("DESE", 80), word("OO", 160)] };
    const labels = labelsIn(reading, options);
    const marks = addAfterLabels("b", reading, [], labels.slice(0, 1), [[70, 40, 108, 10]]);
    expect(marks.map((f) => [f.kind, f.rect])).toEqual([["iban", [68, 38, 112, 14]]]);
    // A row of dots is something that is hidden already.
    const hidden = { ...reading, lines: [word("Iban:", 20), word("••••••", 80)] };
    expect(addAfterLabels("b", hidden, [], labelsIn(hidden, options), [[80, 40, 48, 10]])).toEqual([]);
  });

  it("finds the address and the numbers as they were read", () => {
    expect(findMatches("k@qma±i.com", options).map((m) => m.text)).toEqual(["k@qma±i.com"]);
    expect(findMatches("email : k€qmail . com", options).map((m) => m.text)).toEqual(["k€qmail . com"]);
    expect(findMatches("IBAN : DES9-1111-2222-3333-4444-OO", options).map((m) => m.text)).toEqual(["DES9-1111-2222-3333-4444-OO"]);
    expect(findMatches("IBAN: DESE 1111 2222 3333 4444 55", options).map((m) => m.text)).toEqual(["DESE 1111 2222 3333 4444 55"]);
    expect(findGarbledIbans("DES9111122223333444455").map((m) => m.text)).toEqual(["DES9111122223333444455"]);
    expect(findGarbledIbans("ESSEN 4512 8896 1234 5678")).toEqual([]);
  });
});
