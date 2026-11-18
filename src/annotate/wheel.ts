// The mouse wheel in the editor (no React): what a wheel event does, and smooth zoom steps.
//
// Mode "zoom" (default): the wheel zooms at the pointer, Shift + wheel pans sideways. Mode "scroll" (for touchpads, whose
// two-finger scrolling also sends wheel events): the wheel pans and Ctrl + wheel zooms. A touchpad pinch always arrives
// as Ctrl + wheel, so it zooms in both modes.

export type WheelMode = "zoom" | "scroll";

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelAction =
  /** `factor` multiplies the zoom (> 1 zooms in). */
  | { kind: "zoom"; factor: number }
  /** Move the picture by this many screen pixels (positive moves it right / down). */
  | { kind: "pan"; dx: number; dy: number };

const LINE_PIXELS = 16;
const PAGE_PIXELS = 400;

/** The delta in pixels, whatever unit the wheel reports. */
export function pixels(delta: number, mode: number): number {
  return mode === 1 ? delta * LINE_PIXELS : mode === 2 ? delta * PAGE_PIXELS : delta;
}

/** The zoom factor of a wheel delta: about 12 % for a notch of 100 pixels, proportional for smaller steps (touchpads). */
export function zoomFactor(deltaYPixels: number): number {
  const d = Math.max(-300, Math.min(300, deltaYPixels));
  return Math.exp(-d * 0.0012);
}

export function wheelAction(e: WheelInput, mode: WheelMode): WheelAction | null {
  const dx = pixels(e.deltaX, e.deltaMode);
  const dy = pixels(e.deltaY, e.deltaMode);
  if (dx === 0 && dy === 0) return null;
  if (e.ctrlKey || e.metaKey) return dy === 0 ? null : { kind: "zoom", factor: zoomFactor(dy) };
  if (e.shiftKey) {
    // Shift turns a vertical wheel into a sideways one (some systems already do that and report it in deltaX).
    const side = dx !== 0 ? dx : dy;
    return { kind: "pan", dx: -side, dy: 0 };
  }
  if (mode === "scroll") return { kind: "pan", dx: -dx, dy: -dy };
  return dy === 0 ? { kind: "pan", dx: -dx, dy: 0 } : { kind: "zoom", factor: zoomFactor(dy) };
}

/** Where a smooth zoom is heading: the target zoom, and the stage point it keeps in place. */
export interface ZoomTarget {
  zoom: number;
  x: number;
  y: number;
}

/** The time constant of the smooth zoom (milliseconds): it closes 63 % of the gap in this time. */
export const ZOOM_SMOOTHING_MS = 70;

/** One animation step towards `target`: exponential, so it does not depend on the frame rate. Snaps when close. */
export function stepZoom(current: number, target: number, dtMs: number): number {
  if (Math.abs(target - current) <= Math.abs(target) * 0.002) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / ZOOM_SMOOTHING_MS);
  // Zoom is multiplicative: move in the logarithm, so zooming in and out feel the same.
  return Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * k);
}

/** The new target after another wheel step: steps pile up from where the last one was heading. */
export function nextTarget(prev: ZoomTarget | null, current: number, factor: number, x: number, y: number, clamp: (z: number) => number): ZoomTarget {
  const base = prev ? prev.zoom : current;
  return { zoom: clamp(base * factor), x, y };
}
