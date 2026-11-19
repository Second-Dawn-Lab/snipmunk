import { describe, expect, it } from "vitest";
import { emptyDoc, type Annotation } from "../annotate/schema";
import { docGeometry } from "../annotate/transform";
import { apply } from "../annotate/transform";
import { toStage } from "../annotate/view";
import { fitScale, fontSizeFor, selectedNumbers, selectionText, stageRect, wordAt } from "./layer";
import { buildDocument, isEmpty, isRtlLine, joinWords, textOfWords } from "./layout";
import { docKey, ocrKey } from "./key";
import { detectTable, toHtml, toTsv } from "./table";
import { findEmails, findMatches, findPhones, isPhone } from "./pii";
import { matchRect, quickRects, redactionsFor, wordSlice } from "./quickRedact";
import type { OcrResult, RawLine } from "./types";

const word = (text: string, x: number, y: number, w = text.length * 10, h = 20) => ({ text, x, y, w, h });
/** A line of words laid out left to right from (x, y), 10 px per character, 6 px between words. */
function row(text: string, x: number, y: number, rtl = false): RawLine {
  const parts = text.split(" ");
  const words = [];
  let cx = x;
  for (const p of parts) {
    words.push(word(p, cx, y, [...p].length * 10));
    cx += [...p].length * 10 + 6;
  }
  void rtl;
  return { text, words };
}
const result = (lines: RawLine[]): Pick<OcrResult, "lines" | "width" | "height" | "language"> => ({ lines, width: 800, height: 600, language: "en-GB" });

describe("reading order", () => {
  it("reads lines from the top, whatever order the engine gave them", () => {
    const doc = buildDocument(result([row("third", 10, 70), row("first", 10, 10), row("second", 10, 40)]));
    expect(doc.lines.map((l) => l.text)).toEqual(["first", "second", "third"]);
    expect(doc.text).toBe("first\nsecond\nthird");
  });

  it("reads lines on the same row from left to right", () => {
    const doc = buildDocument(result([row("right", 300, 10), row("left", 10, 12)]));
    expect(doc.lines.map((l) => l.text)).toEqual(["left", "right"]);
  });

  it("numbers the words in reading order, over the whole text", () => {
    const doc = buildDocument(result([row("b c", 10, 50), row("a", 10, 10)]));
    expect(doc.words.map((w) => [w.n, w.text])).toEqual([[0, "a"], [1, "b"], [2, "c"]]);
    expect(doc.words.map((w) => w.line)).toEqual([0, 1, 1]);
  });

  it("puts a gap of more than a line between paragraphs", () => {
    const doc = buildDocument(result([row("one", 10, 10), row("two", 10, 36), row("three", 10, 120)]));
    expect(doc.lines.map((l) => l.paragraphBefore)).toEqual([false, false, true]);
    expect(doc.text).toBe("one\ntwo\n\nthree");
  });

  it("sorts the words of a line by position", () => {
    const l: RawLine = { text: "a b c", words: [word("c", 100, 10), word("a", 10, 10), word("b", 50, 10)] };
    expect(buildDocument(result([l])).lines[0].text).toBe("a b c");
  });

  it("ignores empty words and empty lines", () => {
    const l: RawLine = { text: " ", words: [word(" ", 10, 10), { text: "x", x: 0, y: 0, w: 0, h: 0 }] };
    expect(buildDocument(result([l, row("ok", 10, 50)])).lines).toHaveLength(1);
    expect(isEmpty(buildDocument(result([])))).toBe(true);
    expect(isEmpty(null)).toBe(true);
  });
});

describe("right-to-left lines", () => {
  const arabic: RawLine = { text: "مرحبا بالعالم", words: [word("مرحبا", 200, 10, 60), word("بالعالم", 100, 10, 70)] };

  it("knows right-to-left text by its letters", () => {
    expect(isRtlLine("مرحبا بالعالم")).toBe(true);
    expect(isRtlLine("שלום עולם")).toBe(true);
    expect(isRtlLine("Hello")).toBe(false);
    expect(isRtlLine("Hello مرحبا")).toBe(false);
    expect(isRtlLine("123")).toBe(false);
  });

  it("reads the words from the right", () => {
    const doc = buildDocument(result([arabic]));
    expect(doc.lines[0].rtl).toBe(true);
    expect(doc.lines[0].words.map((w) => w.text)).toEqual(["مرحبا", "بالعالم"]);
    expect(doc.lines[0].text).toBe("مرحبا بالعالم");
  });

  it("reads right-to-left lines on one row from the right", () => {
    const left: RawLine = { text: "ثاني", words: [word("ثاني", 10, 12, 40)] };
    const right: RawLine = { text: "أول", words: [word("أول", 400, 10, 30)] };
    expect(buildDocument(result([left, right])).lines.map((l) => l.text)).toEqual(["أول", "ثاني"]);
  });
});

