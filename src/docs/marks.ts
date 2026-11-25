// The marks of a step picture that have a place of their own around it (no React, no DOM): callouts, spotlights and magnifiers.
//
// A callout's box and a magnifier's bubble are stored in FRAME units: the shown picture is 700 wide, its top left corner is 0,0.
// So they keep their place and size on the page when the picture is zoomed, cropped or put into another frame, and they may stand
// outside the picture (negative, or beyond 700 / the height). What they point at (the tip, the magnified area) is in picture
// pixels, so it stays on its piece of the screen. See docs/snpd-format.md.

import { isCjk, wrapLines } from "../annotate/textLayout";
import type { Annotation, Rect } from "./model";

export const FRAME_W = 700;
/** How far a box may stand beside and above or below the picture (frame units). */
export const MAX_SIDE = 350;
export const MAX_OUT = 300;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const frameHeight = (view: Rect): number => (FRAME_W * view[3]) / view[2];
export const frameScale = (view: Rect): number => view[2] / FRAME_W;
export const toFrame = (x: number, y: number, view: Rect): { x: number; y: number } => ({ x: (x - view[0]) / frameScale(view), y: (y - view[1]) / frameScale(view) });
export const toPicture = (x: number, y: number, view: Rect): [number, number] => [view[0] + x * frameScale(view), view[1] + y * frameScale(view)];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round = (v: number) => Math.round(v * 10) / 10;

/** A box moved so that it stays near the picture. */
export function clampBox(b: Box, view: Rect): Box {
  const h = frameHeight(view);
  const w = clamp(b.w, 40, FRAME_W + 2 * MAX_SIDE);
  return { x: round(clamp(b.x, -MAX_SIDE, FRAME_W + MAX_SIDE - w)), y: round(clamp(b.y, -MAX_OUT, Math.max(-MAX_OUT, h + MAX_OUT - b.h))), w: round(w), h: round(b.h) };
}

// --- text ------------------------------------------------------------------------------------------------------------------------

/** The width of a piece of text in frame units. */
export type Measure = (text: string, size: number, bold: boolean) => number;

export const FONT = "Segoe UI, system-ui, sans-serif";
export const LINE = 1.25;

/** A measure without a canvas (tests, and where none can be made). */
export const approxMeasure: Measure = (text, size, bold) => [...text].reduce((w, ch) => w + size * (isCjk(ch) ? 1 : ch === " " ? 0.28 : 0.55), 0) * (bold ? 1.07 : 1);

let context: CanvasRenderingContext2D | null | undefined;
/** The measure of the page: the same font the callouts are drawn with. */
export const canvasMeasure: Measure = (text, size, bold) => {
  if (context === undefined) context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!context) return approxMeasure(text, size, bold);
  context.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
  return context.measureText(text).width;
};

// --- callouts --------------------------------------------------------------------------------------------------------------------

export const CALLOUT_SHAPES = ["rounded", "rect", "speech", "oval", "cloud", "label"] as const;
export type CalloutShape = (typeof CALLOUT_SHAPES)[number];

export interface CalloutStyle {
  shape: CalloutShape;
  /** The inner colour. */
  fill: string;
  /** The border (and pointer) colour. */
  color: string;
  /** The border width (frame units; 0: no border). */
  width: number;
  textColor: string;
  /** The font size (frame units). */
  size: number;
  bold: boolean;
}

export const CALLOUT_DEFAULT: CalloutStyle = { shape: "rounded", fill: "#FFFFFF", color: "#D62828", width: 3, textColor: "#111111", size: 18, bold: false };
export const CALLOUT_LIMITS = { width: { min: 0, max: 12 }, size: { min: 10, max: 48 } } as const;

const colourOf = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback);
const numberOf = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : fallback);

