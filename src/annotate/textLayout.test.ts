import { describe, expect, it } from "vitest";
import { rotatePoint } from "./geometry";
import type { TextAnnotation } from "./schema";
import { fitted, isCjk, LINE_HEIGHT, pieces, resizeText, textBox, wrapLines } from "./textLayout";

/** Every character is half a font size wide: easy to reason about. */
const measureFor = (fontSize: number) => (s: string) => [...s].length * fontSize * 0.5;
const m10 = measureFor(10); // 5 per character

const text = (o: Partial<TextAnnotation> = {}): TextAnnotation => ({
  type: "text", id: "t", x: 100, y: 100, w: 0, h: 0, text: "Hello world", fontSize: 20, color: "#000000", background: false, rotation: 0, fixedWidth: false, ...o,
});
const fit = (a: TextAnnotation) => fitted(measureFor, a);

describe("breaking text into pieces", () => {
  it("keeps words with their space and splits CJK between characters", () => {
    expect(pieces("one two")).toEqual(["one ", "two"]);
    expect(pieces("你好世界")).toEqual(["你", "好", "世", "界"]);
    expect(pieces("abc你好 d")).toEqual(["abc", "你", "好", " ", "d"]);
  });
  it("keeps closing punctuation with the character before it", () => {
    expect(pieces("你好，世界。")).toEqual(["你", "好，", "世", "界。"]);
  });
  it("knows CJK", () => {
    expect(isCjk("你")).toBe(true);
    expect(isCjk("あ")).toBe(true);
    expect(isCjk("한")).toBe(true);
    expect(isCjk("a")).toBe(false);
    expect(isCjk("ع")).toBe(false);
  });
});

describe("wrapping", () => {
  it("wraps words at the width", () => {
    // 5 px per character: 30 px = 6 characters.
    expect(wrapLines(m10, "aaa bbb ccc", 30)).toEqual(["aaa", "bbb", "ccc"]);
    expect(wrapLines(m10, "aaa bbb ccc", 40)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapLines(m10, "aaa bbb ccc", 1000)).toEqual(["aaa bbb ccc"]);
  });
  it("keeps the line breaks of the text and empty lines", () => {
    expect(wrapLines(m10, "ab\n\ncd", 100)).toEqual(["ab", "", "cd"]);
  });
  it("breaks a word that is wider than the line", () => {
    expect(wrapLines(m10, "abcdefghij", 20)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapLines(m10, "x abcdefghij", 20)).toEqual(["x", "abcd", "efgh", "ij"]);
  });
  it("wraps Chinese text between characters, and never starts a line with a full stop", () => {
    const lines = wrapLines(m10, "你好世界你好世界。", 20);
    expect(lines.every((l) => [...l].length <= 4)).toBe(true);
    expect(lines.join("")).toBe("你好世界你好世界。");
    expect(lines.slice(1).every((l) => !l.startsWith("。"))).toBe(true);
  });
  it("wraps Arabic text at spaces, in logical order", () => {
    const lines = wrapLines(m10, "مرحبا بالعالم اليوم", 40);
    expect(lines.join(" ")).toBe("مرحبا بالعالم اليوم");
  });
  it("never produces an empty result", () => {
    expect(wrapLines(m10, "", 50)).toEqual([""]);
  });
});

describe("the box of a text", () => {
  it("is as wide as the longest line and as high as the lines", () => {
    const b = textBox(m10, "ab\nabcd", 10, false, null);
    expect(b).toMatchObject({ w: 20, h: Math.ceil(2 * 10 * LINE_HEIGHT) });
  });
  it("has the label padding around it", () => {
    const b = textBox(m10, "ab", 10, true, null);
    expect(b.w).toBe(10 + 6);
    expect(b.h).toBe(13 + 6);
  });
  it("with a fixed width wraps and the height always fits the lines", () => {
    const b = textBox(m10, "aaa bbb ccc ddd", 10, false, 30);
    expect(b.lines).toEqual(["aaa", "bbb", "ccc", "ddd"]);
    expect(b.h).toBe(Math.ceil(4 * 10 * LINE_HEIGHT));
    const wide = textBox(m10, "aaa bbb ccc ddd", 10, false, 400);
    expect(wide.lines).toHaveLength(1);
    expect(wide.h).toBe(Math.ceil(10 * LINE_HEIGHT));
  });
  it("does not let the width fall below one character", () => {
    expect(textBox(m10, "abc", 10, false, 1).w).toBeGreaterThanOrEqual(10);
  });
  it("has height for CJK and Arabic text as for any other", () => {
    expect(textBox(m10, "你好\n世界", 10, false, null).h).toBe(Math.ceil(2 * 10 * LINE_HEIGHT));
    expect(textBox(m10, "مرحبا", 10, true, 100).lines).toHaveLength(1);
  });
});

