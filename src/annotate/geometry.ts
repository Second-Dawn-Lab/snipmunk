// Geometry of the marks (no React, no canvas): bounds, hit testing, handles, moving, resizing, rotating and the Shift
// constraints of the shape tools. Everything is in the pixel coordinates of the original image.
import type { Annotation, Rect } from "./schema";

export interface Pt {
  x: number;
  y: number;
}

/** A rectangle turned by `rotation` radians around its centre. */
export interface Box extends Rect {
  rotation: number;
}

const HALF_PI = Math.PI / 2;

export function rotatePoint(p: Pt, center: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The distance from `p` to the segment `a`-`b`. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointsBounds(points: readonly number[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 3) {
    x0 = Math.min(x0, points[i]);
    x1 = Math.max(x1, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    y1 = Math.max(y1, points[i + 1]);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The box a mark sits in (for the handles): its own box when it has one, else the box around its points. */
export function boxOf(a: Annotation): Box {
  switch (a.type) {
    case "rect":
    case "ellipse":
    case "text":
      return { x: a.x, y: a.y, w: a.w, h: a.h, rotation: a.rotation ?? 0 };
    case "emoji":
      return { x: a.x, y: a.y, w: a.size, h: a.size, rotation: a.rotation };
    case "redact":
      return { x: a.x, y: a.y, w: a.w, h: a.h, rotation: 0 };
    case "line":
    case "arrow": {
      const x = Math.min(a.x1, a.x2);
      const y = Math.min(a.y1, a.y2);
      return { x, y, w: Math.abs(a.x1 - a.x2), h: Math.abs(a.y1 - a.y2), rotation: 0 };
    }
    case "pen":
    case "highlighter":
      return { ...pointsBounds(a.points), rotation: 0 };
  }
}

/** The four corners of a box, turned. */
export function boxCorners(b: Box): Pt[] {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ].map((p) => rotatePoint(p, c, b.rotation));
}

/** The smallest axis-aligned rectangle around a mark, ink and line width included. */
export function boundsOf(a: Annotation): Rect {
  const pad =
    a.type === "pen" || a.type === "highlighter"
      ? a.size / 2
      : a.type === "line" || a.type === "arrow"
        ? a.strokeWidth / 2 + (a.type === "arrow" ? Math.max(12, a.strokeWidth * 4) / 2 : 0)
        : a.type === "rect" || a.type === "ellipse"
          ? a.strokeWidth / 2
          : 0;
  const corners = boxCorners(boxOf(a));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export function translate<T extends Annotation>(a: T, dx: number, dy: number): T {
  switch (a.type) {
    case "line":
    case "arrow":
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "pen":
    case "highlighter": {
      const points = a.points.slice();
      for (let i = 0; i + 1 < points.length; i += 3) {
        points[i] += dx;
        points[i + 1] += dy;
      }
      return { ...a, points };
    }
    default:
      return { ...a, x: (a as { x: number }).x + dx, y: (a as { y: number }).y + dy };
  }
}

/** Is the point on the mark? `tol` is extra reach in image pixels (a thin line is hard to hit). */
export function hitTest(a: Annotation, p: Pt, tol: number): boolean {
  switch (a.type) {
    case "pen":
    case "highlighter": {
      const pts = a.points;
      const reach = a.size / 2 + tol;
      if (pts.length < 6) return distance(p, { x: pts[0], y: pts[1] }) <= reach;
      for (let i = 0; i + 5 < pts.length; i += 3) {
        if (distToSegment(p, { x: pts[i], y: pts[i + 1] }, { x: pts[i + 3], y: pts[i + 4] }) <= reach) return true;
      }
      return false;
    }
    case "line":
    case "arrow":
      return distToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= a.strokeWidth / 2 + tol + (a.type === "arrow" ? 2 : 0);
    case "rect":
    case "ellipse": {
      const b = boxOf(a);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const q = rotatePoint(p, c, -b.rotation);
      const hw = b.w / 2;
      const hh = b.h / 2;
      const filled = a.fill !== "none" && a.fillOpacity > 0;
      const hasStroke = a.stroke !== "none" && a.strokeOpacity > 0 && a.strokeWidth > 0;
      const reach = (hasStroke ? a.strokeWidth / 2 : 0) + tol;
      const dx = q.x - c.x;
      const dy = q.y - c.y;
      if (a.type === "rect") {
        const inside = Math.abs(dx) <= hw + reach && Math.abs(dy) <= hh + reach;
        if (filled || (!hasStroke && !filled)) return inside;
        const innerDx = Math.abs(dx) <= hw - reach && Math.abs(dy) <= hh - reach;
        return inside && !innerDx;
      }
      const rx = Math.max(hw, 0.5);
      const ry = Math.max(hh, 0.5);
      const k = Math.hypot(dx / rx, dy / ry);
      if (filled || (!hasStroke && !filled)) return k <= 1 + reach / Math.min(rx, ry);
      return Math.abs(k - 1) <= reach / Math.min(rx, ry);
    }
    case "emoji":
    case "text":
    case "redact": {
      const b = boxOf(a);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const q = rotatePoint(p, c, -b.rotation);
      return Math.abs(q.x - c.x) <= b.w / 2 + tol && Math.abs(q.y - c.y) <= b.h / 2 + tol;
    }
  }
}

/** The mark on top at a point (the last one drawn that is hit), or `null`. */
export function topmostAt(items: readonly Annotation[], p: Pt, tol: number): string | null {
  for (let i = items.length - 1; i >= 0; i--) if (hitTest(items[i], p, tol)) return items[i].id;
  return null;
}

/** The marks whose bounds touch a rectangle (the drag box of the Select tool). */
export function itemsInRect(items: readonly Annotation[], r: Rect): string[] {
  return items
    .filter((a) => {
      const b = boundsOf(a);
      return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
    })
    .map((a) => a.id);
}

// --- handles ---------------------------------------------------------------------------------------------------------

export type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "p1" | "p2";

export interface Handle {
  kind: HandleKind;
  x: number;
  y: number;
}

/** Marks that can be turned (the rest have no meaningful angle, or are stored in the picture's own axes). */
export function canRotate(a: Annotation): boolean {
  return a.type === "rect" || a.type === "ellipse" || a.type === "emoji" || a.type === "text";
}

/** The handles of a selected mark, in image pixels. `rotateOffset` is how far the rotation handle floats above the box. */
export function handlesOf(a: Annotation, rotateOffset: number): Handle[] {
  if (a.type === "line" || a.type === "arrow") {
    return [
      { kind: "p1", x: a.x1, y: a.y1 },
      { kind: "p2", x: a.x2, y: a.y2 },
    ];
  }
  const b = boxOf(a);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const at = (fx: number, fy: number): Pt => rotatePoint({ x: b.x + b.w * fx, y: b.y + b.h * fy }, c, b.rotation);
  const out: Handle[] = (
    [
      ["nw", 0, 0],
      ["n", 0.5, 0],
      ["ne", 1, 0],
      ["e", 1, 0.5],
      ["se", 1, 1],
      ["s", 0.5, 1],
      ["sw", 0, 1],
      ["w", 0, 0.5],
    ] as [HandleKind, number, number][]
  ).map(([kind, fx, fy]) => ({ kind, ...at(fx, fy) }));
  // A text has no top and bottom handles: its height always fits the text (corners scale it, the sides change the width).
  const handles = a.type === "text" ? out.filter((h) => h.kind !== "n" && h.kind !== "s") : out;
  if (canRotate(a)) handles.push({ kind: "rotate", ...rotatePoint({ x: c.x, y: b.y - rotateOffset }, c, b.rotation) });
  return handles;
}

/** The handle under a point (`radius` in image pixels), preferring the rotation handle. */
export function handleAt(handles: readonly Handle[], p: Pt, radius: number): Handle | null {
  let best: Handle | null = null;
  let bestD = radius;
  for (const h of handles) {
    const d = distance(p, h);
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** A box resized by dragging one of its eight handles to `p`; the opposite side stays where it is. */
export function resizeBox(box: Box, kind: HandleKind, p: Pt, minSize = 4): Box {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const u = rotatePoint(p, { x: cx, y: cy }, -box.rotation);
  const ux = u.x - cx;
  const uy = u.y - cy;
  const sx = kind.includes("e") ? 1 : kind.includes("w") ? -1 : 0;
  const sy = kind.includes("s") ? 1 : kind.includes("n") ? -1 : 0;
  let left = -box.w / 2;
  let right = box.w / 2;
  let top = -box.h / 2;
  let bottom = box.h / 2;
  if (sx === 1) right = Math.max(ux, left + minSize);
  if (sx === -1) left = Math.min(ux, right - minSize);
  if (sy === 1) bottom = Math.max(uy, top + minSize);
  if (sy === -1) top = Math.min(uy, bottom - minSize);
  const w = right - left;
  const h = bottom - top;
  const lcx = (left + right) / 2;
  const lcy = (top + bottom) / 2;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const gx = cx + lcx * cos - lcy * sin;
  const gy = cy + lcx * sin + lcy * cos;
  return { x: gx - w / 2, y: gy - h / 2, w, h, rotation: box.rotation };
}

/** Apply a handle drag to a mark. `shift` keeps a line to 45 degree steps. */
export function dragHandle(a: Annotation, kind: HandleKind, p: Pt, shift = false): Annotation {
  if (a.type === "line" || a.type === "arrow") {
    if (kind !== "p1" && kind !== "p2") return a;
    const fixed = kind === "p1" ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 };
    const q = shift ? snapLine(fixed, p) : p;
    return kind === "p1" ? { ...a, x1: q.x, y1: q.y } : { ...a, x2: q.x, y2: q.y };
  }
  if (kind === "rotate") return canRotate(a) ? rotateTo(a, p, shift) : a;
  const old = boxOf(a);
  const next = resizeBox(old, kind, p);
  switch (a.type) {
    case "rect":
    case "ellipse":
      return { ...a, x: next.x, y: next.y, w: next.w, h: next.h };
    case "redact":
      return { ...a, x: next.x, y: next.y, w: next.w, h: next.h };
    case "text": {
      const scale = old.h > 0 ? next.h / old.h : 1;
      return { ...a, x: next.x, y: next.y, w: next.w, h: next.h, fontSize: Math.max(4, a.fontSize * scale) };
    }
    case "emoji": {
      const size = Math.max(4, (next.w + next.h) / 2);
      const c = { x: next.x + next.w / 2, y: next.y + next.h / 2 };
      return { ...a, x: c.x - size / 2, y: c.y - size / 2, size };
    }
    case "pen":
    case "highlighter": {
      const sx = old.w > 0 ? next.w / old.w : 1;
      const sy = old.h > 0 ? next.h / old.h : 1;
      const points = a.points.slice();
      for (let i = 0; i + 1 < points.length; i += 3) {
        points[i] = next.x + (points[i] - old.x) * sx;
        points[i + 1] = next.y + (points[i + 1] - old.y) * sy;
      }
      return { ...a, points };
    }
    default:
      return a;
  }
}

/** A mark turned so that its top points at `p` (`snap` rounds to 15 degree steps). */
export function rotateTo<T extends Annotation>(a: T, p: Pt, snap: boolean): T {
  if (!canRotate(a)) return a;
  const b = boxOf(a);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let angle = Math.atan2(p.y - c.y, p.x - c.x) + HALF_PI;
  if (snap) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
  return { ...a, rotation: angle };
}

// --- the Shift constraints of the shape tools --------------------------------------------------------------------------

/** The rectangle dragged from `a` to `b`; with Shift a square (the larger side) growing the way the pointer went. */
export function dragRect(a: Pt, b: Pt, shift: boolean): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** `b` moved to the nearest multiple of 45 degrees around `a`, same distance. */
export function snapLine(a: Pt, b: Pt): Pt {
  const d = distance(a, b);
  if (d === 0) return b;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
  return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
}

/** The end points of a line dragged from `a` to `b`; with Shift on a multiple of 45 degrees. */
export function dragLine(a: Pt, b: Pt, shift: boolean): [Pt, Pt] {
  return [a, shift ? snapLine(a, b) : b];
}

/** The head of an arrow ending at (x2, y2): its tip and the two back corners, and where the line should stop. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): { tip: Pt; left: Pt; right: Pt; base: Pt } {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  // The head grows with the stroke, but never takes more than 60 % of a short arrow.
  const head = Math.min(Math.max(12, strokeWidth * 4), len * 0.6);
  const half = head * 0.45;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  return {
    tip: { x: x2, y: y2 },
    left: { x: bx - uy * half, y: by + ux * half },
    right: { x: bx + uy * half, y: by - ux * half },
    base: { x: x2 - ux * head * 0.8, y: y2 - uy * head * 0.8 },
  };
}
