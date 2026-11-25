import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ipc, type GuideStep } from "../../ipc";
import { FRAME_W, NO_OUTER, canvasMeasure, hasOuter, isOverMark, outerPadding, rectOf, sourcePicture, spotStyle, type Measure } from "../marks";
import { CalloutArt, MagnifyArt, SpotlightArt, type SourceImage } from "../marksArt";
import { markerColor, type Block, type GuideDoc, type MarkerShape, type MarkerSize, type Rect, type StepBlock } from "../model";
import { AnnotationShape } from "../StepPicture";
import { shownRect, templateOf } from "../template/apply";
import { ART_KEY, BACKGROUND_KEY, hasArt } from "../template/background";
import { colorsOf, pageSize, type Background } from "../template/model";
import { imageKey, type ExportImage, type PmNode } from "./html";

export interface PictureOptions {
  markers: boolean;
  annotations: boolean;
  /** `null`: lossless PNG; else JPEG with this quality (0.3 to 1). */
  jpeg: number | null;
}

/** The widest picture an export holds (wider screens are scaled down). */
const MAX_WIDTH = 2000;

const MARKER_PX: Record<MarkerSize, number> = { small: 22, medium: 34, large: 52 };

/** The click marker as SVG at a picture position; `unit` is the size of one screen pixel of the editor in picture pixels. */
export function markerSvg(shape: MarkerShape, size: MarkerSize, color: string, x: number, y: number, unit: number): string {
  const px = MARKER_PX[size] * unit;
  const r = px / 2;
  const stroke = Math.max(3 * unit, px / 8);
  if (shape === "box") {
    return `<rect x="${x - px * 0.9}" y="${y - r}" width="${px * 1.8}" height="${px}" rx="${6 * unit}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="${stroke}"/>`;
  }
  if (shape === "arrow" || shape === "hand") {
    const hand = shape === "hand";
    const k = px / 24;
    const d = hand
      ? "M9 3a1.5 1.5 0 0 1 3 0v6l.3.1 4.2 1.5A2 2 0 0 1 18 12.5V17c0 2.8-2.2 5-5 5h-1.6a5 5 0 0 1-3.9-1.9L4.6 15a1.5 1.5 0 0 1 2.3-1.9L9 15z"
      : "M3 2l15 9-6.5 1.6 3.7 7.2-2.8 1.4-3.7-7.2L4.5 18z";
    return `<path transform="translate(${x - px * (hand ? 0.38 : 0.08)} ${y - px * 0.06}) scale(${k})" d="${d}" fill="${hand ? "#fff" : color}" stroke="${hand ? color : "#fff"}" stroke-width="${hand ? 1.8 : 1.5}" stroke-linejoin="round"/>`;
  }
  const dot = shape === "ring" ? `<circle cx="${x}" cy="${y}" r="${px / 8}" fill="${color}"/>` : "";
  return (
    `<circle cx="${x}" cy="${y}" r="${r + unit}" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="${2 * unit}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r - stroke / 2}" fill="none" stroke="${color}" stroke-width="${stroke}"/>${dot}`
  );
}

const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("a picture of the export could not be read"));
    i.src = src;
  });

/** The marks drawn on the picture itself, as SVG: the dimming around spotlights, then the drawn marks. */
export function markLayer(block: StepBlock, doc: Pick<GuideDoc, "spotlight">, view: Rect): string {
  const unit = Math.max(1, view[2] / 700);
  const marks = block.annotations ?? [];
  const spots = marks.filter((a) => a.kind === "spot");
  const drawn = marks.filter((a) => a.kind !== "spot" && !isOverMark(a));
  if (spots.length === 0 && drawn.length === 0) return "";
  return svgBody(
    <>
      <SpotlightArt spots={spots} style={spotStyle(doc, block)} view={view} id="spot" />
      {drawn.map((a) => (
        <AnnotationShape key={a.id} a={a} sel={false} onSelect={() => undefined} unit={unit} />
      ))}
    </>,
  );
}

/** SVG elements as markup, without the element around them (inside one, React knows their names). */
function svgBody(elements: ReactNode): string {
  const markup = renderToStaticMarkup(<svg>{elements}</svg>);
  return markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</svg>"));
}

/** Callouts and magnifiers as SVG: the marks above everything, which may reach beyond the picture. `sources` holds the pixels
 * of every magnified area by the id of its mark. */
export function overLayer(block: StepBlock, view: Rect, sources: ReadonlyMap<string, SourceImage>, measure: Measure = canvasMeasure): string {
  const over = (block.annotations ?? []).filter(isOverMark);
  if (over.length === 0) return "";
  return svgBody(over.map((a) => (a.kind === "callout" ? <CalloutArt key={a.id} a={a} view={view} measure={measure} /> : <MagnifyArt key={a.id} a={a} view={view} id={`mag-${a.id}`} image={sources.get(a.id) ?? null} />)));
}

