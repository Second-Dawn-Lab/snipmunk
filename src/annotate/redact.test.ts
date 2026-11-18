import { describe, expect, it } from "vitest";
import { blackOut, blockSize, blur, blurRadius, clampArea, pixelate, redact, type PixelBuffer } from "./redact";

/** A picture of noise: every pixel different, so any pixel that survives is easy to tell. */
function noise(width: number, height: number, seed = 1): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = i % 4 === 3 ? 255 : s >>> 24;
  }
  return { width, height, data };
}

const clone = (b: PixelBuffer): PixelBuffer => ({ ...b, data: new Uint8ClampedArray(b.data) });

/** The share of pixels in `area` whose colour is exactly what it was. */
function unchanged(before: PixelBuffer, after: PixelBuffer, area: { x: number; y: number; w: number; h: number }): number {
  let same = 0;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const i = (y * before.width + x) * 4;
      if (before.data[i] === after.data[i] && before.data[i + 1] === after.data[i + 1] && before.data[i + 2] === after.data[i + 2]) same++;
    }
  }
  return same / (area.w * area.h);
}

const area = { x: 20, y: 10, w: 80, h: 50 };

describe("redacting destroys the pixels", () => {
  for (const mode of ["pixelate", "blur", "box"] as const) {
    it(`${mode}: the original pixels are gone from the area`, () => {
      const before = noise(160, 100);
      const after = clone(before);
      expect(redact(after, area, mode)).toBe(true);
      expect(unchanged(before, after, area)).toBeLessThan(0.03);
    });

    it(`${mode}: pixels outside the area are not touched`, () => {
      const before = noise(160, 100);
      const after = clone(before);
      redact(after, area, mode);
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 160; x++) {
          if (x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h) continue;
          const i = (y * 160 + x) * 4;
          expect(after.data[i]).toBe(before.data[i]);
          expect(after.data[i + 2]).toBe(before.data[i + 2]);
        }
      }
    });
  }

  it("the black box is opaque black", () => {
    const img = noise(40, 40);
    blackOut(img, { x: 5, y: 5, w: 10, h: 10 });
    expect([...img.data.slice((5 * 40 + 5) * 4, (5 * 40 + 5) * 4 + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("pixelation turns every block into one colour, the average of the block", () => {
    const img = noise(64, 64);
    const before = clone(img);
    pixelate(img, { x: 0, y: 0, w: 64, h: 64 }, 16);
    const at = (x: number, y: number) => [...img.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
    expect(at(0, 0)).toEqual(at(15, 15));
    expect(at(16, 0)).toEqual(at(31, 15));
    expect(at(0, 0)).not.toEqual(at(16, 0));
    // The average: the sum of the red values of a block is the same before and after (up to rounding).
    let sumBefore = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) sumBefore += before.data[(y * 64 + x) * 4];
    expect(Math.abs(at(3, 3)[0] - sumBefore / 256)).toBeLessThanOrEqual(1);
  });

  it("a blur of an area never reads outside it", () => {
    const img = noise(60, 40);
    // A bright frame around the area: if the blur read it, the area would lighten.
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) if (x < 10 || x >= 50 || y < 10 || y >= 30) img.data.fill(255, (y * 60 + x) * 4, (y * 60 + x) * 4 + 3);
    const inner = { x: 10, y: 10, w: 40, h: 20 };
    blur(img, inner, 6);
    let mean = 0;
    for (let y = 10; y < 30; y++) for (let x = 10; x < 50; x++) mean += img.data[(y * 60 + x) * 4];
    mean /= 40 * 20;
    expect(mean).toBeGreaterThan(100);
    expect(mean).toBeLessThan(160);
  });

  it("a large area is not left readable by a small block or radius", () => {
    expect(blockSize(300, 20)).toBeGreaterThanOrEqual(10);
    expect(blockSize(800, 600)).toBeGreaterThanOrEqual(100);
    expect(blurRadius(300, 20)).toBeGreaterThanOrEqual(8);
  });

  it("an area outside the picture does nothing and says so", () => {
    const img = noise(20, 20);
    const before = clone(img);
    expect(redact(img, { x: 100, y: 100, w: 10, h: 10 }, "box")).toBe(false);
    expect(img.data).toEqual(before.data);
  });

  it("is clamped to the picture", () => {
    expect(clampArea({ x: -10, y: -10, w: 30, h: 30 }, 100, 100)).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(clampArea({ x: 90.4, y: 0, w: 50, h: 5.2 }, 100, 100)).toEqual({ x: 90, y: 0, w: 10, h: 6 });
    expect(clampArea({ x: 0, y: 0, w: 0, h: 5 }, 100, 100)).toBeNull();
  });

  it("an area of one pixel is destroyed too", () => {
    const img = noise(10, 10);
    const before = clone(img);
    redact(img, { x: 3, y: 3, w: 1, h: 1 }, "box");
    expect(img.data.slice((3 * 10 + 3) * 4, (3 * 10 + 3) * 4 + 3)).toEqual(new Uint8ClampedArray([0, 0, 0]));
    expect(before.data[(3 * 10 + 3) * 4]).not.toBe(0);
  });
});