describe("CJK lines", () => {
  const chinese: RawLine = { text: "你好世界", words: [word("世", 130, 10, 20), word("你", 70, 10, 20), word("界", 150, 10, 20), word("好", 90, 10, 20)] };

  it("joins characters without spaces, in position order", () => {
    expect(buildDocument(result([chinese])).lines[0].text).toBe("你好世界");
    expect(joinWords([{ text: "你" }, { text: "好" }])).toEqual({ text: "你好", offsets: [0, 1] });
  });

  it("keeps a space between a Latin word and CJK text, and between Latin words", () => {
    expect(joinWords([{ text: "Hello" }, { text: "你好" }]).text).toBe("Hello 你好");
    expect(joinWords([{ text: "a" }, { text: "b" }]).text).toBe("a b");
  });

  it("gives the offsets of every word", () => {
    expect(joinWords([{ text: "ab" }, { text: "c" }, { text: "def" }]).offsets).toEqual([0, 3, 5]);
  });
});

describe("the text of a range of words", () => {
  const doc = buildDocument(result([row("one two", 10, 10), row("three four", 10, 36), row("five", 10, 120)]));
  it("reads across lines in reading order", () => {
    expect(textOfWords(doc, 1, 3)).toBe("two\nthree four");
  });
  it("is the same whichever end the selection started at", () => {
    expect(textOfWords(doc, 3, 0)).toBe(textOfWords(doc, 0, 3));
  });
  it("keeps the paragraph gap", () => {
    expect(textOfWords(doc, 2, 4)).toBe("three four\n\nfive");
  });
  it("is one word for one number", () => {
    expect(textOfWords(doc, 2, 2)).toBe("three");
  });
});

describe("the key of a recognized text", () => {
  const base = { ...emptyDoc() };
  it("is plain for a picture without edits, like the one the backend makes", () => {
    expect(docKey(base)).toBe("plain");
    expect(ocrKey(base, "auto")).toBe("plain|auto");
  });
  it("changes with crop, rotation, flip, redactions and the languages", () => {
    const keys = new Set([
      ocrKey(base, "auto"),
      ocrKey({ ...base, crop: { x: 1, y: 2, w: 30, h: 40 } }, "auto"),
      ocrKey({ ...base, rotation: 90 }, "auto"),
      ocrKey({ ...base, flipH: true }, "auto"),
      ocrKey({ ...base, flipV: true }, "auto"),
      ocrKey({ ...base, items: [{ type: "redact", id: "r", x: 1, y: 1, w: 5, h: 5, mode: "box" }] }, "auto"),
      ocrKey({ ...base, items: [{ type: "redact", id: "r", x: 1, y: 1, w: 5, h: 5, mode: "blur" }] }, "auto"),
      ocrKey(base, "de-DE"),
    ]);
    expect(keys.size).toBe(8);
  });
  it("does not change with marks that are not redactions (they are not part of what is read)", () => {
    const mark: Annotation = { type: "line", id: "l", x1: 0, y1: 0, x2: 5, y2: 5, stroke: "#000000", strokeOpacity: 100, strokeWidth: 2 };
    expect(ocrKey({ ...base, items: [mark] }, "auto")).toBe(ocrKey(base, "auto"));
  });
  it("does not depend on the order of the redactions or on their ids", () => {
    const a: Annotation = { type: "redact", id: "a", x: 1, y: 1, w: 5, h: 5, mode: "box" };
    const b: Annotation = { type: "redact", id: "b", x: 9, y: 9, w: 5, h: 5, mode: "box" };
    expect(docKey({ ...base, items: [a, b] })).toBe(docKey({ ...base, items: [{ ...b, id: "z" }, a] }));
  });
});

// --- tables -------------------------------------------------------------------------------------------------------------------