/** The pixels of every magnified area at their full resolution, with the redactions burned in by the backend. */
async function magnified(step: GuideStep, block: StepBlock, background: string): Promise<Map<string, SourceImage>> {
  const out = new Map<string, SourceImage>();
  for (const a of block.annotations ?? []) {
    if (a.kind !== "magnify") continue;
    const from = sourcePicture(a, step.image, step.imageSize);
    const [x, y, width, height] = rectOf(a).map(Math.round) as Rect;
    const redact = (block.redact ?? []).map((r) => ({ rect: [r.rect[0] - from.x, r.rect[1] - from.y, r.rect[2], r.rect[3]] as Rect, kind: r.kind }));
    const part = await ipc.docExportPicture(from.file, [x - from.x, y - from.y, Math.max(1, width), Math.max(1, height)], redact, background);
    out.set(a.id, { href: `data:image/png;base64,${part.base64}`, x, y, width, height });
  }
  return out;
}

const svgImage = (width: number, height: number, viewBox: readonly number[], body: string) =>
  load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.join(" ")}">${body}</svg>`)}`);

const canvasOf = (width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const c = canvas.getContext("2d")!;
  c.imageSmoothingQuality = "high";
  return [canvas, c];
};

/**
 * The picture of a step as every export shows it: the shown area (crop, zoom or template frame) with the redactions burned in by
 * the backend (the original pixels never reach the page), then the spotlights, the marks, the click marker, the magnifiers and
 * the callouts drawn on it. Where callouts or magnifiers reach beyond the picture, the result also carries them as a layer of
 * their own (`over`, for the HTML pages, which keep the template's frame around the picture) and one picture of everything on
 * a wider canvas (`whole`, for Word, Markdown and "Copy as").
 */
export async function stepImage(step: GuideStep, block: StepBlock, doc: GuideDoc, o: PictureOptions): Promise<ExportImage> {
  const { view } = shownRect(step, block, doc);
  const area = view.map(Math.round) as Rect;
  const bg = colorsOf(templateOf(doc)).background;
  const redact = (block.redact ?? []).map((r) => ({ rect: r.rect, kind: r.kind }));
  const base = await ipc.docExportPicture(step.image, area, redact, bg);
  const img = await load(`data:image/png;base64,${base.base64}`);
  const scale = Math.min(1, MAX_WIDTH / area[2]);
  const [canvas, c] = canvasOf(area[2] * scale, area[3] * scale);
  c.drawImage(img, 0, 0, canvas.width, canvas.height);
  const unit = Math.max(1, area[2] / 700);
  const shapes = o.annotations ? markLayer(block, doc, area) : "";
  const click = step.click && step.kind !== "type" && step.kind !== "key" && !block.markerHidden ? (block.markerPos ?? step.click) : null;
  const style = { ...doc.marker, ...block.marker };
  const marker = o.markers && click ? markerSvg(style.shape, style.size, markerColor(step, block, doc), click[0], click[1], unit) : "";
  if (shapes || marker) c.drawImage(await svgImage(canvas.width, canvas.height, area, shapes + marker), 0, 0);
  const encode = (from: HTMLCanvasElement) => (o.jpeg === null ? from.toDataURL("image/png") : from.toDataURL("image/jpeg", o.jpeg));
  const over = o.annotations ? overLayer(block, area, await magnified(step, block, bg)) : "";
  const outer = over ? outerPadding(block.annotations, area) : NO_OUTER;
  if (!hasOuter(outer)) {
    if (over) c.drawImage(await svgImage(canvas.width, canvas.height, area, over), 0, 0);
    return { src: encode(canvas), width: canvas.width, height: canvas.height };
  }
  // Around the picture: the same room on both sides, as the editor keeps it.
  const [side, top, bottom] = [outer.side / FRAME_W, outer.top / FRAME_W, outer.bottom / FRAME_W];
  const wide = canvas.width * (1 + 2 * side);
  const high = canvas.height + canvas.width * (top + bottom);
  const extent = [area[0] - side * area[2], area[1] - top * area[2], area[2] * (1 + 2 * side), area[3] + (top + bottom) * area[2]];
  const [layer, lc] = canvasOf(wide, high);
  lc.drawImage(await svgImage(layer.width, layer.height, extent, over), 0, 0);
  const [all, ac] = canvasOf(wide, high);
  if (o.jpeg !== null) {
    // (a JPEG has no transparency: the page's colour stands around the picture)
    ac.fillStyle = bg;
    ac.fillRect(0, 0, all.width, all.height);
  }
  ac.drawImage(canvas, canvas.width * side, canvas.width * top);
  ac.drawImage(layer, 0, 0);
  return {
    src: encode(canvas),
    width: canvas.width,
    height: canvas.height,
    over: { src: layer.toDataURL("image/png"), width: layer.width, height: layer.height, side, top, bottom },
    whole: { src: encode(all), width: all.width, height: all.height },
  };
}