/** Chosen options (from a mark or the remembered choices) completed and limited. */
export function calloutStyle(a: Partial<Record<keyof CalloutStyle, unknown>>): CalloutStyle {
  const d = CALLOUT_DEFAULT;
  return {
    shape: CALLOUT_SHAPES.includes(a.shape as CalloutShape) ? (a.shape as CalloutShape) : d.shape,
    fill: colourOf(a.fill, d.fill),
    color: colourOf(a.color, d.color),
    width: numberOf(a.width, d.width, CALLOUT_LIMITS.width.min, CALLOUT_LIMITS.width.max),
    textColor: colourOf(a.textColor, d.textColor),
    size: numberOf(a.size, d.size, CALLOUT_LIMITS.size.min, CALLOUT_LIMITS.size.max),
    bold: a.bold === true,
  };
}

/** The room between the border of a shape and its text. */
export function calloutPadding(shape: CalloutShape, box: Box, size: number): { x: number; y: number } {
  // (the corners of an ellipse and of a cloud take room from the text)
  if (shape === "oval") return { x: box.w * 0.14, y: size * 0.9 };
  if (shape === "cloud") return { x: Math.max(size * 0.9, box.w * 0.09), y: size * 0.9 };
  return { x: size * 0.6, y: size * 0.45 };
}

export function calloutLines(text: string, box: Box, style: Pick<CalloutStyle, "shape" | "size" | "bold">, measure: Measure): string[] {
  const room = Math.max(style.size, box.w - 2 * calloutPadding(style.shape, box, style.size).x);
  return wrapLines((t) => measure(t, style.size, style.bold), text, room);
}

/** The height the text needs in a box of this width. */
export function textHeight(text: string, box: Box, style: Pick<CalloutStyle, "shape" | "size" | "bold">, measure: Measure): number {
  return round(Math.max(1, calloutLines(text, box, style, measure).length) * style.size * LINE + 2 * calloutPadding(style.shape, box, style.size).y);
}

/** The box with room for its text: never lower than the text needs, otherwise as high as it was chosen. */
export function fitBox(box: Box, text: string, style: Pick<CalloutStyle, "shape" | "size" | "bold">, measure: Measure, chosen = box.h): Box {
  return { ...box, h: Math.max(round(chosen), textHeight(text, box, style, measure)) };
}

/** A callout made before 7.5-D (no `box`): one line in a box at x,y, in picture pixels, as it was drawn then. */
export function legacyCallout(a: Annotation, view: Rect): { box: Rect; tip: [number, number]; unit: number } {
  const unit = Math.max(1, view[2] / FRAME_W);
  const size = unit * 15;
  const w = Math.max(60 * unit, (a.text?.length ?? 4) * size * 0.6 + 16 * unit);
  return { box: [a.x, a.y, w, size + 14 * unit], tip: [a.x2 ?? a.x, a.y2 ?? a.y], unit };
}

/** An old callout as one that can be edited, looking as it did. */
export function upgradeCallout(a: Annotation, view: Rect): Annotation {
  if (a.box) return a;
  const old = legacyCallout(a, view);
  const k = frameScale(view);
  const at = toFrame(old.box[0], old.box[1], view);
  return {
    ...a,
    x2: old.tip[0],
    y2: old.tip[1],
    box: { x: round(at.x), y: round(at.y), w: round(old.box[2] / k), h: round(old.box[3] / k) },
    shape: "rounded",
    fill: "#FFFFFF",
    textColor: "#111111",
    size: round((15 * old.unit) / k),
    width: round((a.width * old.unit) / k),
    bold: false,
  };
}

/** The mark with its box here; `x`, `y` follow (picture pixels: where a version that does not know `box` shows it). */
export function withBox(a: Annotation, box: Box, view: Rect): Annotation {
  const [x, y] = toPicture(box.x, box.y, view);
  return { ...a, box, x: Math.round(x), y: Math.round(y) };
}

/** A new callout pointing at `tip` (picture pixels). With `end` (where a drag ended) the box stands there, otherwise beside the tip. */
export function newCallout(id: string, tip: [number, number], end: [number, number] | null, view: Rect, style: CalloutStyle, measure: Measure): Annotation {
  const p = toFrame(tip[0], tip[1], view);
  const start: Box = { x: 0, y: 0, w: 190, h: 0 };
  const h = textHeight("", start, style, measure);
  let box: Box;
  if (end) {
    const e = toFrame(end[0], end[1], view);
    box = { ...start, h, x: e.x - start.w / 2, y: e.y - h / 2 };
  } else {
    const right = p.x + 50 + start.w <= FRAME_W;
    const above = p.y - 60 - h >= 0;
    box = { ...start, h, x: right ? p.x + 50 : p.x - 50 - start.w, y: above ? p.y - 60 - h : p.y + 60 };
  }
  const a: Annotation = { id, kind: "callout", x: 0, y: 0, x2: Math.round(tip[0]), y2: Math.round(tip[1]), text: "", ...style };
  return withBox(a, clampBox(box, view), view);
}

