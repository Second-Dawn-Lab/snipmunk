// The mouse cursors of the editor canvas (no React): one per tool and per handle. Cursor images are SVG data URLs in CSS pixels
// (the browser scales them with the display), so they look right at any zoom and display scaling. None of them depends on the
// reading direction: the picture does not mirror in a right-to-left layout.
import type { HandleKind } from "./geometry";

const MAX_CURSOR = 128;

/** An SVG as a CSS cursor with its hot spot, and a keyword to fall back on. */
function svgCursor(svg: string, hotX: number, hotY: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.floor(hotX)} ${Math.floor(hotY)}, ${fallback}`;
}

/** The brush preview of the Pen and the Highlighter: a ring the size of the stroke on the screen, in the tool's colour. */
export function brushCursor(color: string, screenSize: number): string {
  const d = Math.min(MAX_CURSOR - 4, Math.max(6, Math.round(screenSize)));
  const box = d + 4;
  const c = box / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="${color}" fill-opacity="0.35" stroke="#ffffff" stroke-width="2.5"/>` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="#1b1b1b" stroke-width="1"/></svg>`;
  return svgCursor(svg, c, c, "crosshair");
}

/** The Eraser: a dashed ring. */
export function eraserCursor(screenSize = 22): string {
  const d = Math.min(MAX_CURSOR - 4, Math.max(10, Math.round(screenSize)));
  const box = d + 4;
  const c = box / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="#ffffff" fill-opacity="0.45" stroke="#ffffff" stroke-width="2.5"/>` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="#1b1b1b" stroke-width="1" stroke-dasharray="3 2"/></svg>`;
  return svgCursor(svg, c, c, "crosshair");
}

/** A thin crosshair (shapes, blur, crop): one dark line with a light edge so it shows on any picture. */
export function thinCrosshairCursor(): string {
  const s = 21;
  const c = 10.5;
  const lines = (stroke: string, w: number) =>
    `<path d="M${c} 0V${s}M0 ${c}H${s}" stroke="${stroke}" stroke-width="${w}" fill="none"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${lines("#ffffff", 3)}${lines("#1b1b1b", 1)}</svg>`;
  return svgCursor(svg, c, c, "crosshair");
}

/** The rotation handle: a circular arrow. */
export function rotateCursor(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<path d="M19 12a7 7 0 1 1-2.1-5" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M19 12a7 7 0 1 1-2.1-5" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M20.5 3v5h-5" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M20.5 3v5h-5" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return svgCursor(svg, 12, 12, "grab");
}

/** The direction of a handle on the unrotated box, in degrees on the screen (0 = right, 90 = down). */
const HANDLE_ANGLE: Readonly<Record<string, number>> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };

/**
 * The resize cursor of a handle. A rotated mark (and a rotated picture) turns its handles, so the nearest of the four resize
 * directions is used. `rotation` is in radians (the mark's), `pictureRotation` in degrees (the picture's).
 */
export function resizeCursor(kind: HandleKind, rotation = 0, pictureRotation = 0): string {
  if (kind === "rotate") return "grab";
  const base = HANDLE_ANGLE[kind];
  if (base === undefined) return "move";
  const angle = (((base + (rotation * 180) / Math.PI + pictureRotation) % 180) + 180) % 180;
  // 0 or 180: horizontal; 45: down-right to up-left; 90: vertical; 135: down-left to up-right.
  const steps = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  return steps[Math.round(angle / 45) % 4];
}
