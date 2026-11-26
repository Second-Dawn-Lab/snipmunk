import type { SpotStyle } from "./marks";
import type { StepFrame } from "./template/frame";
import type { Template } from "./template/model";
// The guide document of Documents mode (no React): blocks, the operations on them, and the document-level undo/redo history.
// The same JSON is `document.json` of the working folder and of a `.snpd` file (see docs/snpd-format.md).
import type { GuideStep } from "../ipc";

export type Rect = [number, number, number, number];
export type Part = { t: string; b?: boolean };
/** ProseMirror JSON of a rich text. */
export type PmDoc = { type: string; content?: unknown[]; [k: string]: unknown };

export type MarkerShape = "circle" | "ring" | "arrow" | "hand" | "box";
export type MarkerSize = "small" | "medium" | "large";
export interface MarkerStyle {
  left: string;
  right: string;
  shape: MarkerShape;
  size: MarkerSize;
}

export type AnnotationKind = "arrow" | "line" | "rect" | "ellipse" | "highlight" | "pen" | "text" | "callout" | "badge" | "spot" | "magnify";
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** Pixels of the step picture. (A callout with a `box`: x, y is the box, x2, y2 the tip. A magnifier and a spotlight: the
   * corners of their area.) */
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  points?: [number, number][];
  color: string;
  width: number;
  text?: string;
  n?: number;
  /** A callout's box in frame units (see docs/marks.ts); without it the callout is one of before 7.5-D. */
  box?: { x: number; y: number; w: number; h: number };
  /** The shape of a callout, a spotlight or a magnifier's bubble. */
  shape?: string;
  fill?: string;
  textColor?: string;
  /** The font size of a callout (frame units). */
  size?: number;
  bold?: boolean;
  /** The centre of a magnifier's bubble (frame units), how many times it enlarges, and its line to the area. */
  at?: { x: number; y: number };
  zoom?: number;
  line?: boolean;
  /** The pixels of a magnified area that lies outside the stored picture of a saved guide. */
  patch?: { file: string; x: number; y: number; x2: number; y2: number };
}

export interface Redaction {
  rect: Rect;
  kind: "blur" | "pixelate" | "black";
}

export interface StepBlock {
  /** The step shows no number and is not counted: the next step takes it. */
  numberHidden?: boolean;
  /** The typed text of this typing step is masked; it is left out of saved files. */
  maskTyped?: boolean;
  /** Quick redact hid something of this step: a saved file takes its words from `text` and keeps no names of the control and
   * the window. */
  masked?: boolean;
  /** The step's own place in the template's picture frame (centre and width, picture pixels). */
  frame?: StepFrame | null;
  id: string;
  type: "step";
  /** The number of the step in the working folder (its picture and recorded data). */
  n: number;
  /** The step text as edited (parts); absent = the generated text. */
  text?: Part[];
  /** An optional description below the text (rich text). */
  desc?: PmDoc | null;
  /** Zoom on/off for this step; absent = the default of the guide. */
  zoom?: boolean;
  zoomRect?: Rect;
  /** What the picture shows: absent = the guide default (the window / the screen); a rectangle = a chosen crop. */
  crop?: Rect | null;
  /** In a guide opened from a file: the area the step had chosen; its stored picture is exactly that area. */
  areaChoice?: "screen" | "window" | "custom";
  markerHidden?: boolean;
  markerPos?: [number, number];
  marker?: Partial<MarkerStyle>;
  annotations?: Annotation[];
  redact?: Redaction[];
  /** How this step's spotlights dim the picture, where it differs from the guide's `spotlight`. */
  spotlight?: Partial<SpotStyle>;
  [k: string]: unknown;
}

export interface ContentBlock {
  id: string;
  type: "content";
  doc: PmDoc;
  [k: string]: unknown;
}

export type Block = StepBlock | ContentBlock;

export interface GuideDoc {
  /** The template of the guide, embedded (absent: the basic one, and no styling is applied in older versions). */
  template?: Template;
  version: number;
  title: string;
  created: number;
  marker: MarkerStyle;
  badge: "circle" | "square" | "pill" | "none";
  picture: "window" | "screen";
  keepFull: boolean;
  zoomDefault: boolean;
  /** The guide's style of spotlights. */
  spotlight?: SpotStyle;
  blocks: Block[];
  [k: string]: unknown;
}

let counter = 0;
export const newId = (): string => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyText = (): PmDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

/** A new document from the recorded steps (every step is a block) and the defaults of the settings. */
export function createDocument(title: string, created: number, steps: readonly GuideStep[], defaults: Pick<GuideDoc, "marker" | "badge" | "picture" | "keepFull" | "zoomDefault">): GuideDoc {
  return {
    version: 1,
    title,
    created,
    ...defaults,
    blocks: steps.filter((s) => !s.deleted).map((s) => ({ id: newId(), type: "step", n: s.n }) as StepBlock),
  };
}

/** The picture area a step recorded with `area` needs when the guide shows something else: a chosen window or region in a
 * guide of whole screens, the whole screen in a guide of windows. */
