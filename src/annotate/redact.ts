// Redaction: pixels are replaced, not covered. These functions overwrite the pixels of an area with a pixelated, blurred or
// black version computed from them, so the final picture (and anything copied or exported from it) no longer holds the
// original values; nothing here is a CSS effect or an overlay that could be taken away again. (No React, no canvas.)
import type { RedactMode, Rect } from "./schema";

/** The part of an `ImageData` the functions use, so they run on plain arrays in tests. */
export interface PixelBuffer {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
}

/** The area as whole pixels inside a picture of `width` x `height`; `null` when nothing is left. */
export function clampArea(area: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(area.x));
  const y0 = Math.max(0, Math.floor(area.y));
  const x1 = Math.min(width, Math.ceil(area.x + area.w));
  const y1 = Math.min(height, Math.ceil(area.y + area.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The size of a pixelation block for an area: big enough that text is unreadable whatever its size. */
export function blockSize(w: number, h: number): number {
  return Math.max(10, Math.round(Math.min(w, h) / 6));
}

/** The radius of the blur for an area. */
export function blurRadius(w: number, h: number): number {
  return Math.max(8, Math.round(Math.min(w, h) / 4));
}

/** Every block of `block` x `block` pixels becomes the average colour of that block. */
export function pixelate(img: PixelBuffer, area: Rect, block: number): void {
  const d = img.data;
  const b = Math.max(2, Math.floor(block));
  for (let by = area.y; by < area.y + area.h; by += b) {
    for (let bx = area.x; bx < area.x + area.w; bx += b) {
      const x1 = Math.min(bx + b, area.x + area.w);
      const y1 = Math.min(by + b, area.y + area.h);
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      let n = 0;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          r += d[i];
          g += d[i + 1];
          bl += d[i + 2];
          a += d[i + 3];
          n++;
        }
      }
      const avg = [Math.round(r / n), Math.round(g / n), Math.round(bl / n), Math.round(a / n)];
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          d[i] = avg[0];
          d[i + 1] = avg[1];
          d[i + 2] = avg[2];
          d[i + 3] = avg[3];
        }
      }
    }
  }
}

/** A strong blur of the area (three box blurs, which come close to a Gaussian). Only pixels of the area are read. */
export function blur(img: PixelBuffer, area: Rect, radius: number): void {
  const w = area.w;
  const h = area.h;
  const r = Math.max(1, Math.floor(radius));
  // Work on a copy of the area, one channel at a time, so the blur never reads pixels it has already changed.
  for (let ch = 0; ch < 4; ch++) {
    let a = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) a[y * w + x] = img.data[((area.y + y) * img.width + area.x + x) * 4 + ch];
    }
    let tmp = new Float32Array(w * h);
    for (let pass = 0; pass < 3; pass++) {
      boxBlurLine(a, tmp, w, h, r, true);
      boxBlurLine(tmp, a, w, h, r, false);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) img.data[((area.y + y) * img.width + area.x + x) * 4 + ch] = Math.round(a[y * w + x]);
    }
    tmp = a = new Float32Array(0);
  }
}

/** One box blur pass along rows (`horizontal`) or columns; the edge pixel repeats beyond the area. */
function boxBlurLine(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const lineStep = horizontal ? w : 1;
  const size = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + Math.min(len - 1, Math.max(0, k)) * stride];
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = sum / size;
      sum += src[base + Math.min(len - 1, i + r + 1) * stride] - src[base + Math.max(0, i - r) * stride];
    }
  }
}

/** The area becomes opaque black. */
export function blackOut(img: PixelBuffer, area: Rect): void {
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
}

/** Redact `area` of `img` in place. Returns false when the area is outside the picture. */
export function redact(img: PixelBuffer, area: Rect, mode: RedactMode): boolean {
  const a = clampArea(area, img.width, img.height);
  if (!a) return false;
  if (mode === "box") blackOut(img, a);
  else if (mode === "blur") blur(img, a, blurRadius(a.w, a.h));
  else pixelate(img, a, blockSize(a.w, a.h));
  return true;
}
