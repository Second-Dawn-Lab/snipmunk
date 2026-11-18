import { describe, expect, it } from "vitest";
import { nextTarget, pixels, stepZoom, wheelAction, zoomFactor, ZOOM_SMOOTHING_MS, type WheelInput } from "./wheel";
import { clampZoom } from "./view";

const wheel = (o: Partial<WheelInput> = {}): WheelInput => ({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });

describe("the wheel in zoom mode", () => {
  it("zooms at the pointer: away from you zooms in, towards you zooms out", () => {
    const a = wheelAction(wheel({ deltaY: -100 }), "zoom");
    const b = wheelAction(wheel({ deltaY: 100 }), "zoom");
    expect(a).toMatchObject({ kind: "zoom" });
    expect((a as { factor: number }).factor).toBeGreaterThan(1);
    expect((b as { factor: number }).factor).toBeLessThan(1);
  });
  it("Ctrl + wheel and a touchpad pinch (also Ctrl + wheel) zoom too", () => {
    expect(wheelAction(wheel({ ctrlKey: true, deltaY: -4, deltaMode: 0 }), "zoom")).toMatchObject({ kind: "zoom" });
    expect(wheelAction(wheel({ metaKey: true }), "zoom")).toMatchObject({ kind: "zoom" });
  });
  it("Shift + wheel pans sideways", () => {
    expect(wheelAction(wheel({ shiftKey: true, deltaY: 100 }), "zoom")).toEqual({ kind: "pan", dx: -100, dy: 0 });
    // Systems that already turn it into a sideways wheel report deltaX.
    expect(wheelAction(wheel({ shiftKey: true, deltaX: 60, deltaY: 0 }), "zoom")).toEqual({ kind: "pan", dx: -60, dy: 0 });
  });
  it("a purely sideways wheel pans", () => {
    expect(wheelAction(wheel({ deltaX: 40, deltaY: 0 }), "zoom")).toEqual({ kind: "pan", dx: -40, dy: 0 });
  });
  it("does nothing for a wheel that did not move", () => {
    expect(wheelAction(wheel({ deltaY: 0 }), "zoom")).toBeNull();
    expect(wheelAction(wheel({ deltaY: 0, ctrlKey: true }), "zoom")).toBeNull();
  });
});

describe("the wheel in scroll mode", () => {
  it("pans in both directions", () => {
    expect(wheelAction(wheel({ deltaX: 30, deltaY: 50 }), "scroll")).toEqual({ kind: "pan", dx: -30, dy: -50 });
  });
  it("Ctrl + wheel and a pinch zoom", () => {
    expect(wheelAction(wheel({ ctrlKey: true, deltaY: -80 }), "scroll")).toMatchObject({ kind: "zoom" });
  });
  it("Shift + wheel pans sideways", () => {
    expect(wheelAction(wheel({ shiftKey: true, deltaY: 100 }), "scroll")).toEqual({ kind: "pan", dx: -100, dy: 0 });
  });
});

describe("the size of a wheel step", () => {
  it("lines and pages are turned into pixels", () => {
    expect(pixels(3, 1)).toBe(48);
    expect(pixels(1, 2)).toBe(400);
    expect(pixels(7, 0)).toBe(7);
    expect(wheelAction(wheel({ deltaY: 3, deltaMode: 1, shiftKey: true }), "zoom")).toEqual({ kind: "pan", dx: -48, dy: 0 });
  });
  it("a notch is about 12 %, a small touchpad step is small, a huge one is limited", () => {
    expect(zoomFactor(-100)).toBeCloseTo(1.127, 2);
    expect(zoomFactor(-5)).toBeLessThan(1.01);
    expect(zoomFactor(-100000)).toBeCloseTo(zoomFactor(-300));
    expect(zoomFactor(100) * zoomFactor(-100)).toBeCloseTo(1);
  });
});

describe("smooth zoom", () => {
  it("moves towards the target without overshooting and reaches it", () => {
    let z = 1;
    const seen: number[] = [];
    for (let i = 0; i < 80; i++) {
      z = stepZoom(z, 2, 16);
      seen.push(z);
    }
    expect(seen[0]).toBeGreaterThan(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(2);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(z).toBe(2);
  });
  it("zooming out is the mirror of zooming in", () => {
    const up = stepZoom(1, 4, 16);
    const down = stepZoom(4, 1, 16);
    expect(up * down).toBeCloseTo(4, 5);
  });
  it("does not depend on the frame rate", () => {
    let fast = 1;
    for (let i = 0; i < 10; i++) fast = stepZoom(fast, 3, 8);
    let slow = 1;
    for (let i = 0; i < 5; i++) slow = stepZoom(slow, 3, 16);
    expect(fast).toBeCloseTo(slow, 6);
  });
  it("covers about two thirds of the way in the smoothing time", () => {
    const z = stepZoom(1, Math.E, ZOOM_SMOOTHING_MS);
    expect(Math.log(z)).toBeCloseTo(1 - Math.exp(-1), 6);
  });
  it("does not move for no time and snaps when close", () => {
    expect(stepZoom(1, 2, 0)).toBe(1);
    expect(stepZoom(1.9999, 2, 16)).toBe(2);
  });
  it("wheel steps pile up from where the last one was heading", () => {
    const a = nextTarget(null, 1, 1.2, 10, 20, clampZoom);
    const b = nextTarget(a, 1.05, 1.2, 30, 40, clampZoom);
    expect(a).toEqual({ zoom: 1.2, x: 10, y: 20 });
    expect(b.zoom).toBeCloseTo(1.44);
    expect([b.x, b.y]).toEqual([30, 40]);
    expect(nextTarget(null, 15, 3, 0, 0, clampZoom).zoom).toBe(16);
  });
});