function cropFor(doc: Pick<GuideDoc, "picture" | "keepFull">, step: GuideStep, area: string | undefined): Pick<StepBlock, "crop"> {
  if ((area === "window" || area === "region") && doc.picture === "screen" && step.window) return { crop: step.window.rect };
  if (area === "screen" && doc.picture === "window") return { crop: [0, 0, step.imageSize[0], step.imageSize[1]] };
  return {};
}

/** Steps of the working folder that no block shows yet (recorded after the document was made): they are appended as blocks. */
export function syncSteps(doc: GuideDoc, steps: readonly GuideStep[], after?: string, area?: string): GuideDoc {
  const have = new Set(doc.blocks.filter((b): b is StepBlock => b.type === "step").map((b) => b.n));
  const fresh = steps.filter((s) => !s.deleted && !have.has(s.n)).map((s) => ({ id: newId(), type: "step", n: s.n, ...cropFor(doc, s, area) }) as StepBlock);
  if (fresh.length === 0) return doc;
  const at = after ? doc.blocks.findIndex((b) => b.id === after) + 1 : doc.blocks.length;
  const blocks = [...doc.blocks];
  blocks.splice(at <= 0 ? blocks.length : at, 0, ...fresh);
  return { ...doc, blocks };
}

export const indexOfBlock = (doc: GuideDoc, id: string): number => doc.blocks.findIndex((b) => b.id === id);

export function insertBlock(doc: GuideDoc, index: number, block: Block): GuideDoc {
  const blocks = [...doc.blocks];
  blocks.splice(Math.max(0, Math.min(blocks.length, index)), 0, block);
  return { ...doc, blocks };
}

export function removeBlocks(doc: GuideDoc, ids: ReadonlySet<string>): GuideDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => !ids.has(b.id)) };
}

/** Move a block up (-1) or down (+1). */
export function moveBlock(doc: GuideDoc, id: string, delta: number): GuideDoc {
  const i = indexOfBlock(doc, id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return { ...doc, blocks };
}

/** Move a block so it sits before the block at `index` (of the list before the move). */
export function moveBlockTo(doc: GuideDoc, id: string, index: number): GuideDoc {
  const from = indexOfBlock(doc, id);
  if (from < 0) return doc;
  const blocks = [...doc.blocks];
  const [b] = blocks.splice(from, 1);
  blocks.splice(index > from ? index - 1 : index, 0, b);
  return { ...doc, blocks };
}

/** Move several blocks together (keeping their order) so they sit before the block at `index` (of the list before the move). */
export function moveBlocksTo(doc: GuideDoc, ids: ReadonlySet<string>, index: number): GuideDoc {
  const moving = doc.blocks.filter((b) => ids.has(b.id));
  if (moving.length === 0) return doc;
  const before = doc.blocks.slice(0, index).filter((b) => ids.has(b.id)).length;
  const rest = doc.blocks.filter((b) => !ids.has(b.id));
  const at = index - before;
  return { ...doc, blocks: [...rest.slice(0, at), ...moving, ...rest.slice(at)] };
}

/** Move several blocks (in their order) up or down by one place as a group. */
export function moveBlocks(doc: GuideDoc, ids: ReadonlySet<string>, delta: -1 | 1): GuideDoc {
  const blocks = [...doc.blocks];
  const order = delta < 0 ? blocks.map((_, i) => i) : blocks.map((_, i) => blocks.length - 1 - i);
  for (const i of order) {
    const j = i + delta;
    if (ids.has(blocks[i].id) && j >= 0 && j < blocks.length && !ids.has(blocks[j].id)) [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return { ...doc, blocks };
}

/** A copy of a block right after it, with its own id (a step shares the picture; its edits are its own). */
export function duplicateBlock(doc: GuideDoc, id: string): { doc: GuideDoc; id: string | null } {
  const i = indexOfBlock(doc, id);
  if (i < 0) return { doc, id: null };
  const copy = JSON.parse(JSON.stringify(doc.blocks[i])) as Block;
  copy.id = newId();
  return { doc: insertBlock(doc, i + 1, copy), id: copy.id };
}

export function updateBlock<T extends Block>(doc: GuideDoc, id: string, change: Partial<T>): GuideDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...change } as Block) : b)) };
}

/** The numbers shown in the badges: the steps counted in the order of the blocks (content blocks and steps without a number do
 * not count). */
export function stepNumbers(doc: GuideDoc): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const b of doc.blocks) if (b.type === "step" && !b.numberHidden) m.set(b.id, ++n);
  return m;
}

/** The text of every step as a numbered list. */
export function stepTexts(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>): string[] {
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.type !== "step") continue;
    const parts = b.text ?? steps.get(b.n)?.text ?? [];
    out.push(parts.map((p) => p.t).join(""));
  }
  return out;
}

// --- what a step shows ---------------------------------------------------------------------------------------------------------