/** A grid of cells laid out with columns at fixed x, rows 30 px apart; each cell is one or more words. */
function grid(cells: string[][], xs = [20, 220, 420], y0 = 20): RawLine[] {
  const lines: RawLine[] = [];
  cells.forEach((r, ri) => {
    r.forEach((c, ci) => {
      if (c) lines.push(row(c, xs[ci], y0 + ri * 30));
    });
  });
  return lines;
}

describe("table detection", () => {
  it("finds a grid of aligned columns without lines", () => {
    const doc = buildDocument(result(grid([["Name", "City", "Age"], ["Anna", "Berlin", "31"], ["Ben", "Hamburg", "45"]])));
    const t = detectTable(doc)!;
    expect(t.rows).toEqual([["Name", "City", "Age"], ["Anna", "Berlin", "31"], ["Ben", "Hamburg", "45"]]);
    expect(t.columns).toBe(3);
  });

  it("keeps words of one cell together", () => {
    const doc = buildDocument(result(grid([["Full name", "Home town"], ["Anna Maria Schmidt", "Bad Homburg"], ["Ben", "Ulm"]], [20, 300])));
    expect(detectTable(doc)!.rows[1]).toEqual(["Anna Maria Schmidt", "Bad Homburg"]);
  });

  it("handles ragged rows: missing cells become empty", () => {
    const doc = buildDocument(result(grid([["A", "B", "C"], ["1", "", "3"], ["x", "y", "z"], ["7", "8", ""]])));
    const t = detectTable(doc)!;
    expect(t.rows).toEqual([["A", "B", "C"], ["1", "", "3"], ["x", "y", "z"], ["7", "8", ""]]);
  });

  it("puts right-aligned numbers in their column", () => {
    const lines: RawLine[] = [
      row("Item", 20, 20), row("Price", 300, 20),
      row("Tea", 20, 50), row("2,50", 320, 50),
      row("Coffee", 20, 80), row("12,50", 300, 80),
    ];
    expect(detectTable(buildDocument(result(lines)))!.rows).toEqual([["Item", "Price"], ["Tea", "2,50"], ["Coffee", "12,50"]]);
  });

  it("a line with a gap far above the table is not a row of it", () => {
    const lines = [row("Phone", 20, 0), row("mail", 300, 0), ...grid([["Item", "Qty", "Price"], ["A", "3", "1"], ["B", "4", "2"], ["C", "5", "3"]], [20, 150, 300], 200)];
    expect(detectTable(buildDocument(result(lines)))!.rows).toHaveLength(4);
  });

  it("finds a small table in the middle of a page of text", () => {
    const page: RawLine[] = [];
    for (let i = 0; i < 6; i++) page.push(row(`A sentence of the text number ${i}`, 20, i * 32));
    const table = grid([["Item", "Qty", "Price"], ["Apple", "3", "1.20"], ["Pear", "10", "4.50"]], [20, 260, 520], 260);
    const after: RawLine[] = [row("Closing words of the page", 20, 420), row("and one more line", 20, 452)];
    expect(detectTable(buildDocument(result([...page, ...table, ...after])))!.rows).toEqual([["Item", "Qty", "Price"], ["Apple", "3", "1.20"], ["Pear", "10", "4.50"]]);
  });

  it("a title above the table is not a row of it", () => {
    const lines = [row("Quarterly results", 20, 0), ...grid([["Q", "Sales"], ["1", "10"], ["2", "20"]], [20, 250], 40)];
    expect(detectTable(buildDocument(result(lines)))!.rows).toEqual([["Q", "Sales"], ["1", "10"], ["2", "20"]]);
  });

  it("does not take a paragraph or a single row for a table", () => {
    const paragraph = [row("The quick brown fox jumps", 20, 20), row("over the lazy dog and runs", 20, 50), row("far away from here", 20, 80)];
    expect(detectTable(buildDocument(result(paragraph)))).toBeNull();
    expect(detectTable(buildDocument(result([row("a b c d e f", 20, 20)])))).toBeNull();
    expect(detectTable(buildDocument(result([])))).toBeNull();
  });

  it("does not take a list of two unrelated short columns for a table when most cells are empty", () => {
    const lines = [row("A", 20, 20), row("B", 300, 20), row("one", 20, 50), row("two", 20, 80), row("three", 20, 110), row("four", 20, 140)];
    expect(detectTable(buildDocument(result(lines)))).toBeNull();
  });

  it("does not crash on odd input", () => {
    const odd: RawLine[] = [{ text: "x", words: [word("x", 0, 0, 0, 0)] }, row("a", 5, 5)];
    expect(() => detectTable(buildDocument(result(odd)))).not.toThrow();
    const merged = grid([["Title spanning everything", "", ""], ["a", "b", "c"], ["d", "e", "f"]]);
    expect(() => detectTable(buildDocument(result(merged)))).not.toThrow();
  });

  it("lays out a right-to-left table from the right", () => {
    const lines: RawLine[] = [];
    const ar = (t: string, x: number, y: number): RawLine => ({ text: t, words: [word(t, x, y, 60)] });
    for (const [i, r] of [["اسم", "مدينة"], ["أحمد", "القاهرة"], ["سارة", "دبي"]].entries()) {
      lines.push(ar(r[0], 400, 20 + i * 30), ar(r[1], 150, 20 + i * 30));
    }
    const t = detectTable(buildDocument(result(lines)))!;
    expect(t.rtl).toBe(true);
    expect(t.rows[0]).toEqual(["اسم", "مدينة"]);
    expect(toHtml(t)).toContain('dir="rtl"');
  });
});

