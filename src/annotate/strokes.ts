// Freehand strokes: smoothing and the outline of a pen stroke (no canvas). The pen draws a filled outline whose width
// follows the pressure of a pen tablet; the highlighter draws one wide line, so overlaps inside a stroke do not darken.

/** Drop samples that are almost on top of the previous one (a mouse sends many while it hardly moves). */
export function dedupe(points: readonly number[], minDistance = 0.4): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const n = out.length;
    if (n >= 3 && Math.hypot(points[i] - out[n - 3], points[i + 1] - out[n - 2]) < minDistance) {
      // Keep the strongest pressure of the samples that were merged.
      out[n - 1] = Math.max(out[n - 1], points[i + 2]);
      continue;
    }
    out.push(points[i], points[i + 1], points[i + 2]);
  }
  return out;
}

/** Smooth the path (and its pressure) with a [1 2 1] filter; the ends stay where they are. */
export function smooth(points: readonly number[], passes = 2): number[] {
  let cur = [...points];
  const n = cur.length / 3;
  if (n < 3) return cur;
  for (let p = 0; p < passes; p++) {
    const next = [...cur];
    for (let i = 1; i < n - 1; i++) {
      for (let k = 0; k < 3; k++) next[i * 3 + k] = (cur[(i - 1) * 3 + k] + 2 * cur[i * 3 + k] + cur[(i + 1) * 3 + k]) / 4;
    }
    cur = next;
  }
  return cur;
}

/** The radius of the pen at a point: `size / 2` at the pressure of a mouse (0.5), thinner or thicker with a pen. */
export function radiusAt(size: number, pressure: number): number {
  return (size / 2) * (0.5 + Math.min(1, Math.max(0, pressure)));
}

/** A circle as a polygon (for a dot made by a click). */
export function circlePolygon(cx: number, cy: number, r: number, segments = 20): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/**
 * The outline of a pen stroke as a polygon `[x0, y0, x1, y1, ...]`: the left side, a round cap, the right side back and a
 * round cap. The stroke tapers a little over its first and last stretch, like ink.
 */
export function strokeOutline(points: readonly number[], size: number): number[] {
  const pts = smooth(dedupe(points));
  const n = pts.length / 3;
  if (n === 0) return [];
  if (n === 1) return circlePolygon(pts[0], pts[1], radiusAt(size, pts[2]));

  // Length along the stroke, for the taper.
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(pts[i * 3] - pts[(i - 1) * 3], pts[i * 3 + 1] - pts[(i - 1) * 3 + 1]));
  const total = along[n - 1];
  const taper = Math.min(size * 1.5, total / 2);

  const left: number[] = [];
  const right: number[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = Math.max(0, i - 1);
    const next = Math.min(n - 1, i + 1);
    let tx = pts[next * 3] - pts[prev * 3];
    let ty = pts[next * 3 + 1] - pts[prev * 3 + 1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const edge = taper > 0 ? Math.min(along[i], total - along[i]) / taper : 1;
    const r = radiusAt(size, pts[i * 3 + 2]) * (0.45 + 0.55 * Math.min(1, edge));
    radii.push(r);
    left.push(pts[i * 3] - ty * r, pts[i * 3 + 1] + tx * r);
    right.push(pts[i * 3] + ty * r, pts[i * 3 + 1] - tx * r);
  }

  const out: number[] = [...left];
  // End cap: half a circle from the left side round to the right side.
  out.push(...cap(pts, n - 1, radii[n - 1], 1));
  for (let i = n - 1; i >= 0; i--) out.push(right[i * 2], right[i * 2 + 1]);
  out.push(...cap(pts, 0, radii[0], -1));
  return out;
}

/**
 * The points of a half-circle cap at sample `i`, going from the left side round the end to the right side. `dir` 1 is the
 * end of the stroke (it points away from the previous sample), -1 the start (away from the next one).
 */
function cap(pts: readonly number[], i: number, r: number, dir: 1 | -1): number[] {
  const n = pts.length / 3;
  const other = dir === 1 ? Math.max(0, i - 1) : Math.min(n - 1, i + 1);
  // The direction pointing out of the stroke.
  let tx = pts[i * 3] - pts[other * 3];
  let ty = pts[i * 3 + 1] - pts[other * 3 + 1];
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  // The angle of the left normal (-ty, tx); the cap turns clockwise through the outward direction.
  const a0 = Math.atan2(tx, -ty);
  const out: number[] = [];
  for (let k = 1; k < 8; k++) {
    const a = a0 - (k / 8) * Math.PI;
    out.push(pts[i * 3] + Math.cos(a) * r, pts[i * 3 + 1] + Math.sin(a) * r);
  }
  return out;
}

/** The centre line of a highlighter stroke: lightly smoothed, as pairs `[x0, y0, x1, y1, ...]`. */
export function centreLine(points: readonly number[]): number[] {
  const pts = smooth(dedupe(points), 1);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 3) out.push(pts[i], pts[i + 1]);
  return out;
}

/**
 * A straight stroke from the first to the last sample (Shift held while drawing). `snap` rounds the angle to a multiple of
 * 45 degrees; the pen and the highlighter draw free straight lines.
 */
export function straighten(points: readonly number[], snap = false): number[] {
  if (points.length < 6) return [...points];
  const x0 = points[0];
  const y0 = points[1];
  let x1 = points[points.length - 3];
  let y1 = points[points.length - 2];
  if (snap) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4);
    x1 = x0 + Math.cos(a) * d;
    y1 = y0 + Math.sin(a) * d;
  }
  const p = points[2];
  const q = points[points.length - 1];
  // Enough samples for the outline's taper to look right.
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p + (q - p) * t);
  }
  return out;
}