describe("resizing with a corner", () => {
  const a = fit(text({ x: 100, y: 100 })); // 11 chars * 10 = 110 wide, 25 high
  it("scales the font size and the box proportionally and keeps the opposite corner", () => {
    const r = resizeText(a, "se", { x: 100 + a.w * 2, y: 100 + a.h * 2 }, measureFor);
    expect(r.fontSize).toBeCloseTo(40);
    expect(r.w).toBeCloseTo(a.w * 2, 0);
    expect(r.h).toBeCloseTo(a.h * 2, -1);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(100);
  });
  it("keeps the other corners fixed for each handle", () => {
    const nw = resizeText(a, "nw", { x: 100 - a.w, y: 100 - a.h }, measureFor);
    expect(nw.fontSize).toBeCloseTo(40);
    expect(nw.x + nw.w).toBeCloseTo(100 + a.w, 0);
    expect(nw.y + nw.h).toBeCloseTo(100 + a.h, -1);
    const ne = resizeText(a, "ne", { x: 100 + a.w * 1.5, y: 100 - a.h * 0.5 }, measureFor);
    expect(ne.x).toBeCloseTo(100);
    expect(ne.y + ne.h).toBeCloseTo(100 + a.h, -1);
  });
  it("shrinks too, but never below a few pixels", () => {
    expect(resizeText(a, "se", { x: 101, y: 101 }, measureFor).fontSize).toBeGreaterThanOrEqual(4);
    expect(resizeText(a, "se", { x: 100 + a.w / 2, y: 100 + a.h / 2 }, measureFor).fontSize).toBeCloseTo(10);
  });
  it("the box height always matches the lines after a corner resize", () => {
    const r = resizeText(a, "se", { x: 300, y: 200 }, measureFor);
    expect(r.h).toBe(textBox(measureFor(r.fontSize), r.text, r.fontSize, false, null).h);
  });
  it("scales the label padding with the font", () => {
    const l = fit(text({ background: true }));
    const r = resizeText(l, "se", { x: 100 + l.w * 2, y: 100 + l.h * 2 }, measureFor);
    expect(r.w).toBeGreaterThan(l.w * 1.9);
    expect(r.w).toBeLessThan(l.w * 2.1);
  });
  it("keeps a fixed width box proportional", () => {
    const f = fit(text({ fixedWidth: true, w: 60, text: "aaa bbb ccc" }));
    const r = resizeText(f, "se", { x: 100 + f.w * 2, y: 100 + f.h * 2 }, measureFor);
    expect(r.fixedWidth).toBe(true);
    expect(r.fontSize).toBeCloseTo(40);
    expect(r.w).toBeCloseTo(f.w * 2, 0);
  });
});

describe("resizing with a side", () => {
  const a = fit(text({ text: "aaa bbb ccc ddd", x: 100, y: 100 })); // one line, 150 wide
  it("changes the width, wraps the text again and fits the height", () => {
    const r = resizeText(a, "e", { x: 100 + 80, y: 110 }, measureFor);
    expect(r.fixedWidth).toBe(true);
    expect(r.w).toBe(80);
    expect(r.fontSize).toBe(20);
    expect(r.h).toBeGreaterThan(a.h);
    expect(r.h).toBe(textBox(measureFor(20), r.text, 20, false, 80).h);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(100);
  });
  it("the left side keeps the right edge and the top", () => {
    const r = resizeText(a, "w", { x: 100 + 70, y: 100 }, measureFor);
    expect(r.x + r.w).toBeCloseTo(100 + a.w, 0);
    expect(r.w).toBeCloseTo(a.w - 70, 0);
    expect(r.y).toBeCloseTo(100);
  });
  it("widening again takes the extra lines away", () => {
    const narrow = resizeText(a, "e", { x: 160, y: 110 }, measureFor);
    const wide = resizeText(narrow, "e", { x: 400, y: 110 }, measureFor);
    expect(wide.h).toBeLessThan(narrow.h);
    expect(wide.h).toBe(Math.ceil(20 * LINE_HEIGHT));
  });
  it("works for Chinese text, which wraps between characters", () => {
    const c = fit(text({ text: "你好世界你好世界", fontSize: 20 }));
    const r = resizeText(c, "e", { x: 100 + 40, y: 110 }, measureFor);
    expect(r.h).toBeGreaterThan(c.h);
  });
});

describe("resizing a turned text", () => {
  it("a corner keeps the opposite corner on the screen", () => {
    const a = fit(text({ rotation: Math.PI / 6 }));
    const corner = (t: TextAnnotation, fx: number, fy: number) =>
      rotatePoint({ x: t.x + t.w * fx, y: t.y + t.h * fy }, { x: t.x + t.w / 2, y: t.y + t.h / 2 }, t.rotation);
    const anchor = corner(a, 0, 0);
    const target = corner(a, 1.8, 1.8);
    const r = resizeText(a, "se", target, measureFor);
    const after = corner(r, 0, 0);
    expect(after.x).toBeCloseTo(anchor.x, 3);
    expect(after.y).toBeCloseTo(anchor.y, 3);
    expect(r.rotation).toBe(a.rotation);
    expect(r.fontSize).toBeGreaterThan(a.fontSize);
  });
  it("a side keeps the other side and the top edge on the screen", () => {
    const a = fit(text({ text: "aaa bbb ccc ddd", rotation: Math.PI / 4 }));
    const pt = (t: TextAnnotation, fx: number, fy: number) =>
      rotatePoint({ x: t.x + t.w * fx, y: t.y + t.h * fy }, { x: t.x + t.w / 2, y: t.y + t.h / 2 }, t.rotation);
    const topLeft = pt(a, 0, 0);
    const handle = pt(a, 1, 0.5);
    const target = { x: handle.x - 30 * Math.cos(a.rotation), y: handle.y - 30 * Math.sin(a.rotation) };
    const r = resizeText(a, "e", target, measureFor);
    const after = pt(r, 0, 0);
    expect(after.x).toBeCloseTo(topLeft.x, 3);
    expect(after.y).toBeCloseTo(topLeft.y, 3);
    expect(r.w).toBeCloseTo(a.w - 30, 3);
  });
});

describe("other handles", () => {
  it("do not change a text", () => {
    const a = fit(text());
    expect(resizeText(a, "n", { x: 0, y: 0 }, measureFor)).toBe(a);
    expect(resizeText(a, "rotate", { x: 0, y: 0 }, measureFor)).toBe(a);
  });
});
