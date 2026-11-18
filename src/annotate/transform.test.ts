import { describe, expect, it } from "vitest";
import { apply, cropFromFrame, docGeometry, effectiveCrop, flippedOnScreen, frameFromCrop, invert, multiply, turned, uncroppedGeometry } from "./transform";
import type { Rotation } from "./schema";

const doc = (o: Partial<{ crop: { x: number; y: number; w: number; h: number } | null; rotation: Rotation; flipH: boolean; flipV: boolean }> = {}) => ({
  crop: null,
  rotation: 0 as Rotation,
  flipH: false,
  flipV: false,
  ...o,
});
const near = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x);
  expect(a.y).toBeCloseTo(y);
};

describe("the size of the final picture", () => {
  it("is the original without edits", () => {
    const g = docGeometry(doc(), 400, 300);
    expect([g.width, g.height]).toEqual([400, 300]);
  });
  it("is the crop, and swaps with a quarter turn", () => {
    expect(docGeometry(doc({ crop: { x: 10, y: 20, w: 100, h: 50 } }), 400, 300)).toMatchObject({ width: 100, height: 50 });
    expect(docGeometry(doc({ crop: { x: 10, y: 20, w: 100, h: 50 }, rotation: 90 }), 400, 300)).toMatchObject({ width: 50, height: 100 });
    expect(docGeometry(doc({ rotation: 270 }), 400, 300)).toMatchObject({ width: 300, height: 400 });
    expect(docGeometry(doc({ rotation: 180 }), 400, 300)).toMatchObject({ width: 400, height: 300 });
  });
  it("keeps a crop inside the picture", () => {
    expect(effectiveCrop({ x: -5, y: 290, w: 9999, h: 9999 }, 400, 300)).toEqual({ x: 0, y: 290, w: 400, h: 10 });
    expect(effectiveCrop(null, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});

describe("where a point of the original goes", () => {
  it("is moved by the crop", () => {
    near(apply(docGeometry(doc({ crop: { x: 10, y: 20, w: 100, h: 50 } }), 400, 300).matrix, 10, 20), 0, 0);
    near(apply(docGeometry(doc({ crop: { x: 10, y: 20, w: 100, h: 50 } }), 400, 300).matrix, 60, 45), 50, 25);
  });
  it("turns clockwise: the top-left corner goes to the top-right", () => {
    const m = docGeometry(doc({ rotation: 90 }), 400, 300).matrix;
    near(apply(m, 0, 0), 300, 0);
    near(apply(m, 400, 0), 300, 400);
    near(apply(m, 0, 300), 0, 0);
  });
  it("turns half way and three quarters", () => {
    near(apply(docGeometry(doc({ rotation: 180 }), 400, 300).matrix, 0, 0), 400, 300);
    const m = docGeometry(doc({ rotation: 270 }), 400, 300).matrix;
    near(apply(m, 0, 0), 0, 400);
    near(apply(m, 400, 300), 300, 0);
  });
  it("flips left to right and top to bottom inside the crop", () => {
    near(apply(docGeometry(doc({ flipH: true }), 400, 300).matrix, 0, 0), 400, 0);
    near(apply(docGeometry(doc({ flipV: true }), 400, 300).matrix, 0, 0), 0, 300);
    near(apply(docGeometry(doc({ flipH: true, crop: { x: 100, y: 0, w: 200, h: 300 } }), 400, 300).matrix, 100, 0), 200, 0);
  });
  it("is reversible", () => {
    const m = docGeometry(doc({ rotation: 90, flipH: true, crop: { x: 12, y: 7, w: 200, h: 100 } }), 400, 300).matrix;
    const back = apply(invert(m), apply(m, 77, 31).x, apply(m, 77, 31).y);
    near(back, 77, 31);
    const id = multiply(invert(m), m);
    expect(id.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe("the crop frame", () => {
  it("is drawn on the turned picture and stored in original pixels", () => {
    const turn = { rotation: 90 as Rotation, flipH: false, flipV: false };
    const frame = { x: 10, y: 20, w: 100, h: 50 };
    const stored = cropFromFrame(frame, turn, 400, 300);
    expect(stored).toEqual({ x: 20, y: 190, w: 50, h: 100 });
    expect(frameFromCrop(stored, turn, 400, 300)).toEqual(frame);
  });
  it("comes back unchanged for every rotation and flip", () => {
    const frame = { x: 30, y: 40, w: 90, h: 60 };
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const flipH of [false, true]) {
        const turn = { rotation, flipH, flipV: false };
        const w = uncroppedGeometry(turn, 400, 300);
        const f = { x: 30, y: 40, w: Math.min(90, w.width - 30), h: Math.min(60, w.height - 40) };
        expect(frameFromCrop(cropFromFrame(f, turn, 400, 300), turn, 400, 300)).toEqual(f);
        void frame;
      }
    }
  });
  it("shows the whole picture when there is no crop", () => {
    expect(frameFromCrop(null, { rotation: 90, flipH: false, flipV: false }, 400, 300)).toEqual({ x: 0, y: 0, w: 300, h: 400 });
  });
});

describe("rotating", () => {
  it("adds quarter turns, clockwise or back, and wraps", () => {
    expect(turned(0, 1)).toBe(90);
    expect(turned(270, 1)).toBe(0);
    expect(turned(0, -1)).toBe(270);
    expect(turned(90, 4)).toBe(90);
    expect(turned(180, -3)).toBe(270);
  });
});

describe("mirroring what is shown", () => {
  const shown = (d: ReturnType<typeof doc>, x: number, y: number) => {
    const g = docGeometry(d, 400, 300);
    return { p: apply(g.matrix, x, y), w: g.width, h: g.height };
  };
  it("a left-right mirror of the shown picture, for every rotation and flip", () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const flipH of [false, true]) {
        const before = doc({ rotation, flipH });
        const after = doc({ ...flippedOnScreen(before, "h") });
        for (const [x, y] of [[0, 0], [100, 40], [399, 299]]) {
          const a = shown(before, x, y);
          const b = shown(after, x, y);
          expect(b.p.x).toBeCloseTo(a.w - a.p.x);
          expect(b.p.y).toBeCloseTo(a.p.y);
        }
      }
    }
  });
  it("a top-bottom mirror of the shown picture", () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const before = doc({ rotation, flipH: true });
      const after = doc({ ...flippedOnScreen(before, "v") });
      for (const [x, y] of [[0, 0], [100, 40], [399, 299]]) {
        const a = shown(before, x, y);
        const b = shown(after, x, y);
        expect(b.p.x).toBeCloseTo(a.p.x);
        expect(b.p.y).toBeCloseTo(a.h - a.p.y);
      }
    }
  });
  it("twice is the same picture", () => {
    const d = doc({ rotation: 90, flipH: false });
    const twice = flippedOnScreen(flippedOnScreen(d, "h"), "h");
    expect(twice).toEqual({ rotation: 90, flipH: false, flipV: false });
  });
});