describe("table output", () => {
  const table = { rows: [["a\tb", "c<d"], ["x&y", 'say "hi"\nnow']], columns: 2, rtl: false };
  it("is tab separated text with no tabs or line breaks inside cells", () => {
    expect(toTsv(table)).toBe("a b\tc<d\nx&y\tsay \"hi\" now");
  });
  it("is an HTML table with escaped cells", () => {
    expect(toHtml(table)).toBe('<table><tbody><tr><td>a\tb</td><td>c&lt;d</td></tr><tr><td>x&amp;y</td><td>say &quot;hi&quot;\nnow</td></tr></tbody></table>');
  });
});

// --- e-mail addresses and phone numbers -----------------------------------------------------------------------------------------

describe("e-mail addresses", () => {
  it("finds addresses in text", () => {
    expect(findEmails("Mail max.mustermann@example.com or sales+eu@shop.co.uk, thanks").map((m) => m.text)).toEqual(["max.mustermann@example.com", "sales+eu@shop.co.uk"]);
    expect(findEmails("a_b-c@sub.domain.example.org.").map((m) => m.text)).toEqual(["a_b-c@sub.domain.example.org"]);
  });
  it("does not find what is not an address", () => {
    for (const s of ["no at sign here", "@handle", "user@", "user@localhost", "price 5@3 each", "see user@host."]) expect(findEmails(s), s).toEqual([]);
  });
  it("gives the position in the text", () => {
    const [m] = findEmails("write to a@b.de now");
    expect([m.start, m.end]).toEqual([9, 15]);
  });
});

describe("phone numbers", () => {
  const good = [
    "+49 30 12345678", "+49 (0) 151 23456789", "(030) 123456-7", "030/1234567", "030 1234567", "0151 2345 6789", "0151-23456789", "01512345678",
    "+1 (555) 123-4567", "(555) 123-4567", "555-123-4567", "555.123.4567", "+44 20 7946 0958", "020 7946 0958", "06 12 34 56 78", "+33 1 23 45 67 89",
    "+86 138 0013 8000", "00 49 30 1234567", "+41 44 668 18 00", "+43 1 5871234", "+31 20 123 4567", "+90 212 555 12 34",
  ];
  for (const g of good) {
    it(`finds ${g}`, () => {
      expect(findPhones(`Call ${g} today`).map((m) => m.text), g).toEqual([g]);
    });
  }

  const bad = [
    "12.03.2024", "01.02.24", "2024-01-15", "2024/01/15", "10:30:45", "10:30", "1.234,56", "19,99", "1.234.567,89", "192.168.1.100", "10.0.19045.1234", "v1.2.3.4567",
    "1234567", "98765432", "ISBN 978-3-16-148410-0", "Order 12345678", "3.14159265", "12 34 56", "1 2 3 4 5 6 7 8",
  ];
  for (const b of bad) {
    it(`does not find ${b}`, () => {
      expect(findPhones(`See ${b} here`).map((m) => m.text), b).toEqual([]);
    });
  }

  it("takes a full stop after a number out of it", () => {
    expect(findPhones("Tel. +49 30 1234567.").map((m) => m.text)).toEqual(["+49 30 1234567"]);
  });
  it("finds several numbers and gives their positions", () => {
    const ms = findPhones("A: 030 1234567 B: +1 (555) 123-4567");
    expect(ms).toHaveLength(2);
    expect("A: 030 1234567 B: +1 (555) 123-4567".slice(ms[1].start, ms[1].end)).toBe("+1 (555) 123-4567");
  });
  it("needs 7 to 15 digits", () => {
    expect(isPhone("+49 30 12")).toBe(false);
    expect(isPhone("+49 30 1234567")).toBe(true);
    expect(isPhone("+1234567890123456")).toBe(false);
  });
  it("is not part of an address or a longer word", () => {
    expect(findPhones("id0301234567x")).toEqual([]);
    expect(findPhones("user0301234567@mail.de")).toEqual([]);
  });
});

