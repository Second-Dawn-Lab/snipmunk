import { describe, expect, it } from "vitest";
import { centred, clampPan, clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM, toPicture, toStage, zoomAt } from "./view";

const stage = { width: 800, height: 600 };

describe("fitting", () => {
  it("never enlarges beyond 100 % and keeps a margin", () => {
    expect(fitZoom({ width: 400, height: 300 }, stage)).toBe(1);
    expect(fitZoom({ width: 1600, height: 300 }, stage)).toBeCloseTo(768 / 1600);
    expect(fitZoom({ width: 3840, height: 2160 }, stage)).toBeCloseTo(768 / 3840);
    expect(fitZoom({ width: 0, height: 10 }, stage)).toBe(1);
  });
  it("centres the picture", () => {
    expect(centred({ width: 400, height: 300 }, stage, 1)).toEqual({ zoom: 1, ox: 200, oy: 150 });
  });
});

describe("coordinates", () => {
  it("map stage points to picture points and back at any zoom", () => {
    for (const zoom of [0.25, 1, 3.5]) {
      const v = { zoom, ox: 37, oy: -12 };
      const p = toPicture(v, 300, 200);
      const s = toStage(v, p.x, p.y);
      expect(s.x).toBeCloseTo(300);
      expect(s.y).toBeCloseTo(200);
    }
  });
  it("zooming at a point keeps that point of the picture under the pointer", () => {
    const v = { zoom: 1, ox: 100, oy: 50 };
    const before = toPicture(v, 400, 300);
    const z = zoomAt(v, 2.5, 400, 300);
    const after = toPicture(z, 400, 300);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(z.zoom).toBe(2.5);
  });
});

describe("the zoom limits and the wheel", () => {
  it("stay between the limits", () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(zoomAt({ zoom: 1, ox: 0, oy: 0 }, 1000, 0, 0).zoom).toBe(MAX_ZOOM);
  });
});

describe("panning", () => {
  it("keeps part of the picture in view", () => {
    const v = clampPan({ zoom: 1, ox: -5000, oy: 5000 }, { width: 400, height: 300 }, stage);
    expect(v.ox).toBe(80 - 400);
    expect(v.oy).toBe(600 - 80);
    expect(clampPan({ zoom: 1, ox: 10, oy: 10 }, { width: 400, height: 300 }, stage)).toEqual({ zoom: 1, ox: 10, oy: 10 });
  });
});
