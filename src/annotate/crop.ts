// The crop frame (no React): moving and resizing it with the handles, with an optional aspect ratio, inside the picture.
import type { Rect } from "./schema";

export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/** The aspect presets of the crop tool; `null` is free. Ratios are width / height of the picture as it is shown. */
export const ASPECTS = [
  { id: "free", ratio: null },
  { id: "1:1", ratio: 1 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "16:9", ratio: 16 / 9 },
] as const;

export type AspectId = (typeof ASPECTS)[number]["id"];

export const MIN_CROP = 8;

export function clampRect(r: Rect, bounds: { w: number; h: number }): Rect {
  const w = Math.min(Math.max(r.w, 1), bounds.w);
  const h = Math.min(Math.max(r.h, 1), bounds.h);
  return { x: Math.min(Math.max(r.x, 0), bounds.w - w), y: Math.min(Math.max(r.y, 0), bounds.h - h), w, h };
}

/** The frame moved by (dx, dy), kept inside the picture. */
export function moveFrame(r: Rect, dx: number, dy: number, bounds: { w: number; h: number }): Rect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy }, bounds);
}

/** The largest frame of `ratio` that fits in `r`, centred in it. */
export function fitAspect(r: Rect, ratio: number, bounds: { w: number; h: number }): Rect {
  let w = r.w;
  let h = w / ratio;
  if (h > r.h) {
    h = r.h;
    w = h * ratio;
  }
  return clampRect({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }, bounds);
}

/**
 * The frame after dragging `handle` by (dx, dy) from `start`. The opposite side stays put; the frame stays inside the
 * picture and at least `MIN_CROP` big. With a `ratio` the frame keeps it: corners follow the pointer, sides grow around
 * the middle of the opposite side.
 */
export function resizeFrame(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
  ratio: number | null,
): Rect {
  if (handle === "move") return moveFrame(start, dx, dy, bounds);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = Math.min(Math.max(0, left + dx), right - MIN_CROP);
  if (handle.includes("e")) right = Math.max(Math.min(bounds.w, right + dx), left + MIN_CROP);
  if (handle.includes("n")) top = Math.min(Math.max(0, top + dy), bottom - MIN_CROP);
  if (handle.includes("s")) bottom = Math.max(Math.min(bounds.h, bottom + dy), top + MIN_CROP);
  if (ratio === null) return { x: left, y: top, w: right - left, h: bottom - top };

  const corner = handle.length === 2;
  let w = right - left;
  let h = bottom - top;
  if (corner) {
    // The corner follows the pointer: take the size from the larger change.
    if (w / ratio >= h) h = w / ratio;
    else w = h * ratio;
    const x = handle.includes("w") ? start.x + start.w - w : start.x;
    const y = handle.includes("n") ? start.y + start.h - h : start.y;
    return fitInside({ x, y, w, h }, handle, start, bounds, ratio);
  }
  if (handle === "e" || handle === "w") {
    h = w / ratio;
    const cy = start.y + start.h / 2;
    const x = handle === "w" ? right - w : left;
    return fitInside({ x, y: cy - h / 2, w, h }, handle, start, bounds, ratio);
  }
  w = h * ratio;
  const cx = start.x + start.w / 2;
  const y = handle === "n" ? bottom - h : top;
  return fitInside({ x: cx - w / 2, y, w, h }, handle, start, bounds, ratio);
}

/** Shrink a frame that grew out of the picture, keeping its ratio and the side that stays put. */
function fitInside(r: Rect, handle: CropHandle, start: Rect, bounds: { w: number; h: number }, ratio: number): Rect {
  let { x, y, w, h } = r;
  const over = (a: number) => Math.max(0, a);
  const growW = over(-x) + over(x + w - bounds.w);
  const growH = over(-y) + over(y + h - bounds.h);
  if (growW > 0 || growH > 0) {
    const scaleW = (w - growW) / w;
    const scaleH = (h - growH) / h;
    const s = Math.max(Math.min(scaleW, scaleH), MIN_CROP / Math.max(w, h));
    const nw = w * s;
    const nh = nw / ratio;
    // Keep the anchored side where it was.
    const anchorX = handle.includes("w") ? start.x + start.w : handle.includes("e") ? start.x : x + w / 2;
    const anchorY = handle.includes("n") ? start.y + start.h : handle.includes("s") ? start.y : y + h / 2;
    x = handle.includes("w") ? anchorX - nw : handle.includes("e") ? anchorX : anchorX - nw / 2;
    y = handle.includes("n") ? anchorY - nh : handle.includes("s") ? anchorY : anchorY - nh / 2;
    w = nw;
    h = nh;
  }
  return clampRect({ x, y, w, h }, bounds);
}

/** Which handle of a frame is at a point (radius in the same units), the inside being "move". */
export function cropHandleAt(frame: Rect, p: { x: number; y: number }, radius: number): CropHandle | null {
  const near = (v: number, target: number) => Math.abs(v - target) <= radius;
  const l = near(p.x, frame.x);
  const r = near(p.x, frame.x + frame.w);
  const t = near(p.y, frame.y);
  const b = near(p.y, frame.y + frame.h);
  const inX = p.x >= frame.x - radius && p.x <= frame.x + frame.w + radius;
  const inY = p.y >= frame.y - radius && p.y <= frame.y + frame.h + radius;
  if (t && l) return "nw";
  if (t && r) return "ne";
  if (b && l) return "sw";
  if (b && r) return "se";
  if (t && inX) return "n";
  if (b && inX) return "s";
  if (l && inY) return "w";
  if (r && inY) return "e";
  if (p.x > frame.x && p.x < frame.x + frame.w && p.y > frame.y && p.y < frame.y + frame.h) return "move";
  return null;
}
