// The geometry of crop, rotation and flip (no React): which size the final picture has and how a point of the original
// image maps into it. Annotations live in original pixels, so the same matrix draws them in place.
import type { AnnotationDoc, Rect, Rotation } from "./schema";

/** An affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f (the arguments of canvas `transform`). */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied after `n` (first n, then m). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/** The crop in effect: the document's, kept inside the picture; all of the picture when there is none. */
export function effectiveCrop(crop: Rect | null, width: number, height: number): Rect {
  if (!crop) return { x: 0, y: 0, w: width, h: height };
  const x = Math.min(Math.max(0, Math.round(crop.x)), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, Math.round(crop.y)), Math.max(0, height - 1));
  return {
    x,
    y,
    w: Math.max(1, Math.min(Math.round(crop.w), width - x)),
    h: Math.max(1, Math.min(Math.round(crop.h), height - y)),
  };
}

export interface DocGeometry {
  /** Size of the final picture. */
  width: number;
  height: number;
  /** Original pixels -> final picture. */
  matrix: Matrix;
  /** The kept part of the original (the crop, kept inside the picture). */
  crop: Rect;
}

type Turn = Pick<AnnotationDoc, "rotation" | "flipH" | "flipV">;

function turnMatrix(turn: Turn, cw: number, ch: number): { matrix: Matrix; width: number; height: number } {
  // Flip inside the cropped box, then rotate clockwise.
  let m: Matrix = IDENTITY;
  if (turn.flipH) m = multiply([-1, 0, 0, 1, cw, 0], m);
  if (turn.flipV) m = multiply([1, 0, 0, -1, 0, ch], m);
  const r: Rotation = turn.rotation;
  if (r === 90) return { matrix: multiply([0, 1, -1, 0, ch, 0], m), width: ch, height: cw };
  if (r === 180) return { matrix: multiply([-1, 0, 0, -1, cw, ch], m), width: cw, height: ch };
  if (r === 270) return { matrix: multiply([0, -1, 1, 0, 0, cw], m), width: ch, height: cw };
  return { matrix: m, width: cw, height: ch };
}

/** The size and the matrix of the final picture for a document and an original of `srcW` x `srcH`. */
export function docGeometry(doc: Pick<AnnotationDoc, "crop" | "rotation" | "flipH" | "flipV">, srcW: number, srcH: number): DocGeometry {
  const crop = effectiveCrop(doc.crop, srcW, srcH);
  const turn = turnMatrix(doc, crop.w, crop.h);
  return {
    width: turn.width,
    height: turn.height,
    matrix: multiply(turn.matrix, translation(-crop.x, -crop.y)),
    crop,
  };
}

/** The same without the crop: the whole picture turned and flipped (what the crop frame is drawn on). */
export function uncroppedGeometry(doc: Pick<AnnotationDoc, "rotation" | "flipH" | "flipV">, srcW: number, srcH: number): DocGeometry {
  return docGeometry({ ...doc, crop: null }, srcW, srcH);
}

/** The bounding box of a rectangle after `m` (exact for the 90 degree turns used here). */
export function transformRect(r: Rect, m: Matrix): Rect {
  const pts = [apply(m, r.x, r.y), apply(m, r.x + r.w, r.y), apply(m, r.x, r.y + r.h), apply(m, r.x + r.w, r.y + r.h)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A frame drawn on the turned, uncropped picture -> the crop to store (in original pixels). */
export function cropFromFrame(frame: Rect, turn: Turn, srcW: number, srcH: number): Rect {
  const g = uncroppedGeometry(turn, srcW, srcH);
  const r = transformRect(frame, invert(g.matrix));
  return effectiveCrop(r, srcW, srcH);
}

/** The stored crop -> its frame on the turned, uncropped picture. */
export function frameFromCrop(crop: Rect | null, turn: Turn, srcW: number, srcH: number): Rect {
  const g = uncroppedGeometry(turn, srcW, srcH);
  return transformRect(effectiveCrop(crop, srcW, srcH), g.matrix);
}

/** Rotate by `quarterTurns` quarter turns clockwise (negative = anticlockwise). */
export function turned(rotation: Rotation, quarterTurns: number): Rotation {
  const n = (((rotation / 90 + quarterTurns) % 4) + 4) % 4;
  return (n * 90) as Rotation;
}

type Turned = Pick<AnnotationDoc, "rotation" | "flipH" | "flipV">;

/**
 * Mirror the picture as it is shown: `"h"` left to right, `"v"` top to bottom. The document keeps one flip that is applied
 * before the rotation, so a mirror after a rotation also changes the rotation (mirror * R(r) = R(-r) * mirror, and a
 * vertical mirror is a horizontal one turned by 180 degrees).
 */
export function flippedOnScreen(doc: Turned, axis: "h" | "v"): Turned {
  const r = doc.rotation;
  const rotation = (axis === "h" ? (360 - r) % 360 : (540 - r) % 360) as Rotation;
  return { rotation, flipH: !doc.flipH, flipV: doc.flipV };
}