/**
 * The mark with another text or look. A box that was as high as its text follows the text; one that was made higher keeps its
 * height, and no box is lower than its text.
 */
export function restyleCallout(a: Annotation, change: Partial<Annotation>, view: Rect, measure: Measure): Annotation {
  const was = upgradeCallout(a, view);
  const own = was.box!.h > textHeight(was.text ?? "", was.box!, calloutStyle(was), measure) + 1;
  const next = { ...was, ...change };
  return withBox(next, fitBox(next.box!, next.text ?? "", calloutStyle(next), measure, own ? next.box!.h : 0), view);
}

type Point = [number, number];

export interface CalloutPath {
  /** The outline of the shape (with the tail of a speech bubble or an oval in it). */
  body: string;
  /** A straight pointer from the box to the tip. */
  leader?: [Point, Point];
  /** The head of an arrow label's pointer. */
  head?: string;
  /** The small circles of a cloud's pointer: centre x, y and radius. */
  dots?: [number, number, number][];
}

const f = (v: number) => round(v);

function roundedRect(b: Box, r: number): string {
  const k = Math.min(r, b.w / 2, b.h / 2);
  return `M${f(b.x + k)} ${f(b.y)}H${f(b.x + b.w - k)}A${k} ${k} 0 0 1 ${f(b.x + b.w)} ${f(b.y + k)}V${f(b.y + b.h - k)}A${k} ${k} 0 0 1 ${f(b.x + b.w - k)} ${f(b.y + b.h)}H${f(b.x + k)}A${k} ${k} 0 0 1 ${f(b.x)} ${f(b.y + b.h - k)}V${f(b.y + k)}A${k} ${k} 0 0 1 ${f(b.x + k)} ${f(b.y)}Z`;
}

/** Where a line from the centre of a box to a point leaves the box. */
export function edgePoint(b: Box, to: Point): Point {
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
  const [dx, dy] = [to[0] - cx, to[1] - cy];
  if (!dx && !dy) return [cx, cy];
  const k = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * Math.min(1, k), cy + dy * Math.min(1, k)];
}

const inside = (b: Box, p: Point) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;

