import type { GuideStep } from "../ipc";
import { cropRect, type Rect, type StepBlock } from "./model";

export type Area = "default" | "window" | "screen" | "custom" | "grow25" | "grow50";

const sameRect = (a: Rect, b: Rect) => a.every((v, i) => v === b[i]);

/** The window of the step (or the whole picture when there is none), as a crop rectangle. */
const windowRect = (step: GuideStep, block: StepBlock): Rect => cropRect(step, { ...block, crop: null }, { picture: "window", keepFull: false });

/** Which picture area a step uses: the guide's, the window, the whole screen or a crop of its own. */
export function areaOf(step: GuideStep, block: StepBlock): "default" | "window" | "screen" | "custom" {
  if (!block.crop) return "default";
  const [iw, ih] = step.imageSize;
  // (in a guide opened from a file the whole stored picture is what the step chose then, which the file names)
  if (sameRect(block.crop, [0, 0, iw, ih])) return block.areaChoice ?? "screen";
  return sameRect(block.crop, windowRect(step, block)) ? "window" : "custom";
}

/** Grow a rectangle around its centre by a factor, inside the picture. */
export function grow(r: Rect, factor: number, size: [number, number]): Rect {
  const [iw, ih] = size;
  const w = Math.min(iw, Math.round(r[2] * (1 + factor)));
  const h = Math.min(ih, Math.round(r[3] * (1 + factor)));
  const x = Math.max(0, Math.min(iw - w, Math.round(r[0] + r[2] / 2 - w / 2)));
  const y = Math.max(0, Math.min(ih - h, Math.round(r[1] + r[3] / 2 - h / 2)));
  return [x, y, w, h];
}

/** Choose the picture area of a step (the change is stored in the step; the file keeps only this area when it is saved). */
export function applyArea(step: GuideStep, block: StepBlock, v: Area, patch: (c: Partial<StepBlock>) => void): void {
  const [iw, ih] = step.imageSize;
  // (a new choice replaces the one a file named)
  const set = (crop: Rect | null) => patch({ crop, areaChoice: undefined });
  if (v === "default") set(null);
  else if (v === "screen") set([0, 0, iw, ih]);
  else if (v === "window") set(windowRect(step, block));
  else if (v === "grow25" || v === "grow50") set(grow(block.crop ?? windowRect(step, block), v === "grow25" ? 0.25 : 0.5, [iw, ih]));
}
