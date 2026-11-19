import { describe, expect, it } from "vitest";
import { clickEffects, clicksOf, cursorAt, halo, sampleBefore, type CursorSample } from "./cursorTrack";
import { coverCrop, cursorOrigin, cursorSize, evenSize, nearestCorner, webcamBox, webcamRadius } from "./overlay";
import { clampTrim, CRITICAL_BYTES, formatTime, gifEstimate, gifIsVeryLarge, gifPlan, LOW_BYTES, playbackTime, recordedTime, renderIsFresh, renderKey, sourceTime, spaceLevel, stableJson, trimmedDuration } from "./timeline";

const s = (t: number, x: number, y: number, o: Partial<CursorSample> = {}): CursorSample => ({ t, x, y, shape: "arrow", visible: true, left: false, right: false, ...o });

describe("cursor track", () => {
  const track = [s(0, 0, 0), s(1, 100, 50, { shape: "ibeam" }), s(2, 100, 50, { left: true }), s(3, 120, 60, { left: false })];
  it("finds the sample before a time", () => {
    expect([sampleBefore(track, -1), sampleBefore(track, 0), sampleBefore(track, 0.5), sampleBefore(track, 1), sampleBefore(track, 9)]).toEqual([-1, 0, 0, 1, 3]);
  });
  it("interpolates the position and steps the shape", () => {
    const mid = cursorAt(track, 0.5);
    expect(mid).toMatchObject({ x: 50, y: 25, shape: "arrow" });
    expect(cursorAt(track, 1.5)).toMatchObject({ x: 100, y: 50, shape: "ibeam" });
    expect(cursorAt(track, 10)).toMatchObject({ x: 120, y: 60 });
    expect(cursorAt(track, -5)).toMatchObject({ x: 0, y: 0 });
    expect(cursorAt([], 1)).toBeNull();
  });
  it("finds the presses of each button once", () => {
    const t = [s(0, 1, 1), s(1, 2, 2, { left: true }), s(1.1, 2, 2, { left: true }), s(1.5, 2, 2), s(2, 3, 3, { right: true, left: true }), s(2.2, 3, 3)];
    expect(clicksOf(t)).toEqual([
      { t: 1, x: 2, y: 2, button: "left" },
      { t: 2, x: 3, y: 3, button: "left" },
      { t: 2, x: 3, y: 3, button: "right" },
    ]);
  });
  it("click effects live for 0.6 s, grow and fade, and scale with the cursor", () => {
    const c = [{ t: 1, x: 10, y: 10, button: "left" as const }];
    expect(clickEffects(c, 0.9, "ripple")).toEqual([]);
    expect(clickEffects(c, 1.7, "ripple")).toEqual([]);
    expect(clickEffects(c, 1, "off")).toEqual([]);
    const early = clickEffects(c, 1.1, "ripple")[0];
    const late = clickEffects(c, 1.5, "ripple")[0];
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(clickEffects(c, 1.3, "ripple", 2)[0].radius).toBeCloseTo(clickEffects(c, 1.3, "ripple", 1)[0].radius * 2);
    expect(clickEffects(c, 1.3, "burst")).toHaveLength(9);
  });
  it("the halo follows the visible cursor only", () => {
    expect(halo(cursorAt(track, 1), { enabled: true })).toEqual({ x: 100, y: 50, radius: 28 });
    expect(halo(cursorAt(track, 1), { enabled: false })).toBeNull();
    expect(halo({ ...(cursorAt(track, 1) as object), visible: false } as never, { enabled: true })).toBeNull();
    expect(halo(cursorAt(track, 1), { enabled: true, radius: 20 }, 2)?.radius).toBe(40);
  });
});

describe("overlay layout", () => {
  it("puts the webcam in a corner with an edge margin, inside the video, for every shape and size", () => {
    for (const shape of ["circle", "rounded", "rectangle"] as const) {
      for (const size of ["s", "m", "l"] as const) {
        for (const corner of ["tl", "tr", "bl", "br"] as const) {
          const b = webcamBox(1920, 1080, { shape, size, corner });
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(1920);
          expect(b.y + b.h).toBeLessThanOrEqual(1080);
        }
      }
    }
    const circle = webcamBox(1920, 1080, { shape: "circle", size: "m", corner: "br" });
    expect(circle.w).toBe(circle.h);
    expect(circle.x + circle.w + 32).toBe(1920);
    const rect = webcamBox(1920, 1080, { shape: "rectangle", size: "m", corner: "tl" });
    expect(rect.w / rect.h).toBeCloseTo(16 / 9, 1);
  });
  it("sizes grow from small to large, and a dragged position is kept inside", () => {
    const w = (size: "s" | "m" | "l") => webcamBox(1280, 720, { shape: "circle", size, corner: "tl" }).w;
    expect(w("s")).toBeLessThan(w("m"));
    expect(w("m")).toBeLessThan(w("l"));
    const b = webcamBox(1280, 720, { shape: "circle", size: "m", corner: "tl", custom: { cx: 1, cy: 1 } });
    expect(b.x + b.w).toBe(1280);
    expect(b.y + b.h).toBe(720);
  });
  it("snaps a drag to the nearest corner", () => {
    expect([nearestCorner(0.1, 0.1), nearestCorner(0.9, 0.2), nearestCorner(0.2, 0.9), nearestCorner(0.8, 0.8)]).toEqual(["tl", "tr", "bl", "br"]);
  });
  it("shapes round their corners, a camera frame is cropped to fill the box without stretching", () => {
    const box = { x: 0, y: 0, w: 200, h: 200 };
    expect(webcamRadius("circle", box)).toBe(100);
    expect(webcamRadius("rounded", box)).toBeLessThan(100);
    expect(webcamRadius("rectangle", box)).toBeLessThan(webcamRadius("rounded", box));
    expect(coverCrop(1280, 720, box)).toEqual({ x: 280, y: 0, w: 720, h: 720 });
    expect(coverCrop(720, 1280, box)).toEqual({ x: 0, y: 280, w: 720, h: 720 });
  });
  it("scales the cursor around its hot spot and makes sizes even", () => {
    expect(cursorSize(12, 19, 1.5)).toEqual({ w: 18, h: 29 });
    expect(cursorOrigin(100, 100, 2, 3, 2)).toEqual({ x: 96, y: 94 });
    expect(evenSize(1921, 1081)).toEqual({ w: 1920, h: 1080 });
    expect(evenSize(1, 1)).toEqual({ w: 2, h: 2 });
  });
});

