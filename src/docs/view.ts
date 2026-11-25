// The editor's view (no React): auto-scroll while a block is dragged near an edge of the list, and the page width and zoom.

/** The zone at the top and the bottom of the list in which a drag scrolls it, and how far outside the list it still does. */
export const EDGE_ZONE = 90;
export const EDGE_OUTSIDE = 70;
/** The fastest scroll, in pixels per animation frame. */
export const EDGE_SPEED = 28;

/**
 * How fast the list scrolls for a drag at the height `y`: negative up, positive down, 0 outside the edge zones. The speed grows
 * the closer the pointer is to the edge (and stays at the maximum just outside it); far outside the list nothing moves.
 */
export function edgeSpeed(y: number, top: number, bottom: number): number {
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 2);
  const speed = (depth: number) => Math.max(1, Math.round(EDGE_SPEED * Math.min(1, depth / zone) ** 2));
  if (y < top + zone) return y < top - EDGE_OUTSIDE ? 0 : -speed(top + zone - y);
  if (y > bottom - zone) return y > bottom + EDGE_OUTSIDE ? 0 : speed(y - (bottom - zone));
  return 0;
}

export const PAGE_WIDTHS = ["narrow", "normal", "wide", "fit"] as const;
export type PageWidth = (typeof PAGE_WIDTHS)[number];
/** The width of the column in the editor ("fit": the whole editor). */
export const PAGE_PIXELS: Record<PageWidth, number | null> = { narrow: 680, normal: 920, wide: 1280, fit: null };

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;

/** A zoom value inside its range, in steps of 10 for the wheel and the buttons. */
export const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(Number.isFinite(z) ? z : 100)));

/** How the editor's pages are sized: "auto" is 100%, smaller where the page does not fit the width; "width" and "page" fill the
 * width or show a whole page; "none" is the chosen percentage. */
export const PAGE_FITS = ["auto", "width", "page", "none"] as const;
export type PageFit = (typeof PAGE_FITS)[number];
/** The room kept free at the sides (and above and below a whole page). */
export const PAGE_ROOM = 28;

/** The scale of the pages; `room` is the view, `sheet` one page at 100%. */
export function pageScale(fit: PageFit, zoom: number, room: { w: number; h: number }, sheet: { w: number; h: number }): number {
  if (fit === "none" || room.w <= 0) return (fit === "none" ? clampZoom(zoom) : 100) / 100;
  const wide = (room.w - PAGE_ROOM) / sheet.w;
  const scale = fit === "auto" ? Math.min(1, wide) : fit === "width" ? wide : Math.min(wide, (room.h - PAGE_ROOM) / sheet.h);
  return Math.max(0.2, Math.min(ZOOM_MAX / 100, scale));
}

/** The next zoom step up (`1`) or down (`-1`). */
export const stepZoom = (z: number, dir: 1 | -1): number => clampZoom((dir > 0 ? Math.floor(z / 10) + 1 : Math.ceil(z / 10) - 1) * 10);
