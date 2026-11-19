import { describe, expect, it } from "vitest";
import { brushCursor, eraserCursor, resizeCursor, rotateCursor, thinCrosshairCursor } from "./cursors";

const decode = (css: string) => decodeURIComponent(/data:image\/svg\+xml,([^"]+)"/.exec(css)?.[1] ?? "");

describe("resize cursors", () => {
  it("match the handle on an upright mark", () => {
    expect(["e", "w"].map((k) => resizeCursor(k as never))).toEqual(["ew-resize", "ew-resize"]);
    expect(["n", "s"].map((k) => resizeCursor(k as never))).toEqual(["ns-resize", "ns-resize"]);
    expect(["nw", "se"].map((k) => resizeCursor(k as never))).toEqual(["nwse-resize", "nwse-resize"]);
    expect(["ne", "sw"].map((k) => resizeCursor(k as never))).toEqual(["nesw-resize", "nesw-resize"]);
  });
  it("turn with a rotated mark to the nearest direction", () => {
    expect(resizeCursor("e", Math.PI / 2)).toBe("ns-resize");
    expect(resizeCursor("e", Math.PI / 4)).toBe("nwse-resize");
    expect(resizeCursor("e", (Math.PI / 4) * 3)).toBe("nesw-resize");
    expect(resizeCursor("n", Math.PI / 2)).toBe("ew-resize");
    expect(resizeCursor("se", Math.PI / 2)).toBe("nesw-resize");
    expect(resizeCursor("e", 0.2)).toBe("ew-resize");
    expect(resizeCursor("e", -Math.PI / 4)).toBe("nesw-resize");
  });
  it("turn with a rotated picture too", () => {
    expect(resizeCursor("e", 0, 90)).toBe("ns-resize");
    expect(resizeCursor("nw", 0, 90)).toBe("nesw-resize");
    expect(resizeCursor("e", Math.PI / 2, 90)).toBe("ew-resize");
  });
  it("the rotation handle and line ends have their own cursors", () => {
    expect(resizeCursor("rotate")).toBe("grab");
    expect(resizeCursor("p1")).toBe("move");
  });
});

describe("tool cursors", () => {
  it("the brush ring has the size of the stroke on the screen and the tool's colour, with the hot spot in the middle", () => {
    const css = brushCursor("#E53935", 18);
    const svg = decode(css);
    expect(svg).toContain('width="22"');
    expect(svg).toContain('r="9"');
    expect(svg).toContain('fill="#E53935"');
    expect(css).toMatch(/ 11 11, crosshair$/);
  });
  it("a tiny or a huge brush stays between 6 and 124 pixels", () => {
    expect(decode(brushCursor("#000000", 1))).toContain('r="3"');
    expect(decode(brushCursor("#000000", 900))).toContain('r="62"');
  });
  it("the eraser, the thin crosshair and the rotate cursor are images with a fallback", () => {
    for (const css of [eraserCursor(), thinCrosshairCursor(), rotateCursor()]) {
      expect(css).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(css).toMatch(/, (crosshair|grab)$/);
      expect(decode(css)).toContain("<svg");
    }
    expect(thinCrosshairCursor()).toMatch(/ 10 10, crosshair$/);
  });
});
