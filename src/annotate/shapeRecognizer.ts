// Hold-to-shape (like the Snipping Tool's ink to shape; no React): a pen stroke that is held still for about a second is
// recognized and replaced by a clean line, arrow, ellipse, rectangle, triangle or star. A stroke that is not one of these stays
// freehand. All distances are in picture pixels; `minSize` is the smallest bounding box that can snap.
import type { Pt } from "./geometry";

export type Snap =
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "arrow"; a: Pt; b: Pt }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  /** A clean closed polygon: a triangle, a star or a turned rectangle. */
  | { kind: "polygon"; name: "triangle" | "star" | "quad"; points: Pt[] };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The points of a pen stroke (`x, y, pressure` triples) without consecutive duplicates. */
export function strokePoints(raw: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < raw.length; i += 3) {
    const p = { x: raw[i], y: raw[i + 1] };
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 0.5) out.push(p);
  }
  return out;
}

function pathLength(p: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) n += dist(p[i - 1], p[i]);
  return n;
}

/** Distance of a point from the line through a and b. */
function lineDistance(p: Pt, a: Pt, b: Pt): number {
  const l = dist(a, b) || 1;
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
}

/** Side of the line a→b a point is on (positive or negative), scaled by the distance. */
function side(p: Pt, a: Pt, b: Pt): number {
  const l = dist(a, b) || 1;
  return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / l;
}