describe("matches of both kinds", () => {
  it("are in text order and an address is not also a phone number", () => {
    const ms = findMatches("a@b.de 030 1234567 c@d.org", { email: true, phone: true });
    expect(ms.map((m) => [m.kind, m.text])).toEqual([["email", "a@b.de"], ["phone", "030 1234567"], ["email", "c@d.org"]]);
    expect(findMatches("0301234567@b.de", { email: true, phone: true }).map((m) => m.kind)).toEqual(["email"]);
  });
  it("find only the kinds that are on", () => {
    expect(findMatches("a@b.de 030 1234567", { email: true, phone: false }).map((m) => m.kind)).toEqual(["email"]);
    expect(findMatches("a@b.de 030 1234567", { email: false, phone: true }).map((m) => m.kind)).toEqual(["phone"]);
    expect(findMatches("a@b.de 030 1234567", { email: false, phone: false })).toEqual([]);
  });
});

// --- quick redact ------------------------------------------------------------------------------------------------------------

describe("redaction from matches", () => {
  const doc = buildDocument(result([row("Mail max@example.com now", 100, 50), row("Call +49 30 1234567 please", 100, 90)]));

  it("covers the words of an address, cut at the characters of the match", () => {
    const [r] = quickRects(doc, { email: true, phone: false }).rects;
    // "Mail " is 4 chars + space: the address word starts at x = 100 + 40 + 6 = 146 and is 15 chars * 10 wide.
    expect(r.x).toBeCloseTo(146 - 2);
    expect(r.w).toBeCloseTo(150 + 4);
    expect(r.y).toBeCloseTo(48);
    expect(r.h).toBeCloseTo(24);
  });

  it("covers a phone number that spans several words with one box", () => {
    const res = quickRects(doc, { email: false, phone: true });
    expect(res.phones).toBe(1);
    expect(res.rects).toHaveLength(1);
    expect(res.rects[0].x).toBeLessThan(100 + 4 * 10 + 6 + 10);
    expect(res.rects[0].w).toBeGreaterThan(100);
  });

  it("counts what it found", () => {
    expect(quickRects(doc, { email: true, phone: true })).toMatchObject({ emails: 1, phones: 1 });
    expect(quickRects(doc, { email: false, phone: false })).toEqual({ rects: [], emails: 0, phones: 0, counts: {} });
  });

  it("cuts a word in the middle: only the characters of the match", () => {
    const w = { text: "abcdefghij", x: 0, y: 0, w: 100, h: 10, n: 0, line: 0 };
    expect(wordSlice(w, 2, 5, false)).toEqual({ x: 20, y: 0, w: 30, h: 10 });
    expect(wordSlice(w, 2, 5, true)).toEqual({ x: 50, y: 0, w: 30, h: 10 });
  });

  it("finds the box of a match in a line, and nothing for a match outside it", () => {
    const line = doc.lines[0];
    expect(matchRect(line, { kind: "email", start: 5, end: 20, text: "" })).not.toBeNull();
    expect(matchRect(line, { kind: "email", start: 500, end: 600, text: "" })).toBeNull();
  });

  it("turns the boxes into redaction marks in the original pixels, whatever the rotation, crop or flip", () => {
    const source = { width: 400, height: 300 };
    // A box around the original pixel (100, 50)..(160, 70).
    for (const d of [
      { crop: null, rotation: 0 as const, flipH: false, flipV: false },
      { crop: { x: 20, y: 10, w: 300, h: 200 }, rotation: 90 as const, flipH: false, flipV: false },
      { crop: null, rotation: 180 as const, flipH: true, flipV: false },
      { crop: { x: 20, y: 10, w: 300, h: 200 }, rotation: 270 as const, flipH: true, flipV: false },
    ]) {
      const m = docGeometry(d, source.width, source.height).matrix;
      const a = apply(m, 100, 50);
      const b = apply(m, 160, 70);
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      const [mark] = redactionsFor([rect], m, source);
      expect(mark).toMatchObject({ type: "redact", mode: "box", origin: "quick" });
      expect([mark.x, mark.y, mark.w, mark.h]).toEqual([100, 50, 60, 20]);
    }
  });

  it("keeps marks inside the picture and drops boxes outside it", () => {
    const m = docGeometry({ crop: null, rotation: 0, flipH: false, flipV: false }, 100, 100).matrix;
    const [a] = redactionsFor([{ x: -10, y: 90, w: 30, h: 30 }], m, { width: 100, height: 100 });
    expect([a.x, a.y, a.w, a.h]).toEqual([0, 90, 20, 10]);
    expect(redactionsFor([{ x: 500, y: 500, w: 10, h: 10 }], m, { width: 100, height: 100 })).toEqual([]);
  });

  it("gives every mark its own id", () => {
    const m = docGeometry({ crop: null, rotation: 0, flipH: false, flipV: false }, 100, 100).matrix;
    const marks = redactionsFor([{ x: 0, y: 0, w: 5, h: 5 }, { x: 10, y: 10, w: 5, h: 5 }], m, { width: 100, height: 100 });
    expect(new Set(marks.map((x) => x.id)).size).toBe(2);
  });
});