/** An image of the guide (inserted, logo, cover), cut to the crop of its node (fractions of the original). */
export async function fileImage(file: string, crop: number[] | null): Promise<ExportImage> {
  const base = await ipc.docExportPicture(file, null, [], "#FFFFFF");
  let src = `data:image/png;base64,${base.base64}`;
  if (!crop) return { src, width: base.width, height: base.height };
  const img = await load(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop[2] * img.naturalWidth));
  canvas.height = Math.max(1, Math.round(crop[3] * img.naturalHeight));
  canvas.getContext("2d")!.drawImage(img, crop[0] * img.naturalWidth, crop[1] * img.naturalHeight, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  src = canvas.toDataURL("image/png");
  return { src, width: canvas.width, height: canvas.height };
}

/** The background picture as it is drawn: its opacity and grey are in the picture itself, so every format shows them. */
export async function backgroundPicture(file: string, b: Pick<Background, "opacity" | "grey">): Promise<ExportImage> {
  const base = await fileImage(file, null);
  if (b.opacity >= 100 && !b.grey) return base;
  const img = await load(base.src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext("2d")!;
  c.globalAlpha = b.opacity / 100;
  if (b.grey) c.filter = "grayscale(1)";
  c.drawImage(img, 0, 0);
  return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** How much of the overlay covers the picture of the "image" cover. */
const OVERLAY = 0.45;

/**
 * The picture a cover shows as part of itself (designs "image" and "split"): its opacity and grey, and for "image" the dark or
 * light overlay under the texts, drawn into it, so every format shows the same.
 */
export async function artPicture(file: string, b: Pick<Background, "opacity" | "grey">, overlay: "dark" | "light" | null, shape?: number): Promise<ExportImage> {
  const base = await backgroundPicture(file, b);
  if (!overlay && !shape) return base;
  const img = await load(base.src);
  const [w, h] = [img.naturalWidth, img.naturalHeight];
  // (cut to the shape of its place, around the middle: Word places a picture as it is)
  const [cw, ch] = !shape ? [w, h] : w / h > shape ? [h * shape, h] : [w, w / shape];
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw));
  canvas.height = Math.max(1, Math.round(ch));
  const c = canvas.getContext("2d")!;
  c.drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
  if (overlay) {
    c.fillStyle = overlay === "dark" ? `rgba(0,0,0,${OVERLAY})` : `rgba(255,255,255,${OVERLAY + 0.15})`;
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** Every inserted image node of a piece of rich text. */
function imagesOf(node: PmNode, out: PmNode[]) {
  if (node.type === "image" && node.attrs?.file) out.push(node);
  node.content?.forEach((c) => imagesOf(c, out));
}

/**
 * All pictures of the blocks of an export, by block id (steps) and `imageKey` (inserted images, logo, cover). `progress` is told
 * how far it is; a `signal` that is aborted stops between two pictures.
 */
export async function collectPictures(
  doc: GuideDoc,
  blocks: readonly Block[],
  steps: ReadonlyMap<number, GuideStep>,
  o: PictureOptions,
  progress: (done: number, of: number) => void = () => undefined,
  signal?: AbortSignal,
): Promise<Map<string, ExportImage>> {
  const jobs: [string, () => Promise<ExportImage>][] = [];
  for (const b of blocks) {
    if (b.type === "step") {
      const step = steps.get(b.n);
      if (step?.image) jobs.push([b.id, () => stepImage(step, b, doc, o)]);
    }
    const nodes: PmNode[] = [];
    const rich = b.type === "step" ? b.desc : b.doc;
    if (rich) imagesOf(rich as unknown as PmNode, nodes);
    for (const n of nodes) jobs.push([imageKey(n.attrs!), () => fileImage(String(n.attrs!.file), (n.attrs!.crop as number[] | null) ?? null)]);
  }
  const t = templateOf(doc);
  const { logo } = t;
  if (logo) jobs.push([logo, () => fileImage(logo, null)]);
  const behind = t.cover.image;
  if (behind) jobs.push([BACKGROUND_KEY, () => backgroundPicture(behind, t.background)]);
  if (behind && hasArt(t.cover.design)) {
    const page = pageSize(t) ?? { w: 210, h: 297 };
    const [overlay, share] = t.cover.design === "image" ? [t.cover.overlay, 1] : [null, 0.5];
    jobs.push([ART_KEY, () => artPicture(behind, t.background, overlay, (page.w * share) / page.h)]);
  }
  const out = new Map<string, ExportImage>();
  for (let i = 0; i < jobs.length; i++) {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
    const [key, run] = jobs[i];
    if (!out.has(key)) {
      try {
        out.set(key, await run());
      } catch (e) {
        // A picture of the template that is gone does not stop the export; a step picture does.
        if (key !== t.logo && key !== BACKGROUND_KEY && key !== ART_KEY) throw e;
      }
    }
    progress(i + 1, jobs.length);
  }
  return out;
}
