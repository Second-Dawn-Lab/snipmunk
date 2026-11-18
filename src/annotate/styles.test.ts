import { describe, expect, it } from "vitest";
import { defaultSettings } from "../settings/defaults";
import { isBoxShape, isRestyled, newEmoji, newHighlighter, newLine, newPen, newShape, newText, pickValues, restyle, styleKey, TOOL_VALUE_KEYS } from "./styles";

const v = pickValues(defaultSettings);

describe("tool values", () => {
  it("are the twelve the popovers keep", () => {
    expect(TOOL_VALUE_KEYS).toHaveLength(12);
    expect(Object.keys(v).sort()).toEqual([...TOOL_VALUE_KEYS].sort());
  });
});

describe("new marks take the remembered values", () => {
  it("pen and highlighter", () => {
    expect(newPen([0, 0, 0.5], v)).toMatchObject({ type: "pen", color: v.lastPenColor, size: v.lastPenSize });
    expect(newHighlighter([0, 0, 0.5], v)).toMatchObject({ color: v.lastHighlighterColor, size: v.lastHighlighterSize });
  });
  it("shapes with fill and outline", () => {
    const s = newShape("ellipse", { x: 1, y: 2, w: 30, h: 40 }, { ...v, lastFillColor: "#112233", lastFillOpacity: 60, lastOutlineColor: "none" });
    expect(s).toMatchObject({ type: "ellipse", x: 1, y: 2, w: 30, h: 40, fill: "#112233", fillOpacity: 60, stroke: "none", rotation: 0 });
  });
  it("a line or arrow never has no colour: it falls back to the pen's", () => {
    const l = newLine("arrow", { x: 0, y: 0 }, { x: 5, y: 5 }, { ...v, lastOutlineColor: "none" });
    expect(l.stroke).toBe(v.lastPenColor);
    expect(newLine("line", { x: 0, y: 0 }, { x: 5, y: 5 }, v).strokeWidth).toBe(v.lastOutlineSize);
  });
  it("text and emoji", () => {
    expect(newText({ x: 3, y: 4 }, v)).toMatchObject({ x: 3, y: 4, text: "", fontSize: v.lastTextSize, color: v.lastTextColor, background: v.lastTextBackground });
    const e = newEmoji("🔥", { x: 100, y: 100 }, 60);
    expect([e.x, e.y]).toEqual([70, 70]);
  });
  it("every mark has its own id", () => {
    expect(newPen([0, 0, 0.5], v).id).not.toBe(newPen([0, 0, 0.5], v).id);
  });
  it("knows the box shapes", () => {
    expect(isBoxShape("rect")).toBe(true);
    expect(isBoxShape("arrow")).toBe(false);
    expect(isBoxShape("emoji")).toBe(false);
  });
});

describe("changing a value restyles the selected marks", () => {
  const pen = newPen([0, 0, 0.5], v);
  const rect = newShape("rect", { x: 0, y: 0, w: 10, h: 10 }, v);
  const arrow = newLine("arrow", { x: 0, y: 0 }, { x: 5, y: 5 }, v);
  const text = newText({ x: 0, y: 0 }, v);

  it("the pen colour changes pen strokes only", () => {
    expect(restyle(pen, { lastPenColor: "#00ff00" })).toMatchObject({ color: "#00ff00", size: pen.size });
    expect(restyle(rect, { lastPenColor: "#00ff00" })).toEqual(rect);
    expect(isRestyled(rect, { lastPenColor: "#00ff00" })).toBe(false);
    expect(isRestyled(pen, { lastPenColor: "#00ff00" })).toBe(true);
  });
  it("fill and outline change shapes", () => {
    expect(restyle(rect, { lastFillColor: "#ff00ff", lastFillOpacity: 30 })).toMatchObject({ fill: "#ff00ff", fillOpacity: 30 });
    expect(restyle(rect, { lastOutlineSize: 9 })).toMatchObject({ strokeWidth: 9 });
  });
  it("the outline changes lines and arrows, but a line cannot lose its colour", () => {
    expect(restyle(arrow, { lastOutlineColor: "#123456", lastOutlineSize: 8 })).toMatchObject({ stroke: "#123456", strokeWidth: 8 });
    expect(restyle(arrow, { lastOutlineColor: "none" })).toMatchObject({ stroke: arrow.stroke });
  });
  it("the text values change text", () => {
    expect(restyle(text, { lastTextColor: "#000000", lastTextSize: 50, lastTextBackground: true })).toMatchObject({ color: "#000000", fontSize: 50, background: true });
  });
  it("redactions and emoji are not restyled", () => {
    const cut = { type: "redact", id: "x", x: 0, y: 0, w: 5, h: 5, mode: "box" } as const;
    expect(restyle(cut, { lastPenColor: "#00ff00" })).toBe(cut);
  });
  it("joins the changes of one value into one undo step", () => {
    expect(styleKey({ lastPenColor: "#000000" })).toBe(styleKey({ lastPenColor: "#ffffff" }));
    expect(styleKey({ lastPenColor: "#000000" })).not.toBe(styleKey({ lastPenSize: 3 }));
  });
});