/** The corners of a closed stroke (it starts and ends at about the same place): both halves up to the farthest point. */
export function simplifyClosed(p: readonly Pt[], epsilon: number): Pt[] {
  let idx = 0;
  let far = 0;
  p.forEach((q, i) => {
    const d = dist(p[0], q);
    if (d > far) {
      far = d;
      idx = i;
    }
  });
  const left = simplify(p.slice(0, idx + 1), epsilon);
  const right = simplify(p.slice(idx), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Ramer-Douglas-Peucker: the corner points of a polyline. */
export function simplify(p: readonly Pt[], epsilon: number): Pt[] {
  if (p.length < 3) return [...p];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = lineDistance(p[i], p[0], p[p.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsilon) return [p[0], p[p.length - 1]];
  const left = simplify(p.slice(0, idx + 1), epsilon);
  const right = simplify(p.slice(idx), epsilon);
  return [...left.slice(0, -1), ...right];
}

function bounds(p: readonly Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The angle (degrees, 0 to 180) between the sides at corner b of a→b→c. */
function cornerAngle(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

/** How round the points are: the mean and the largest distance from 1 of the normalized radius in the bounding ellipse. */
function ellipseResidual(p: readonly Pt[]): { mean: number; max: number } {
  const b = bounds(p);
  const a = b.w / 2 || 1;
  const c = b.h / 2 || 1;
  const cx = b.x + a;
  const cy = b.y + c;
  let sum = 0;
  let max = 0;
  for (const q of p) {
    const r = Math.hypot((q.x - cx) / a, (q.y - cy) / c);
    const d = Math.abs(r - 1);
    sum += d;
    max = Math.max(max, d);
  }
  return { mean: sum / p.length, max };
}

/** A clean five-pointed star in a box. */
export function starPoints(cx: number, cy: number, outer: number, rotation = -Math.PI / 2): Pt[] {
  const inner = outer * 0.4;
  const out: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / 5;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

function asArrow(p: readonly Pt[], length: number): Snap | null {
  // The tip is the point farthest from where the stroke began; the shaft up to it is straight; after it the pen goes back
  // along the two barbs (short, on both sides of the shaft).
  let far = 0;
  for (const q of p) far = Math.max(far, dist(p[0], q));
  // The first point that is (almost) as far as the farthest: the pen came back over the tip for the second barb.
  const tipIdx = p.findIndex((q) => dist(p[0], q) >= 0.95 * far);
  const tip = p[tipIdx];
  const shaft = dist(p[0], tip);
  if (shaft < 0.45 * length || tipIdx >= p.length - 3) return null;
  for (let i = 0; i <= tipIdx; i++) if (lineDistance(p[i], p[0], tip) > 0.09 * shaft) return null;
  const rest = p.slice(tipIdx);
  if (pathLength(rest) < 0.15 * shaft) return null;
  let left = 0;
  let right = 0;
  for (const q of rest) {
    if (dist(q, tip) > 0.5 * shaft) return null;
    const s = side(q, p[0], tip);
    if (s > 0.06 * shaft) left++;
    if (s < -0.06 * shaft) right++;
  }
  return left > 0 && right > 0 ? { kind: "arrow", a: p[0], b: tip } : null;
}

/**
 * Recognize a stroke. Returns the clean shape, or null when the stroke is not one (a scribble, a letter, an open curve, a tiny
 * stroke).
 */
export function recognize(raw: readonly number[], minSize = 20): Snap | null {
  const p = strokePoints(raw);
  if (p.length < 8) return null;
  const box = bounds(p);
  const diag = Math.hypot(box.w, box.h);
  if (diag < minSize) return null;
  const length = pathLength(p);
  const gap = dist(p[0], p[p.length - 1]);
  const closed = gap < 0.2 * length;

  if (!closed) {
    const arrow = asArrow(p, length);
    if (arrow) return arrow;
    // A line: straight, and not much longer than its chord.
    let dev = 0;
    for (const q of p) dev = Math.max(dev, lineDistance(q, p[0], p[p.length - 1]));
    if (dev <= 0.07 * gap && length <= 1.2 * gap) return { kind: "line", a: p[0], b: p[p.length - 1] };
    return null;
  }

  const eps = 0.045 * diag;
  let corners = simplifyClosed(p, eps);
  if (corners.length > 2 && dist(corners[0], corners[corners.length - 1]) < 0.2 * length) corners = corners.slice(0, -1);
  // Corners that are nearly straight (a bend of under 20 degrees) are not corners.
  corners = corners.filter((c, i) => {
    const a = corners[(i + corners.length - 1) % corners.length];
    const b = corners[(i + 1) % corners.length];
    return cornerAngle(a, c, b) < 160;
  });
  const n = corners.length;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // Pentagram in one stroke: five equal sides, turning 144 degrees at each corner.
  if (n === 5) {
    const sides = corners.map((c, i) => dist(c, corners[(i + 1) % 5]));
    const mean = sides.reduce((s, v) => s + v, 0) / 5;
    const equal = sides.every((s) => Math.abs(s - mean) < 0.25 * mean);
    const turns = corners.every((c, i) => Math.abs(cornerAngle(corners[(i + 4) % 5], c, corners[(i + 1) % 5]) - 36) < 18);
    if (equal && turns) return { kind: "polygon", name: "star", points: starPoints(cx, cy, Math.max(box.w, box.h) / 2 / 0.95) };
  }
  // Outline star: ten corners with alternating radius.
  if (n >= 8 && n <= 13) {
    const radii = corners.map((c) => Math.hypot(c.x - cx, c.y - cy));
    const hi = Math.max(...radii);
    const lo = Math.min(...radii);
    const mid = (hi + lo) / 2;
    const flips = radii.filter((r, i) => (r > mid) !== (radii[(i + radii.length - 1) % radii.length] > mid)).length;
    // Five outer and five inner corners: the radius goes up and down about ten times.
    if (lo / hi < 0.65 && flips >= 0.8 * radii.length && flips <= 12) return { kind: "polygon", name: "star", points: starPoints(cx, cy, Math.max(box.w, box.h) / 2 / 0.95) };
  }
  const round = ellipseResidual(p);
  if (n >= 5 && round.mean < 0.12 && round.max < 0.3) return { kind: "ellipse", x: box.x, y: box.y, w: box.w, h: box.h };
  if (n === 3) return { kind: "polygon", name: "triangle", points: corners };
  if (n === 4) {
    const angles = corners.map((c, i) => cornerAngle(corners[(i + 3) % 4], c, corners[(i + 1) % 4]));
    const sides = corners.map((c, i) => dist(c, corners[(i + 1) % 4]));
    const right = angles.every((a) => Math.abs(a - 90) < 20);
    const opposite = Math.abs(sides[0] - sides[2]) < 0.3 * Math.max(sides[0], sides[2]) && Math.abs(sides[1] - sides[3]) < 0.3 * Math.max(sides[1], sides[3]);
    if (!right || !opposite) return null;
    const tilt = corners.map((c, i) => {
      const o = corners[(i + 1) % 4];
      const a = (Math.abs((Math.atan2(o.y - c.y, o.x - c.x) * 180) / Math.PI) % 90);
      return Math.min(a, 90 - a);
    });
    if (tilt.every((t) => t < 10)) return { kind: "rect", x: box.x, y: box.y, w: box.w, h: box.h };
    return { kind: "polygon", name: "quad", points: corners };
  }
  return null;
}
