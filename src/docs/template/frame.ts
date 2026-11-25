// The picture frame (no React): which part of a step's picture the frame shows. Everything is in the pixels of the step's
// picture. The same rules as `framed_area` in src-tauri/src/snpd.rs, which decides what a saved file keeps.

import type { Rect } from "../model";

/** A step's own place in the frame: the centre of the shown part and its width (its height follows the frame's ratio). */
export interface StepFrame {
  cx: number;
  cy: number;
  w: number;
  /** Set for a guide without a frame ("Original"): a zoom inside the picture, in the picture's own shape. */
  own?: boolean;
}

/**
 * The part the frame shows (it can be larger than the picture: the rest is padding in the template's background colour).
 * A part that fits inside the picture is moved inside it, so the frame is filled with real screen content; where it is larger
 * than the picture it is centred on that axis.
 */
export function frameSource(frame: StepFrame, ratio: number, size: [number, number]): Rect {
  const [iw, ih] = size;
  const w = Math.max(16, frame.w);
  const h = w / ratio;
  const place = (centre: number, len: number, max: number) => (len <= max ? Math.max(0, Math.min(max - len, centre - len / 2)) : (max - len) / 2);
  return [Math.round(place(frame.cx, w, iw)), Math.round(place(frame.cy, h, ih)), Math.round(w), Math.round(h)];
}

/** The narrowest part a zoom goes down to (picture pixels). */
const MIN_WIDTH = 40;

/** Without a frame: the part of the shown area `area` (in its own shape) that a zoom shows; it never leaves the area. */
export function areaSource(frame: StepFrame, area: Rect): Rect {
  const [x, y, aw, ah] = area;
  const w = Math.max(Math.min(MIN_WIDTH, aw), Math.min(aw, frame.w));
  const h = (w * ah) / aw;
  const place = (centre: number, len: number, from: number, room: number) => Math.max(from, Math.min(from + room - len, centre - len / 2));
  return [Math.round(place(frame.cx, w, x, aw)), Math.round(place(frame.cy, h, y, ah)), Math.round(w), Math.max(1, Math.round(h))];
}

/** Fill: the frame is filled with the shown area and the real context around it (grown to the ratio, then limited to the picture). */
export function fillFrame(view: Rect, ratio: number, size: [number, number]): StepFrame {
  const [x, y, w, h] = view;
  const grown = Math.max(w, h * ratio);
  const most = Math.min(size[0], size[1] * ratio);
  return { cx: x + w / 2, cy: y + h / 2, w: Math.min(grown, most) };
}

/** Fit: the whole shown area is visible (padding where the screen ends). */
export function fitFrame(view: Rect, ratio: number): StepFrame {
  const [x, y, w, h] = view;
  return { cx: x + w / 2, cy: y + h / 2, w: Math.max(w, h * ratio) };
}

/** The part of the source that is inside the picture. */
export function clipToPicture(r: Rect, size: [number, number]): Rect {
  const x = Math.max(0, r[0]);
  const y = Math.max(0, r[1]);
  return [x, y, Math.max(1, Math.min(size[0], r[0] + r[2]) - x), Math.max(1, Math.min(size[1], r[1] + r[3]) - y)];
}

/** How far a step's picture can be zoomed: the widths of the widest and the closest part. 100% is `fit` wide. */
export interface ZoomRange {
  fit: number;
  widest: number;
  narrowest: number;
}

/** A zoom value in percent (100: the whole shown area, the Fit width). */
export const zoomPercent = (width: number, range: ZoomRange): number => Math.round((range.fit / width) * 100);

/** The place of a width on a slider from 0 (widest) to 100 (closest); equal steps zoom by equal factors. */
export function sliderOf(width: number, range: ZoomRange): number {
  const whole = Math.log(range.narrowest / range.widest);
  return whole === 0 ? 0 : Math.round(Math.max(0, Math.min(1, Math.log(width / range.widest) / whole)) * 100);
}

export const widthAt = (slider: number, range: ZoomRange): number => Math.round(range.widest * (range.narrowest / range.widest) ** (Math.max(0, Math.min(100, slider)) / 100));

/** Zoom by a factor (above 1: closer) around the centre, within the range. */
export function zoomFrame(f: StepFrame, factor: number, range: ZoomRange): StepFrame {
  return { ...f, w: Math.max(range.narrowest, Math.min(range.widest, f.w / factor)) };
}
