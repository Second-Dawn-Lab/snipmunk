// What is stored in a capture's `annotations`: the editable marks, the crop and the rotation of one picture. The original
// image file is never changed; everything the editor does lives in this document, in the pixel coordinates of the original.
// (No React, no IPC.)

export const SCHEMA_VERSION = 1;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

interface Base {
  id: string;
}

/** `points` are x, y and pressure (0 to 1) for each sample, flat: [x0, y0, p0, x1, y1, p1, ...]. */
export interface PenAnnotation extends Base {
  type: "pen";
  points: number[];
  color: string;
  size: number;
}

export interface HighlighterAnnotation extends Base {
  type: "highlighter";
  points: number[];
  color: string;
  size: number;
}

/** A rectangle or ellipse: the box `x, y, w, h` turned by `rotation` (radians) around its centre. */
export interface ShapeAnnotation extends Base {
  type: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** "#rrggbb" or "none". */
  fill: string;
  /** 0 to 100 */
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface LineAnnotation extends Base {
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
}

/** An emoji sticker: `size` is the side of its box. */
export interface EmojiAnnotation extends Base {
  type: "emoji";
  x: number;
  y: number;
  size: number;
  char: string;
  rotation: number;
}

/** Text on the picture. `w` and `h` are the measured size of the text box (the editor measures when it commits). */
export interface TextAnnotation extends Base {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  color: string;
  /** A solid label behind the text. */
  background: boolean;
  rotation: number;
  /** `w` is a width the text wraps to (set by the side handles); else `w` is the width of the longest line. */
  fixedWidth: boolean;
}

/** An area whose pixels are destroyed in the rendered picture (never a reversible effect). */
export interface RedactAnnotation extends Base {
  type: "redact";
  x: number;
  y: number;
  w: number;
  h: number;
  mode: RedactMode;
  /** "quick" for a redaction made by Quick redact (text recognition); a manual one has none. */
  origin?: "quick";
}

export type RedactMode = "pixelate" | "blur" | "box";

export type Annotation =
  | PenAnnotation
  | HighlighterAnnotation
  | ShapeAnnotation
  | LineAnnotation
  | EmojiAnnotation
  | TextAnnotation
  | RedactAnnotation;

export type AnnotationType = Annotation["type"];

export interface AnnotationDoc {
  version: number;
  /** The part of the picture that is kept (in original pixels), or null for all of it. */
  crop: Rect | null;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
  items: Annotation[];
}

/** Limits that keep a damaged or hand-edited file from making the editor crawl. */
export const MAX_ITEMS = 2000;
export const MAX_POINTS = 20000; // samples per stroke

export function emptyDoc(): AnnotationDoc {
  return { version: SCHEMA_VERSION, crop: null, rotation: 0, flipH: false, flipV: false, items: [] };
}

/** Does the document change the picture at all? */
export function isEdited(doc: AnnotationDoc): boolean {
  return doc.items.length > 0 || doc.crop !== null || doc.rotation !== 0 || doc.flipH || doc.flipV;
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `a${Date.now().toString(36)}${counter.toString(36)}`;
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const color = (v: unknown, fallback: string, allowNone = false): string =>
  typeof v === "string" && (/^#[0-9a-fA-F]{6}$/.test(v) || (allowNone && v === "none")) ? v : fallback;

function points(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const n = Math.min(Math.floor(v.length / 3), MAX_POINTS) * 3;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    out.push(i % 3 === 2 ? clamp(x, 0, 1) : x);
  }
  return out;
}

/** One stored item, made safe: wrong types, missing fields and nonsense numbers are repaired or the item is dropped. */
export function sanitizeItem(raw: unknown): Annotation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.length > 0 && r.id.length <= 64 ? r.id : newId();
  switch (r.type) {
    case "pen":
    case "highlighter": {
      const pts = points(r.points);
      if (!pts) return null;
      return {
        type: r.type,
        id,
        points: pts,
        color: color(r.color, r.type === "pen" ? "#E53935" : "#FFEB3B"),
        size: clamp(num(r.size, 4), 0.5, 400),
      };
    }
    case "rect":
    case "ellipse":
      return {
        type: r.type,
        id,
        x: num(r.x, 0),
        y: num(r.y, 0),
        w: Math.abs(num(r.w, 0)),
        h: Math.abs(num(r.h, 0)),
        rotation: num(r.rotation, 0),
        fill: color(r.fill, "none", true),
        fillOpacity: clamp(num(r.fillOpacity, 100), 0, 100),
        stroke: color(r.stroke, "#E53935", true),
        strokeOpacity: clamp(num(r.strokeOpacity, 100), 0, 100),
        strokeWidth: clamp(num(r.strokeWidth, 3), 0, 200),
      };
    case "line":
    case "arrow":
      return {
        type: r.type,
        id,
        x1: num(r.x1, 0),
        y1: num(r.y1, 0),
        x2: num(r.x2, 0),
        y2: num(r.y2, 0),
        stroke: color(r.stroke, "#E53935"),
        strokeOpacity: clamp(num(r.strokeOpacity, 100), 0, 100),
        strokeWidth: clamp(num(r.strokeWidth, 3), 0.5, 200),
      };
    case "emoji":
      if (typeof r.char !== "string" || r.char.length === 0 || r.char.length > 16) return null;
      return {
        type: "emoji",
        id,
        x: num(r.x, 0),
        y: num(r.y, 0),
        size: clamp(num(r.size, 64), 4, 4000),
        char: r.char,
        rotation: num(r.rotation, 0),
      };
    case "text":
      if (typeof r.text !== "string" || r.text.length > 20000) return null;
      return {
        type: "text",
        id,
        x: num(r.x, 0),
        y: num(r.y, 0),
        w: Math.abs(num(r.w, 0)),
        h: Math.abs(num(r.h, 0)),
        text: r.text,
        fontSize: clamp(num(r.fontSize, 28), 4, 800),
        color: color(r.color, "#E53935"),
        background: r.background === true,
        rotation: num(r.rotation, 0),
        fixedWidth: r.fixedWidth === true,
      };
    case "redact":
      return {
        type: "redact",
        id,
        x: num(r.x, 0),
        y: num(r.y, 0),
        w: Math.abs(num(r.w, 0)),
        h: Math.abs(num(r.h, 0)),
        mode: r.mode === "blur" || r.mode === "box" ? r.mode : "pixelate",
        ...(r.origin === "quick" ? { origin: "quick" as const } : {}),
      };
    default:
      return null;
  }
}

function sanitizeCrop(v: unknown): Rect | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const x = num(r.x, NaN);
  const y = num(r.y, NaN);
  const w = num(r.w, NaN);
  const h = num(r.h, NaN);
  if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) return null;
  return { x, y, w, h };
}

/**
 * What a capture's stored `annotations` mean. `null` (a capture nobody edited) and the `[]` that Phase 2 reserved are an
 * empty document; a document of this version is checked item by item; a newer version is read as far as it is understood.
 * Always returns a document the editor can use, never throws.
 */
export function migrate(raw: unknown): AnnotationDoc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return emptyDoc();
  const r = raw as Record<string, unknown>;
  const rotation = ([0, 90, 180, 270] as const).find((v) => v === r.rotation) ?? 0;
  const items = Array.isArray(r.items)
    ? r.items
        .slice(0, MAX_ITEMS)
        .map(sanitizeItem)
        .filter((a): a is Annotation => a !== null)
    : [];
  return {
    version: SCHEMA_VERSION,
    crop: sanitizeCrop(r.crop),
    rotation,
    flipH: r.flipH === true,
    flipV: r.flipV === true,
    items,
  };
}

/** The value to store: `null` when the document changes nothing, so an untouched capture keeps `annotations: null`. */
export function toStored(doc: AnnotationDoc): AnnotationDoc | null {
  return isEdited(doc) ? doc : null;
}