/** The part of the step picture that is shown: a chosen crop, else the window or the whole screen as the guide says. */
export function cropRect(step: GuideStep, block: StepBlock, doc: Pick<GuideDoc, "picture" | "keepFull">): Rect {
  const [iw, ih] = step.imageSize;
  const whole: Rect = [0, 0, iw, ih];
  const clamp = (r: Rect): Rect => {
    const x = Math.max(0, Math.min(iw - 1, r[0]));
    const y = Math.max(0, Math.min(ih - 1, r[1]));
    return [x, y, Math.max(1, Math.min(iw - x, r[2] - (x - r[0]))), Math.max(1, Math.min(ih - y, r[3] - (y - r[1])))];
  };
  if (block.crop) return clamp(block.crop);
  if (doc.keepFull || doc.picture === "screen") return whole;
  const w = step.window?.rect;
  return w && w[2] > 8 && w[3] > 8 ? clamp(w) : whole;
}

/** Does the step show its zoom into the click? Its own setting, else the guide's. */
export const zoomOn = (block: StepBlock, doc: Pick<GuideDoc, "zoomDefault">): boolean => block.zoom ?? doc.zoomDefault;

/** The most of its area that the automatic zoom shows (so that it is a zoom in a small window too). */
const AUTO_SHARE = 0.6;

/**
 * The zoom into a click INSIDE the area the step shows (window, screen or chosen crop). `zoom` is the recorded zoom around the
 * click, or with `own` the area drawn for this step; with `ratio` (a picture frame) the result has that shape. It never leaves
 * the area: it is made smaller where it is larger, and moved inside where it reaches over an edge.
 */
export function zoomInside(zoom: Rect, own: boolean, click: [number, number], area: Rect, ratio: number | null = null): Rect {
  const [ax, ay, aw, ah] = area;
  let w = Math.max(8, zoom[2]);
  let h = Math.max(8, zoom[3]);
  if (ratio) {
    w = Math.max(w, h * ratio);
    h = w / ratio;
  }
  const most = own ? 1 : AUTO_SHARE;
  const k = Math.min(1, (most * aw) / w, (most * ah) / h);
  w = Math.max(1, Math.min(aw, Math.round(w * k)));
  h = Math.max(1, Math.min(ah, Math.round(h * k)));
  // A drawn area stays where it was drawn; the automatic one is around the click.
  const [cx, cy] = own ? [zoom[0] + zoom[2] / 2, zoom[1] + zoom[3] / 2] : click;
  const place = (centre: number, len: number, from: number, room: number) => Math.round(Math.max(from, Math.min(from + room - len, centre - len / 2)));
  return [place(cx, w, ax, aw), place(cy, h, ay, ah), w, h];
}

/** The rectangle that is shown: the zoom into the click (inside the crop) when zoom is on for the step, else the crop. */
export function viewRect(step: GuideStep, block: StepBlock, doc: Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault">, ratio: number | null = null): Rect {
  const crop = cropRect(step, block, doc);
  const z = block.zoomRect ?? step.zoom;
  if (zoomOn(block, doc) && z && step.click) return zoomInside(z, !!block.zoomRect, block.markerPos ?? step.click, crop, ratio);
  return crop;
}

/**
 * The guide's "Zoom into the click". It changes only the steps that have no setting of their own; their place in the picture
 * frame was made for the earlier area, so it is made anew.
 */
export function setZoomDefault(doc: GuideDoc, zoomDefault: boolean, steps: ReadonlyMap<number, GuideStep>): GuideDoc {
  return { ...doc, zoomDefault, blocks: doc.blocks.map((b) => (b.type === "step" && b.zoom === undefined && b.frame && steps.get(b.n)?.click ? { ...b, frame: undefined } : b)) };
}

/** The marker colour for a step: right click uses the right colour, the others the left one. */
export function markerColor(step: GuideStep, block: StepBlock, doc: Pick<GuideDoc, "marker">): string {
  const m = { ...doc.marker, ...block.marker };
  return step.kind === "rightClick" ? m.right : m.left;
}

// --- history ---------------------------------------------------------------------------------------------------------------------

/**
 * One history for the whole document: every change pushes the document it replaced (the documents share their unchanged parts, so a
 * snapshot is cheap). Undo and redo move between them. It is cleared when the guide is closed.
 */
export class History {
  private past: GuideDoc[] = [];
  private future: GuideDoc[] = [];
  private lastKey = "";
  private lastAt = 0;

  /** Remember `before` as the state to go back to. Changes with the same `key` within `merge` ms (typing) count as one. */
  push(before: GuideDoc, key = "", merge = 800, now = Date.now()): void {
    if (key && key === this.lastKey && now - this.lastAt < merge) {
      this.lastAt = now;
      this.future = [];
      return;
    }
    this.past.push(before);
    if (this.past.length > 300) this.past.shift();
    this.future = [];
    this.lastKey = key;
    this.lastAt = now;
  }

  undo(now: GuideDoc): GuideDoc | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(now);
    this.lastKey = "";
    return prev;
  }

  redo(now: GuideDoc): GuideDoc | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(now);
    this.lastKey = "";
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = "";
  }
}