describe("timeline", () => {
  it("leaves paused time out, so the timeline has no gaps", () => {
    const ev = [{ type: "pause" as const, at: 10 }, { type: "resume" as const, at: 25 }, { type: "pause" as const, at: 40 }];
    expect(recordedTime(5, ev)).toBe(5);
    expect(recordedTime(20, ev)).toBe(10);
    expect(recordedTime(30, ev)).toBe(15);
    expect(recordedTime(100, ev)).toBe(25);
    expect(recordedTime(7, [])).toBe(7);
  });
  it("trims stay inside the recording and keep a minimum length", () => {
    expect(clampTrim({ start: -5, end: 99 }, 60)).toEqual({ start: 0, end: 60 });
    expect(clampTrim({ start: 59.99, end: 60 }, 60)).toEqual({ start: 59.8, end: 60 });
    expect(clampTrim({ start: 30, end: 10 }, 60).end).toBeGreaterThan(30);
    expect(clampTrim({ start: 1, end: 2 }, 0.1)).toEqual({ start: 0, end: 0.1 });
    expect(trimmedDuration({ start: 5, end: 12.5 })).toBe(7.5);
    expect(sourceTime({ start: 5, end: 12 }, 3)).toBe(8);
    expect(sourceTime({ start: 5, end: 12 }, 99)).toBe(12);
  });
  it("playback stops at the trim end and starts at the trim start", () => {
    expect(playbackTime({ start: 5, end: 12 }, 2)).toBe(5);
    expect(playbackTime({ start: 5, end: 12 }, 8)).toBe(8);
    expect(playbackTime({ start: 5, end: 12 }, 12)).toBeNull();
  });
  it("formats times", () => {
    expect([formatTime(5), formatTime(65), formatTime(3723), formatTime(-3)]).toEqual(["0:05", "1:05", "1:02:03", "0:00"]);
  });
  it("disk space: ok, low (little space or few minutes left) and critical", () => {
    const rate = 2 * 1024 * 1024; // 2 MB per second
    expect(spaceLevel(50 * 1024 ** 3, rate)).toBe("ok");
    expect(spaceLevel(LOW_BYTES - 1, rate)).toBe("low");
    expect(spaceLevel(CRITICAL_BYTES + 100 * rate, rate)).toBe("low");
    expect(spaceLevel(CRITICAL_BYTES - 1, rate)).toBe("critical");
    expect(spaceLevel(10 * 1024 ** 3, 0)).toBe("ok");
  });
  it("the render cache key ignores key order and changes with every setting that changes the picture or the sound", () => {
    const base = { effects: { cursor: 1.5, halo: true }, webcam: { corner: "br", size: "m" }, trim: { start: 0, end: 10 }, volumes: { system: 1, mic: 0.8 }, sourceStamp: 7 };
    const k = renderKey(base);
    expect(renderKey({ ...base, effects: { halo: true, cursor: 1.5 } })).toBe(k);
    for (const changed of [
      { ...base, effects: { cursor: 2, halo: true } },
      { ...base, webcam: { corner: "tl", size: "m" } },
      { ...base, trim: { start: 1, end: 10 } },
      { ...base, volumes: { system: 1, mic: 0.5 } },
      { ...base, sourceStamp: 8 },
    ]) expect(renderKey(changed)).not.toBe(k);
    expect(renderIsFresh(k, k)).toBe(true);
    expect(renderIsFresh(null, k)).toBe(false);
    expect(renderIsFresh("old", k)).toBe(false);
    expect(stableJson({ b: [1, { d: 1, c: 2 }], a: undefined })).toBe('{"a":null,"b":[1,{"c":2,"d":1}]}');
  });
  it("plans a GIF by quality and estimates its size", () => {
    const low = gifPlan("low", 1920, 1080, 10);
    const high = gifPlan("high", 1920, 1080, 10);
    expect(low).toMatchObject({ fps: 10, width: 640, height: 360, frames: 100 });
    expect(high).toMatchObject({ fps: 15, width: 1280, height: 720, frames: 150 });
    expect(gifEstimate(high)).toBeGreaterThan(gifEstimate(low));
    expect(gifPlan("high", 800, 600, 2)).toMatchObject({ width: 800, height: 600 });
    expect(gifIsVeryLarge(gifEstimate(gifPlan("high", 1920, 1080, 60)))).toBe(true);
    expect(gifIsVeryLarge(gifEstimate(low))).toBe(false);
  });
});