// --- the text layer ---------------------------------------------------------------------------------------------------------

describe("the text layer", () => {
  it("puts a word where the picture is on the stage, at any zoom and pan", () => {
    const view = { zoom: 0.5, ox: 30, oy: 20 };
    expect(stageRect({ x: 100, y: 40, w: 80, h: 20 }, view)).toEqual({ x: 80, y: 40, w: 40, h: 10 });
    const v2 = { zoom: 2, ox: -10, oy: 5 };
    expect(stageRect({ x: 0, y: 0, w: 10, h: 10 }, v2)).toEqual({ x: -10, y: 5, w: 20, h: 20 });
  });

  it("follows the picture after crop, rotation and flip: a word on an original pixel lies on that pixel on the stage", () => {
    const view = { zoom: 0.7, ox: 12, oy: 9 };
    for (const d of [
      { crop: { x: 40, y: 30, w: 200, h: 120 }, rotation: 90 as const, flipH: false, flipV: false },
      { crop: null, rotation: 270 as const, flipH: true, flipV: false },
    ]) {
      const m = docGeometry(d, 400, 300).matrix;
      const p = apply(m, 120, 80); // where the OCR sees that pixel (the final picture)
      const stage = stageRect({ x: p.x, y: p.y, w: 0, h: 0 }, view);
      const direct = toStage(view, p.x, p.y);
      expect([stage.x, stage.y]).toEqual([direct.x, direct.y]);
    }
  });

  it("sizes the invisible text to the word", () => {
    expect(fontSizeFor({ h: 20 })).toBeCloseTo(17.2);
    expect(fontSizeFor({ h: 1 })).toBe(4);
    expect(fitScale(50, 100)).toBe(2);
    expect(fitScale(100, 50)).toBe(0.5);
    expect(fitScale(0, 50)).toBe(1);
    expect(fitScale(1, 1000)).toBe(6);
  });

  it("makes the text of a selection from the first to the last word it touches", () => {
    const doc = buildDocument(result([row("one two", 10, 10), row("three four", 10, 36)]));
    expect(selectionText(doc, [1, 0, 2])).toBe("one two\nthree");
    expect(selectionText(doc, [3])).toBe("four");
    expect(selectionText(doc, [])).toBe("");
    expect(selectedNumbers([2, null, undefined, 0, NaN])).toEqual([0, 2]);
  });

  it("finds the word under a point", () => {
    const doc = buildDocument(result([row("one two", 10, 10)]));
    expect(wordAt(doc, 15, 15)?.text).toBe("one");
    expect(wordAt(doc, 50, 15)?.text).toBe("two");
    expect(wordAt(doc, 500, 500)).toBeNull();
  });
});
