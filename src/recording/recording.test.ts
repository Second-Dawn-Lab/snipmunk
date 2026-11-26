import { describe, expect, it } from "vitest";
import { clicksOf, cursorAt, sampleBefore, type CursorSample } from "./cursorTrack";
import { clampTrim, formatTime, videoClock } from "./timeline";

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
});

describe("the video's clock", () => {
  it("is the recording's clock for a video that begins at 0, and when nothing is known", () => {
    for (const start of [0, undefined, null, Number.NaN, -5]) {
      expect(videoClock(start).recorded(2.5)).toBe(2.5);
      expect(videoClock(start).video(2.5)).toBe(2.5);
    }
  });
  it("runs a picture ahead for a video that begins late, so the cursor of the picture on show is found", () => {
    // 30 pictures a second, the software encoder: the picture recorded at 1 s is shown at 1.0333 s of the video.
    const c = videoClock(1000 / 30);
    expect(c.video(1)).toBeCloseTo(31 / 30, 9);
    expect(c.recorded(31 / 30)).toBeCloseTo(1, 9);
    const track = [s(0, 0, 0), s(1, 100, 50), s(31 / 30, 130, 50)];
    expect(cursorAt(track, c.recorded(31 / 30))?.x).toBeCloseTo(100, 6);
    // Before the first picture there is nothing earlier than the start.
    expect(c.recorded(0.01)).toBe(0);
  });
});

describe("timeline", () => {
  it("trims stay inside the recording and keep a minimum length", () => {
    expect(clampTrim({ start: -5, end: 99 }, 60)).toEqual({ start: 0, end: 60 });
    expect(clampTrim({ start: 59.99, end: 60 }, 60)).toEqual({ start: 59.8, end: 60 });
    expect(clampTrim({ start: 30, end: 10 }, 60).end).toBeGreaterThan(30);
    expect(clampTrim({ start: 1, end: 2 }, 0.1)).toEqual({ start: 0, end: 0.1 });
  });
  it("formats times", () => {
    expect([formatTime(5), formatTime(65), formatTime(3723), formatTime(-3)]).toEqual(["0:05", "1:05", "1:02:03", "0:00"]);
  });
});
