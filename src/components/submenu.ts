// Where a submenu flyout opens, and when moving the pointer must not close it (no React, so it can be unit tested).

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The time the pointer must rest on a submenu entry before its flyout opens, and the grace before one closes. */
export const OPEN_DELAY = 300;

export interface FlyoutInput {
  /** The entry that opens the flyout, in viewport coordinates. */
  parent: Rect;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  rtl: boolean;
  margin?: number;
  /** How far the flyout overlaps its parent menu, so the two touch. */
  overlap?: number;
}

export interface FlyoutPlacement {
  left: number;
  top: number;
  /** Which side of the parent entry the flyout is on. */
  side: "right" | "left";
  maxHeight: number;
}

/**
 * The flyout opens beside its entry: to the right in left-to-right layouts and to the left in right-to-left ones. When there
 * is no room it flips to the other side (and is kept inside the window when neither side fits); it lines up with the top
 * of its entry and shifts up when it would run out of the bottom of the window.
 */
export function placeFlyout(input: FlyoutInput): FlyoutPlacement {
  const { parent, panel, viewport, rtl, margin = 8, overlap = 4 } = input;
  const maxHeight = Math.max(80, viewport.height - 2 * margin);
  const height = Math.min(panel.height, maxHeight);
  const rightX = parent.right - overlap;
  const leftX = parent.left - panel.width + overlap;
  const fitsRight = rightX + panel.width <= viewport.width - margin;
  const fitsLeft = leftX >= margin;
  let side: "right" | "left" = rtl ? "left" : "right";
  if (side === "right" && !fitsRight && fitsLeft) side = "left";
  else if (side === "left" && !fitsLeft && fitsRight) side = "right";
  const ideal = side === "right" ? rightX : leftX;
  const left = Math.min(Math.max(ideal, margin), Math.max(margin, viewport.width - margin - panel.width));
  let top = parent.top - 4;
  if (top + height > viewport.height - margin) top = viewport.height - margin - height;
  top = Math.max(margin, top);
  return { left, top, side, maxHeight };
}

/** Is the point inside the triangle a, b, c? */
export function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * The "safe triangle": while the pointer travels from where it was (`from`) towards the open flyout it may cross other
 * entries of the menu on the way; as long as it stays inside the triangle between `from` and the near edge of the flyout,
 * the flyout stays open. `current` is the pointer now.
 */
export function inSafeTriangle(from: Point, current: Point, flyout: Rect, side: "right" | "left"): boolean {
  const edgeX = side === "right" ? flyout.left : flyout.right;
  return inTriangle(current, from, { x: edgeX, y: flyout.top }, { x: edgeX, y: flyout.bottom });
}

export function insideRect(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/** What a key does at an entry that has a flyout: open it, or (inside the flyout) close it and go back to the entry. */
export function submenuKey(key: string, rtl: boolean): "open" | "close" | null {
  const opens = rtl ? "ArrowLeft" : "ArrowRight";
  const closes = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === opens) return "open";
  if (key === closes) return "close";
  return null;
}
