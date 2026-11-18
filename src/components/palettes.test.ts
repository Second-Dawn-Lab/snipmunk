import { describe, expect, it } from "vitest";
import { EMOJI, HIGHLIGHTER_COLORS, PALETTE, PALETTE_COLUMNS, readableOn } from "./palettes";

const hex = /^#[0-9A-F]{6}$/i;

describe("palettes", () => {
  it("has 30 distinct colors in a 6 x 5 grid", () => {
    expect(PALETTE).toHaveLength(30);
    expect(PALETTE_COLUMNS).toBe(6);
    expect(PALETTE.length / PALETTE_COLUMNS).toBe(5);
    expect(new Set(PALETTE.map((c) => c.toLowerCase())).size).toBe(30);
    expect(PALETTE.every((c) => hex.test(c))).toBe(true);
  });

  it("has 6 highlighter colors and 18 emoji", () => {
    expect(HIGHLIGHTER_COLORS).toHaveLength(6);
    expect(HIGHLIGHTER_COLORS.every((c) => hex.test(c))).toBe(true);
    expect(EMOJI).toHaveLength(18);
    expect(new Set(EMOJI).size).toBe(18);
  });

  it("picks a readable check mark color", () => {
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#FFFFFF")).toBe("#000000");
    expect(readableOn("#FDD835")).toBe("#000000");
    expect(readableOn("#3949AB")).toBe("#ffffff");
  });
});
