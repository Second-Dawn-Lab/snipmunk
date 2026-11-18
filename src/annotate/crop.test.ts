import { describe, expect, it } from "vitest";
import { ASPECTS, clampRect, cropHandleAt, fitAspect, MIN_CROP, moveFrame, resizeFrame } from "./crop";

const bounds = { w: 400, h: 300 };
const frame = { x: 100, y: 80, w: 200, h: 120 };

describe("the crop frame", () => {
  it("moves inside the picture", () => {
    expect(moveFrame(frame, 20, -10, bounds)).toEqual({ x: 120, y: 70, w: 200, h: 120 });
    expect(moveFrame(frame, 999, 999, bounds)).toEqual({ x: 200, y: 180, w: 200, h: 120 });
    expect(moveFrame(frame, -999, -999, bounds)).toEqual({ x: 0, y: 0, w: 200, h: 120 });
  });

  it("is resized by a side or a corner, the opposite side staying put", () => {
    expect(resizeFrame(frame, "e", 50, 0, bounds, null)).toEqual({ x: 100, y: 80, w: 250, h: 120 });
    expect(resizeFrame(frame, "nw", -30, -20, bounds, null)).toEqual({ x: 70, y: 60, w: 230, h: 140 });
    expect(resizeFrame(frame, "s", 0, -30, bounds, null)).toEqual({ x: 100, y: 80, w: 200, h: 90 });
  });

  it("stays inside the picture and above the minimum", () => {
    expect(resizeFrame(frame, "se", 999, 999, bounds, null)).toEqual({ x: 100, y: 80, w: 300, h: 220 });
    expect(resizeFrame(frame, "w", 999, 0, bounds, null).w).toBe(MIN_CROP);
    expect(resizeFrame(frame, "n", 0, -999, bounds, null).y).toBe(0);
  });

  it("keeps an aspect ratio when a corner is dragged", () => {
    const r = resizeFrame(frame, "se", 80, 10, bounds, 4 / 3);
    expect(r.w / r.h).toBeCloseTo(4 / 3);
    expect(r.x).toBe(100);
    expect(r.y).toBe(80);
  });

  it("keeps an aspect ratio when a side is dragged, growing around the middle of the other axis", () => {
    const r = resizeFrame(frame, "e", 60, 0, bounds, 1);
    expect(r.w).toBeCloseTo(r.h);
    expect(r.y + r.h / 2).toBeCloseTo(80 + 60);
  });

  it("keeps the ratio and the picture's limits together", () => {
    const r = resizeFrame(frame, "se", 999, 999, bounds, 16 / 9);
    expect(r.w / r.h).toBeCloseTo(16 / 9);
    expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(300 + 1e-6);
  });

  it("fits an aspect into the current frame, centred", () => {
    const r = fitAspect(frame, 1, bounds);
    expect(r).toEqual({ x: 140, y: 80, w: 120, h: 120 });
    const wide = fitAspect(frame, 16 / 9, bounds);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9);
    expect(wide.x).toBeGreaterThanOrEqual(100 - 1e-6);
  });

  it("offers free, 1:1, 4:3 and 16:9", () => {
    expect(ASPECTS.map((a) => a.id)).toEqual(["free", "1:1", "4:3", "16:9"]);
    expect(ASPECTS[0].ratio).toBeNull();
  });

  it("clamps a rectangle", () => {
    expect(clampRect({ x: -10, y: 500, w: 1000, h: 5 }, bounds)).toEqual({ x: 0, y: 295, w: 400, h: 5 });
  });
});

describe("the handle under the pointer", () => {
  it("is a corner, a side, the inside or nothing", () => {
    expect(cropHandleAt(frame, { x: 101, y: 81 }, 8)).toBe("nw");
    expect(cropHandleAt(frame, { x: 299, y: 199 }, 8)).toBe("se");
    expect(cropHandleAt(frame, { x: 200, y: 80 }, 8)).toBe("n");
    expect(cropHandleAt(frame, { x: 300, y: 140 }, 8)).toBe("e");
    expect(cropHandleAt(frame, { x: 200, y: 140 }, 8)).toBe("move");
    expect(cropHandleAt(frame, { x: 10, y: 10 }, 8)).toBeNull();
  });
});