/** A rounded box whose side nearest to the tip runs out into a point at it. */
function speech(b: Box, tip: Point): string {
  const r = Math.min(10, b.w / 2, b.h / 2);
  if (inside(b, tip)) return roundedRect(b, r);
  const [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
  const over = { top: y0 - tip[1], bottom: tip[1] - y1, left: x0 - tip[0], right: tip[0] - x1 };
  const side = (Object.keys(over) as (keyof typeof over)[]).reduce((a, k) => (over[k] > over[a] ? k : a), "top" as keyof typeof over);
  const flat = side === "top" || side === "bottom";
  const half = Math.min(14, ((flat ? b.w : b.h) - 2 * r) / 2);
  const mid = clamp(flat ? tip[0] : tip[1], (flat ? x0 : y0) + r + half, (flat ? x1 : y1) - r - half);
  const tail = (a: number, c: number) => (flat ? `H${f(a)}L${f(tip[0])} ${f(tip[1])}L${f(c)} ${f(side === "top" ? y0 : y1)}` : `V${f(a)}L${f(tip[0])} ${f(tip[1])}L${f(side === "left" ? x0 : x1)} ${f(c)}`);
  return (
    `M${f(x0 + r)} ${f(y0)}` +
    (side === "top" ? tail(mid - half, mid + half) : "") +
    `H${f(x1 - r)}A${r} ${r} 0 0 1 ${f(x1)} ${f(y0 + r)}` +
    (side === "right" ? tail(mid - half, mid + half) : "") +
    `V${f(y1 - r)}A${r} ${r} 0 0 1 ${f(x1 - r)} ${f(y1)}` +
    (side === "bottom" ? tail(mid + half, mid - half) : "") +
    `H${f(x0 + r)}A${r} ${r} 0 0 1 ${f(x0)} ${f(y1 - r)}` +
    (side === "left" ? tail(mid + half, mid - half) : "") +
    `V${f(y0 + r)}A${r} ${r} 0 0 1 ${f(x0 + r)} ${f(y0)}Z`
  );
}

/** An ellipse in the box, with a tail to a tip outside it. */
function oval(b: Box, tip: Point): string {
  const [cx, cy, rx, ry] = [b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2];
  const at = (t: number): string => `${f(cx + rx * Math.cos(t))} ${f(cy + ry * Math.sin(t))}`;
  if (((tip[0] - cx) / rx) ** 2 + ((tip[1] - cy) / ry) ** 2 <= 1) return `M${at(0)}A${f(rx)} ${f(ry)} 0 1 1 ${at(Math.PI)}A${f(rx)} ${f(ry)} 0 1 1 ${at(0)}Z`;
  const angle = Math.atan2((tip[1] - cy) / ry, (tip[0] - cx) / rx);
  return `M${at(angle + 0.2)}A${f(rx)} ${f(ry)} 0 1 1 ${at(angle - 0.2)}L${f(tip[0])} ${f(tip[1])}Z`;
}

/** Bumps around the box. */
function cloud(b: Box): string {
  const nx = Math.max(3, Math.round(b.w / 45));
  const ny = Math.max(2, Math.round(b.h / 45));
  const points: Point[] = [];
  for (let i = 0; i < nx; i++) points.push([b.x + (b.w * i) / nx, b.y]);
  for (let i = 0; i < ny; i++) points.push([b.x + b.w, b.y + (b.h * i) / ny]);
  for (let i = 0; i < nx; i++) points.push([b.x + b.w - (b.w * i) / nx, b.y + b.h]);
  for (let i = 0; i < ny; i++) points.push([b.x, b.y + b.h - (b.h * i) / ny]);
  return (
    `M${f(points[0][0])} ${f(points[0][1])}` +
    points
      .map((p, i) => {
        const q = points[(i + 1) % points.length];
        const r = f(Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.62);
        return `A${r} ${r} 0 0 1 ${f(q[0])} ${f(q[1])}`;
      })
      .join("") +
    "Z"
  );
}

/** How far a cloud reaches beyond its box. */
const CLOUD_BUMP = 16;

export function calloutPath(shape: CalloutShape, b: Box, tip: Point, width: number): CalloutPath {
  if (shape === "speech") return { body: speech(b, tip) };
  if (shape === "oval") return { body: oval(b, tip) };
  const far = !inside(b, tip);
  const from = edgePoint(b, tip);
  if (shape === "cloud") {
    const dots: [number, number, number][] = far
      ? ([
          [0.3, 9],
          [0.62, 6],
          [0.9, 3.5],
        ] as const).map(([t, r]) => [f(from[0] + (tip[0] - from[0]) * t), f(from[1] + (tip[1] - from[1]) * t), r])
      : [];
    return { body: cloud(b), dots };
  }
  if (shape === "label") {
    const body = roundedRect(b, 2);
    if (!far) return { body };
    const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const long = Math.max(12, width * 4.5);
    const corner = (turn: number): string => `${f(tip[0] - long * Math.cos(angle + turn))} ${f(tip[1] - long * Math.sin(angle + turn))}`;
    return { body, leader: [from, [f(tip[0] - long * 0.6 * Math.cos(angle)), f(tip[1] - long * 0.6 * Math.sin(angle))]], head: `M${f(tip[0])} ${f(tip[1])}L${corner(0.45)}L${corner(-0.45)}Z` };
  }
  return { body: roundedRect(b, shape === "rect" ? 0 : 10), leader: far ? [from, tip] : undefined };
}

// --- magnifiers ------------------------------------------------------------------------------------------------------------------

export interface MagnifyStyle {
  shape: "circle" | "square";
  /** How many times larger the area is shown. */
  zoom: number;
  /** A line from the area to the bubble. */
  line: boolean;
  color: string;
  width: number;
}

export const MAGNIFY_DEFAULT: MagnifyStyle = { shape: "circle", zoom: 2.5, line: true, color: "#D62828", width: 3 };
export const MAGNIFY_LIMITS = { zoom: { min: 2, max: 4 }, width: { min: 0, max: 12 } } as const;

export function magnifyStyle(a: Partial<Record<keyof MagnifyStyle, unknown>>): MagnifyStyle {
  const d = MAGNIFY_DEFAULT;
  return {
    shape: a.shape === "square" ? "square" : "circle",
    zoom: numberOf(a.zoom, d.zoom, MAGNIFY_LIMITS.zoom.min, MAGNIFY_LIMITS.zoom.max),
    line: a.line !== false,
    color: colourOf(a.color, d.color),
    width: numberOf(a.width, d.width, MAGNIFY_LIMITS.width.min, MAGNIFY_LIMITS.width.max),
  };
}

/** The rectangle of a mark that has two corners (picture pixels). */
export const rectOf = (a: Pick<Annotation, "x" | "y" | "x2" | "y2">): Rect => [Math.min(a.x, a.x2 ?? a.x), Math.min(a.y, a.y2 ?? a.y), Math.abs((a.x2 ?? a.x) - a.x), Math.abs((a.y2 ?? a.y) - a.y)];

/** The smallest area that can be magnified (picture pixels). */
export const MIN_SOURCE = 8;

/** The square area around a centre, moved inside the picture. */
export function sourceSquare(cx: number, cy: number, side: number, size: [number, number]): Rect {
  const s = Math.round(clamp(side, MIN_SOURCE, Math.min(size[0], size[1])));
  return [Math.round(clamp(cx - s / 2, 0, size[0] - s)), Math.round(clamp(cy - s / 2, 0, size[1] - s)), s, s];
}

/** The pixels a magnifier takes its area from: the step picture (`image`, of this size), or the mark's own piece of the
 * screen where the area lies outside it (a saved guide stores only what its steps show). */
export function sourcePicture(a: Annotation, image: string, size: [number, number]): { file: string; x: number; y: number; width: number; height: number } {
  const [x, y, w, h] = rectOf(a);
  const p = a.patch;
  if (p && !(x >= 0 && y >= 0 && x + w <= size[0] && y + h <= size[1])) return { file: p.file, x: p.x, y: p.y, width: p.x2 - p.x, height: p.y2 - p.y };
  return { file: image, x: 0, y: 0, width: size[0], height: size[1] };
}

/** The bubble of a magnifier (frame units): the area as the picture shows it, times the zoom. */
export function bubbleBox(a: Annotation, view: Rect): Box {
  const side = clamp((rectOf(a)[2] / frameScale(view)) * magnifyStyle(a).zoom, 30, 2 * FRAME_W);
  const at = a.at ?? { x: FRAME_W / 2, y: frameHeight(view) / 2 };
  return { x: round(at.x - side / 2), y: round(at.y - side / 2), w: round(side), h: round(side) };
}

/** A new magnifier of an area (picture pixels): the bubble stands beside it, where there is room. */
export function newMagnify(id: string, source: Rect, view: Rect, style: MagnifyStyle): Annotation {
  const a: Annotation = { id, kind: "magnify", x: source[0], y: source[1], x2: source[0] + source[2], y2: source[1] + source[3], ...style };
  const k = frameScale(view);
  const c = toFrame(source[0] + source[2] / 2, source[1] + source[3] / 2, view);
  const side = (source[2] / k) * style.zoom;
  const gap = source[2] / k / 2 + side / 2 + 30;
  const x = c.x + gap + side / 2 <= FRAME_W ? c.x + gap : c.x - gap;
  const y = clamp(c.y, side / 2, Math.max(side / 2, frameHeight(view) - side / 2));
  return { ...a, at: { x: round(clamp(x, side / 2 - MAX_SIDE, FRAME_W + MAX_SIDE - side / 2)), y: round(y) } };
}

/** The line between a magnified area and its bubble (both in frame units): from the edge of one to the edge of the other. */
export function connector(source: Box, bubble: Box, shape: "circle" | "square"): [Point, Point] | null {
  const from: Point = [source.x + source.w / 2, source.y + source.h / 2];
  const to: Point = [bubble.x + bubble.w / 2, bubble.y + bubble.h / 2];
  const far = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const start = edgePoint(source, to);
  const end: Point = shape === "circle" ? [to[0] - ((to[0] - from[0]) / (far || 1)) * (bubble.w / 2), to[1] - ((to[1] - from[1]) / (far || 1)) * (bubble.w / 2)] : edgePoint(bubble, from);
  // (a bubble over its own area needs no line)
  return far <= bubble.w / 2 + source.w / 2 ? null : [start, end];
}

// --- spotlights ------------------------------------------------------------------------------------------------------------------

export const SPOT_SHAPES = ["rect", "round", "ellipse"] as const;
export type SpotShape = (typeof SPOT_SHAPES)[number];

/** How a picture is dimmed around its spotlights: one style per step (its own, else the guide's). */
export interface SpotStyle {
  /** How strong the dimming is, in percent. */
  dim: number;
  tone: "dark" | "light";
  /** A soft edge instead of a sharp one. */
  soft: boolean;
}

export const SPOT_DEFAULT: SpotStyle = { dim: 55, tone: "dark", soft: false };
export const SPOT_LIMITS = { min: 20, max: 80 } as const;

export function spotStyle(doc: { spotlight?: Partial<SpotStyle> }, block: { spotlight?: Partial<SpotStyle> }): SpotStyle {
  const s = { ...SPOT_DEFAULT, ...doc.spotlight, ...block.spotlight };
  return { dim: numberOf(s.dim, SPOT_DEFAULT.dim, SPOT_LIMITS.min, SPOT_LIMITS.max), tone: s.tone === "light" ? "light" : "dark", soft: s.soft === true };
}

// --- around the picture --------------------------------------------------------------------------------------------------------------

/** The room the marks of a step need around its picture (frame units): the same on both sides, so the picture stays in the middle. */
export interface Outer {
  side: number;
  top: number;
  bottom: number;
}

export const NO_OUTER: Outer = { side: 0, top: 0, bottom: 0 };

/** What a callout or a magnifier covers, with its border (frame units); `null` for every other mark (and callouts of old guides,
 * which stay inside the picture as they always did). */
export function coveredBox(a: Annotation, view: Rect): Box | null {
  let b: Box;
  let extra: number;
  if (a.kind === "callout" && a.box) {
    const s = calloutStyle(a);
    b = a.box;
    extra = s.width / 2 + (s.shape === "cloud" ? CLOUD_BUMP : 0);
  } else if (a.kind === "magnify") {
    b = bubbleBox(a, view);
    extra = magnifyStyle(a).width / 2;
  } else return null;
  return { x: b.x - extra, y: b.y - extra, w: b.w + 2 * extra, h: b.h + 2 * extra };
}

export function outerPadding(annotations: readonly Annotation[] | undefined, view: Rect): Outer {
  const height = frameHeight(view);
  let side = 0;
  let top = 0;
  let bottom = 0;
  for (const a of annotations ?? []) {
    const b = coveredBox(a, view);
    if (!b) continue;
    side = Math.max(side, -b.x, b.x + b.w - FRAME_W);
    top = Math.max(top, -b.y);
    bottom = Math.max(bottom, b.y + b.h - height);
  }
  return { side: Math.ceil(Math.min(side, MAX_SIDE + 40)), top: Math.ceil(Math.min(top, MAX_OUT + 40)), bottom: Math.ceil(Math.min(bottom, MAX_OUT + 40)) };
}

export const hasOuter = (o: Outer): boolean => o.side > 0 || o.top > 0 || o.bottom > 0;

/** The marks that are drawn above everything else, also around the picture. */
export const isOverMark = (a: Annotation): boolean => a.kind === "magnify" || (a.kind === "callout" && !!a.box);
