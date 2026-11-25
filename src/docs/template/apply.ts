// A guide and its template (no React): which template it uses, applying one, and which part of a step picture is shown.

import type { GuideStep } from "../../ipc";
import { viewRect, type GuideDoc, type Rect, type StepBlock } from "../model";
import { areaSource, fillFrame, fitFrame, frameSource, type StepFrame, type ZoomRange } from "./frame";
import { BASIC, COVER_FIELDS, frameRatio, normalizeTemplate, type Template } from "./model";

const cache = new WeakMap<object, Template>();

/** The template the guide uses: its own (completed with the basic values where parts are missing), else the basic one. */
export function templateOf(doc: Pick<GuideDoc, "template">): Template {
  if (!doc.template) return BASIC;
  let t = cache.get(doc.template);
  if (!t) cache.set(doc.template, (t = normalizeTemplate(doc.template)));
  return t;
}

/**
 * Use a template: it is embedded in the guide, and its click marker and step number style become the guide's (one undo step).
 * What was written for the guide stays: the texts of the cover and the logo remain where the new template brings none.
 */
export function applyTemplate(doc: GuideDoc, t: Template): GuideDoc {
  const copy = JSON.parse(JSON.stringify(t)) as Template;
  if (doc.template) {
    const had = templateOf(doc);
    for (const field of COVER_FIELDS) {
      if (copy.cover[field] || !had.cover[field]) continue;
      copy.cover[field] = had.cover[field];
      const rich = had.cover.rich[field];
      if (rich) copy.cover.rich = { ...copy.cover.rich, [field]: rich };
    }
    copy.logo ??= had.logo;
  }
  return { ...doc, template: copy, marker: { ...copy.marker }, badge: copy.steps.badge };
}

/** Change parts of the guide's template (colours, fonts, logo, frame ...): kept with the guide, no template of one's own needed. */
export function changeTemplate(doc: GuideDoc, change: (t: Template) => void): GuideDoc {
  const copy = JSON.parse(JSON.stringify(templateOf(doc))) as Template;
  change(copy);
  const next = normalizeTemplate(copy);
  const marker = JSON.stringify(next.marker) !== JSON.stringify(templateOf(doc).marker) ? { ...next.marker } : doc.marker;
  const badge = next.steps.badge !== templateOf(doc).steps.badge ? next.steps.badge : doc.badge;
  return { ...doc, template: next, marker, badge };
}

type Pictured = Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault" | "template">;

export interface Framing {
  /** The part of the picture that is shown. */
  view: Rect;
  /** The ratio of the template's frame; `null` without one ("Original"). */
  ratio: number | null;
  /** The place in the frame that is shown; `null` for a picture without a frame that was not zoomed. */
  frame: StepFrame | null;
  /** The area of the step (its picture area, or the zoom into the click). */
  area: Rect;
  /** "Fit": the whole area visible. */
  fit: StepFrame;
  /** "Fill": the frame filled with real screen content (without a frame the same as "Fit"). */
  fill: StepFrame;
  /** The place the zoom and the dragging start from. */
  now: StepFrame;
  range: ZoomRange;
}

/** Everything about the part of a step picture that is shown and how it can be zoomed and moved. */
export function framing(step: GuideStep, block: StepBlock, doc: Pictured): Framing {
  const ratio = frameRatio(templateOf(doc));
  // (a zoom has the frame's shape, so filling the frame never takes in more than the zoom shows)
  const area = viewRect(step, block, doc, ratio);
  if (ratio === null) {
    // No frame: the picture's own shape, zoomed inside the shown area.
    const fit: StepFrame = { cx: area[0] + area[2] / 2, cy: area[1] + area[3] / 2, w: area[2], own: true };
    const frame = block.frame?.own ? block.frame : null;
    const view = frame ? areaSource(frame, area) : area;
    const now: StepFrame = { cx: view[0] + view[2] / 2, cy: view[1] + view[3] / 2, w: view[2], own: true };
    return { view, ratio, frame, area, fit, fill: fit, now, range: { fit: area[2], widest: area[2], narrowest: Math.max(Math.min(40, area[2]), area[2] / 8) } };
  }
  const fill = fillFrame(area, ratio, step.imageSize);
  const fit = fitFrame(area, ratio);
  const frame = block.frame && !block.frame.own ? block.frame : fill;
  const view = frameSource(frame, ratio, step.imageSize);
  const widest = Math.max(fit.w, step.imageSize[0] * 1.5, frame.w);
  const narrowest = Math.min(frame.w, Math.max(40, fit.w / 8));
  return { view, ratio, frame, area, fit, fill, now: { cx: view[0] + view[2] / 2, cy: view[1] + view[3] / 2, w: frame.w }, range: { fit: fit.w, widest, narrowest } };
}

/** The part of a step picture that is shown: the area (or zoom) of the step, put into the template's frame when it has one. */
export function shownRect(step: GuideStep, block: StepBlock, doc: Pictured): { view: Rect; ratio: number | null; frame: StepFrame | null } {
  const { view, ratio, frame } = framing(step, block, doc);
  return { view, ratio, frame };
}

/**
 * The document as it is written to a file: with a frame, every step carries its place in it, so the file keeps exactly the part
 * that is shown (and a step keeps it when the file is opened again).
 */
export function materializeFrames(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>): GuideDoc {
  if (frameRatio(templateOf(doc)) === null) return doc;
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.type !== "step" || b.frame) return b;
      const step = steps.get(b.n);
      if (!step?.image) return b;
      return { ...b, frame: shownRect(step, b, doc).frame };
    }),
  };
}
