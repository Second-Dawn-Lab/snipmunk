import { describe, expect, it } from "vitest";
import { activeClicks, burstShape, clickMax, haloRadius, rippleShape } from "./drawFx";
import { effectsFromSettings, readEffects, trimRange, webcamCentre } from "./effects";
import { defaultSettings } from "../settings/defaults";

describe("click effects", () => {
  const clicks = [
    { t: 1, x: 10, y: 20, button: "left" as const },
    { t: 3, x: 30, y: 40, button: "right" as const },
  ];
  it("show for 0.6 s after the press and not before or after", () => {
    expect(activeClicks(clicks, 0.9)).toEqual([]);
    const a = activeClicks(clicks, 1.3);
    expect(a).toHaveLength(1);
    expect(a[0]!.age).toBeCloseTo(0.5);
    expect(activeClicks(clicks, 1.7)).toEqual([]);
  });

  it("a ripple grows and fades; a burst has eight lines that move out", () => {
    const early = rippleShape(40, 0.1);
    const late = rippleShape(40, 0.9);
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.fade).toBeLessThan(early.fade);
    const b = burstShape(40, 0.5);
    expect(b.angles).toHaveLength(8);
    expect(b.to).toBeGreaterThan(b.from);
  });

  it("are sized from the height of the video", () => {
    expect(clickMax(1000, "small")).toBeLessThan(clickMax(1000, "large"));
    expect(haloRadius(1000, "2")).toBe(2 * haloRadius(1000, "1"));
  });
});

describe("effects", () => {
  const base = effectsFromSettings(defaultSettings);
  it("start from the settings and read back with bad values replaced", () => {
    expect(base.click.kind).toBe("ripple");
    const e = readEffects({ cursor: { size: "9", halo: true, haloColor: "nope" }, trim: { startMs: 500, endMs: 100 }, webcam: { x: 4 } }, base);
    expect(e.cursor.size).toBe("1");
    expect(e.cursor.halo).toBe(true);
    expect(e.cursor.haloColor).toBe(base.cursor.haloColor);
    expect(e.trim).toEqual({ startMs: 500, endMs: null });
    expect(e.webcam.x).toBe(1);
    expect(readEffects(null, base)).toEqual(base);
  });

  it("trim ranges stay inside the recording and the webcam sits in its corner", () => {
    expect(trimRange({ startMs: 1000, endMs: 4000 }, 10)).toEqual([1, 4]);
    expect(trimRange({ startMs: 0, endMs: null }, 10)).toEqual([0, 10]);
    expect(trimRange({ startMs: 20000, endMs: 30000 }, 10)).toEqual([10, 10]);
    const c = webcamCentre({ ...base.webcam, position: "top-left" }, 0.2, 1);
    expect(c.x).toBeLessThan(0.2);
    expect(c.y).toBeLessThan(0.3);
    expect(webcamCentre({ ...base.webcam, position: "free", x: 0.3, y: 0.4 }, 0.2, 1)).toEqual({ x: 0.3, y: 0.4 });
  });
});
