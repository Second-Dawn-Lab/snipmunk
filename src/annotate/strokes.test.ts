import { describe, expect, it } from "vitest";
import { centreLine, dedupe, radiusAt, smooth, straighten, strokeOutline } from "./strokes";

const line = (n: number, step = 5, p = 0.5): number[] => Array.from({ length: n }, (_, i) => [i * step, 0, p]).flat();

function bbox(poly: number[]) {
  const xs = poly.filter((_, i) => i % 2 === 0);
  const ys = poly.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe("smoothing", () => {
  it("keeps the ends and evens out the bumps", () => {
    const rough = [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5, 30, 10, 0.5, 40, 0, 0.5];
    const s = smooth(rough, 1);
    expect(s.slice(0, 3)).toEqual(rough.slice(0, 3));
    expect(s.slice(-3)).toEqual(rough.slice(-3));
    expect(s[4]).toBeLessThan(10);
    expect(s[7]).toBeGreaterThan(0);
  });
  it("leaves one or two points alone", () => {
    expect(smooth([1, 2, 0.5])).toEqual([1, 2, 0.5]);
    expect(smooth([1, 2, 0.5, 3, 4, 0.5])).toEqual([1, 2, 0.5, 3, 4, 0.5]);
  });
  it("drops samples on top of each other and keeps the strongest pressure", () => {
    expect(dedupe([0, 0, 0.2, 0.1, 0.1, 0.9, 5, 5, 0.5])).toEqual([0, 0, 0.9, 5, 5, 0.5]);
  });
});

describe("the outline of a pen stroke", () => {
  it("is nothing for no points and a dot for one", () => {
    expect(strokeOutline([], 8)).toEqual([]);
    const dot = bbox(strokeOutline([50, 50, 0.5], 10));
    expect(dot.x1 - dot.x0).toBeCloseTo(10, 0);
    expect(dot.y1 - dot.y0).toBeCloseTo(10, 0);
  });

  it("is as wide as the pen for a straight stroke, with round caps", () => {
    const b = bbox(strokeOutline(line(40), 10));
    expect(b.y1 - b.y0).toBeGreaterThan(9);
    expect(b.y1 - b.y0).toBeLessThanOrEqual(10.01);
    // The caps reach about one radius past the first and the last sample, never much further.
    expect(b.x0).toBeGreaterThan(-6);
    expect(b.x0).toBeLessThan(0);
    expect(b.x1).toBeGreaterThan(195);
    expect(b.x1).toBeLessThan(201);
  });

  it("follows the pressure of a pen", () => {
    const light = bbox(strokeOutline(line(40, 5, 0.1), 10));
    const hard = bbox(strokeOutline(line(40, 5, 1), 10));
    expect(hard.y1 - hard.y0).toBeGreaterThan((light.y1 - light.y0) * 1.8);
    expect(radiusAt(10, 0.5)).toBe(5);
    expect(radiusAt(10, 2)).toBe(7.5);
    expect(radiusAt(10, -1)).toBe(2.5);
  });

  it("tapers at the ends", () => {
    const poly = strokeOutline(line(40), 20);
    // Samples near the start are narrower than in the middle: the polygon's first left point is closer to the line.
    expect(Math.abs(poly[1])).toBeLessThan(10);
    expect(Math.abs(poly[1])).toBeGreaterThan(3);
  });

  it("is a polygon with finite coordinates for a very short stroke and for repeated points", () => {
    for (const pts of [[0, 0, 0.5, 1, 0, 0.5], [3, 3, 0.5, 3, 3, 0.5, 3, 3, 0.5], line(3, 0.2)]) {
      const poly = strokeOutline(pts, 6);
      expect(poly.length).toBeGreaterThanOrEqual(6);
      expect(poly.every(Number.isFinite)).toBe(true);
    }
  });

  it("winds one way: the polygon's area is not cancelled out by the caps", () => {
    const poly = strokeOutline(line(30), 10);
    let area = 0;
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      area += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
    }
    // About length x width = 145 x 10, a bit less for the taper; far from 0.
    expect(Math.abs(area / 2)).toBeGreaterThan(1000);
  });
});

describe("the highlighter's centre line", () => {
  it("is pairs of x and y", () => {
    expect(centreLine(line(4))).toHaveLength(8);
  });
});

describe("a straight stroke (Shift)", () => {
  it("runs from the first to the last sample", () => {
    const s = straighten([0, 0, 0.5, 30, 41, 0.5, 100, 20, 0.5]);
    expect(s.slice(0, 2)).toEqual([0, 0]);
    expect(s.slice(-3, -1)).toEqual([100, 20]);
    for (let i = 0; i + 5 < s.length; i += 3) expect((s[i + 4] - s[i + 1]) / (s[i + 3] - s[i])).toBeCloseTo(0.2);
  });
  it("can snap to 45 degrees", () => {
    const s = straighten([0, 0, 0.5, 100, 40, 0.5], true);
    expect(s[s.length - 2]).toBeCloseTo(0, 5);
    expect(s[s.length - 3]).toBeCloseTo(Math.hypot(100, 40), 5);
    const d = straighten([0, 0, 0.5, 100, 90, 0.5], true);
    expect(d[d.length - 3]).toBeCloseTo(d[d.length - 2], 5);
  });
  it("leaves a single point alone", () => {
    expect(straighten([5, 5, 0.5])).toEqual([5, 5, 0.5]);
  });
});
