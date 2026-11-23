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

export type AnnotationKind = "arrow" | "line" | "rect" | "ellipse" | "highlight" | "pen" | "text" | "callout" | "badge";
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** Pixels of the step picture. */
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  points?: [number, number][];
  color: string;
  width: number;
  text?: string;
  n?: number;
}

export interface Redaction {
  rect: Rect;
  kind: "blur" | "pixelate" | "black";
}

export interface StepBlock {
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
  markerHidden?: boolean;
  markerPos?: [number, number];
  marker?: Partial<MarkerStyle>;
  annotations?: Annotation[];
  redact?: Redaction[];
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
  version: number;
  title: string;
  created: number;
  marker: MarkerStyle;
  badge: "circle" | "square" | "none";
  picture: "window" | "screen";
  keepFull: boolean;
  zoomDefault: boolean;
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

/** Steps of the working folder that no block shows yet (recorded after the document was made): they are appended as blocks. */
export function syncSteps(doc: GuideDoc, steps: readonly GuideStep[], after?: string): GuideDoc {
  const have = new Set(doc.blocks.filter((b): b is StepBlock => b.type === "step").map((b) => b.n));
  const fresh = steps.filter((s) => !s.deleted && !have.has(s.n)).map((s) => ({ id: newId(), type: "step", n: s.n }) as StepBlock);
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

/** The numbers shown in the badges: the steps counted in the order of the blocks (content blocks do not count). */
export function stepNumbers(doc: GuideDoc): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const b of doc.blocks) if (b.type === "step") m.set(b.id, ++n);
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

/** The rectangle that is shown: the zoom area when zoom is on for the step, else the crop. */
export function viewRect(step: GuideStep, block: StepBlock, doc: Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault">): Rect {
  const crop = cropRect(step, block, doc);
  const zoomOn = block.zoom ?? doc.zoomDefault;
  const z = block.zoomRect ?? step.zoom;
  if (zoomOn && z && step.click) {
    const x = Math.max(crop[0], Math.min(crop[0] + crop[2] - 1, z[0]));
    const y = Math.max(crop[1], Math.min(crop[1] + crop[3] - 1, z[1]));
    return [x, y, Math.max(8, Math.min(crop[0] + crop[2] - x, z[2])), Math.max(8, Math.min(crop[1] + crop[3] - y, z[3]))];
  }
  return crop;
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
