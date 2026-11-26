// The geometry of the capture overlay, all in PHYSICAL pixels of the overlay's monitor (the unit of the frozen screenshot
// and of every rectangle the backend uses). The page measures the pointer in CSS pixels; with display scaling of 150 % a
// CSS pixel is 1.5 physical pixels. Instead of trusting a scale factor, the ratio of the screenshot's size to the page's
// viewport is used, which stays right when two monitors have different scaling or the two sizes differ by a rounded pixel.
//
// Pure functions only (no DOM), so every case is unit tested.

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

export type CaptureModeId = "rectangle" | "window" | "fullscreen" | "freeform" | "scrolling";
export const MODE_ORDER: CaptureModeId[] = ["rectangle", "window", "fullscreen", "freeform", "scrolling"];

/** A selection smaller than this (physical pixels, either side) is an accident. */
export const MIN_SELECTION = 4;

/** Physical pixels per CSS pixel, horizontally and vertically. */
export function pixelRatio(image: Size, viewport: Size): Pt {
  if (viewport.w <= 0 || viewport.h <= 0) return { x: 1, y: 1 };
  return { x: image.w / viewport.w, y: image.h / viewport.h };
}

export function toPhysical(css: Pt, ratio: Pt): Pt {
  return { x: css.x * ratio.x, y: css.y * ratio.y };
}

export function boxToCss(b: Box, ratio: Pt): Box {
  return { x: b.x / ratio.x, y: b.y / ratio.y, w: b.w / ratio.x, h: b.h / ratio.y };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The rectangle between two points (a drag in any direction), kept inside the monitor, in whole pixels. */
export function dragBox(a: Pt, b: Pt, bounds: Size): Box | null {
  const x0 = Math.round(clamp(Math.min(a.x, b.x), 0, bounds.w));
  const x1 = Math.round(clamp(Math.max(a.x, b.x), 0, bounds.w));
  const y0 = Math.round(clamp(Math.min(a.y, b.y), 0, bounds.h));
  const y1 = Math.round(clamp(Math.max(a.y, b.y), 0, bounds.h));
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return box.w >= MIN_SELECTION && box.h >= MIN_SELECTION ? box : null;
}

/** "640 × 360": the size of a selection in physical pixels. */
export function sizeLabel(box: Pick<Box, "w" | "h">): string {
  return `${Math.round(box.w)} × ${Math.round(box.h)}`;
}

export interface WinInfo {
  hwnd: number;
  title: string;
  /** Desktop physical pixels. */
  rect: Box;
}

/** The topmost window under a point of the virtual desktop. `windows` is in z-order, topmost first. */
export function hitTestWindow(windows: readonly WinInfo[], desktop: Pt): WinInfo | null {
  return (
    windows.find(
      (w) =>
        desktop.x >= w.rect.x &&
        desktop.x < w.rect.x + w.rect.w &&
        desktop.y >= w.rect.y &&
        desktop.y < w.rect.y + w.rect.h,
    ) ?? null
  );
}

/** A point of this monitor's screenshot on the virtual desktop. */
export function toDesktop(local: Pt, monitor: Pt): Pt {
  return { x: local.x + monitor.x, y: local.y + monitor.y };
}

/** A window's rectangle relative to this monitor (it may reach beyond the monitor's edges). */
export function windowToLocal(win: WinInfo, monitor: Pt): Box {
  return { x: win.rect.x - monitor.x, y: win.rect.y - monitor.y, w: win.rect.w, h: win.rect.h };
}

/** The part of a box that is on the monitor (what is drawn as the highlight). */
export function clipToMonitor(box: Box, monitor: Size): Box | null {
  const x0 = Math.max(box.x, 0);
  const y0 = Math.max(box.y, 0);
  const x1 = Math.min(box.x + box.w, monitor.w);
  const y1 = Math.min(box.y + box.h, monitor.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Keys 1 to 5 choose a mode. */
export function modeForKey(key: string): CaptureModeId | null {
  const i = ["1", "2", "3", "4", "5"].indexOf(key);
  return i >= 0 ? MODE_ORDER[i] : null;
}

/** The lasso without needless points: a new point is kept when it is at least `minDistance` from the last one kept. */
export function thin(points: readonly Pt[], minDistance: number): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) out.push(p);
  }
  return out;
}

/** Where the size readout goes: below the selection's right end, above it when there is no room below, else inside. */
export function readoutPosition(box: Box, label: Size, viewport: Size, gap = 8): Pt {
  const fitsBelow = box.y + box.h + gap + label.h <= viewport.h;
  const fitsAbove = box.y - gap - label.h >= 0;
  const y = fitsBelow
    ? box.y + box.h + gap
    : fitsAbove
      ? box.y - gap - label.h
      : box.y + box.h - label.h - gap;
  const x = clamp(box.x + box.w - label.w, 0, Math.max(viewport.w - label.w, 0));
  return { x, y: Math.max(y, 0) };
}

/** Where the magnifier goes (CSS pixels): down and to the right of the pointer, flipped to stay on the screen. */
export function loupePlacement(pointer: Pt, size: number, viewport: Size, gap = 24): Pt {
  let x = pointer.x + gap;
  let y = pointer.y + gap;
  if (x + size > viewport.w) x = pointer.x - gap - size;
  if (y + size > viewport.h) y = pointer.y - gap - size;
  return { x: clamp(x, 0, Math.max(viewport.w - size, 0)), y: clamp(y, 0, Math.max(viewport.h - size, 0)) };
}

/** The square of the screenshot the magnifier shows: `cells` pixels on a side, centered on the pointer, clamped. */
export function loupeSource(pointerPhysical: Pt, cells: number, image: Size): Box {
  const half = Math.floor(cells / 2);
  const x = clamp(Math.floor(pointerPhysical.x) - half, 0, Math.max(image.w - cells, 0));
  const y = clamp(Math.floor(pointerPhysical.y) - half, 0, Math.max(image.h - cells, 0));
  return { x, y, w: cells, h: cells };
}
