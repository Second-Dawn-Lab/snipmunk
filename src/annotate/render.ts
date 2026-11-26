// The one renderer: original image + annotations + crop/rotation -> the final picture. The editor's preview, the card
// thumbnails and (Phase 6) copy and export all draw through `renderDoc`, so they cannot disagree.
//
// Redaction is applied to the pixels of the original first (`prepareWork`), before anything is drawn from it: the picture
// that `renderDoc` draws holds no original pixels in a redacted area.
import { redact, clampArea } from "./redact";
import { arrowHead } from "./geometry";
import type { Annotation, AnnotationDoc, LineAnnotation, PenAnnotation, HighlighterAnnotation, ShapeAnnotation, TextAnnotation, EmojiAnnotation } from "./schema";
import { centreLine, circlePolygon, radiusAt, strokeOutline } from "./strokes";
import { textBox } from "./textLayout";
import { docGeometry } from "./transform";

export type Ctx = CanvasRenderingContext2D;

/** Something that can be drawn onto a canvas and read back: a canvas element or an `OffscreenCanvas`. */
export interface WorkCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
}

export type MakeCanvas = (width: number, height: number) => WorkCanvas;

/** The system UI font first, then fonts that have emoji, Chinese, Japanese, Arabic, Hebrew and Indic scripts. */
export const FONT_STACK =
  '"Segoe UI Variable Text","Segoe UI","Segoe UI Emoji","Segoe UI Symbol","Microsoft YaHei UI","Microsoft JhengHei UI","Yu Gothic UI","Nirmala UI","Noto Sans","Noto Color Emoji",sans-serif';

/** Does the text start with a right-to-left letter (Arabic, Hebrew, Syriac, Thaana)? */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if ((c >= 0x590 && c <= 0x8ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) return true;
    // The first letter of any other script decides: left to right.
    if (/\p{L}/u.test(ch)) return false;
  }
  return false;
}

const LINE_HEIGHT = 1.25;

export function textLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Space around the text when it has a solid label. */
export const labelPadding = (fontSize: number) => Math.round(fontSize * 0.3);

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The colour of a text label: white behind dark text, black behind light text. */
export function labelColor(textColor: string): string {
  return luminance(textColor) > 0.4 ? "#000000" : "#ffffff";
}

function polygon(ctx: Ctx, pts: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

function drawPen(ctx: Ctx, a: PenAnnotation): void {
  const poly = strokeOutline(a.points, a.size);
  if (poly.length < 6) return;
  ctx.fillStyle = a.color;
  polygon(ctx, poly);
  ctx.fill();
}

function drawHighlighter(ctx: Ctx, a: HighlighterAnnotation): void {
  const line = centreLine(a.points);
  ctx.save();
  // One path, one stroke, one alpha: where the stroke crosses itself it is not drawn twice, so it does not get darker.
  ctx.globalAlpha = 0.4;
  if (line.length < 4) {
    ctx.fillStyle = a.color;
    polygon(ctx, circlePolygon(line[0] ?? 0, line[1] ?? 0, radiusAt(a.size, 0.5)));
    ctx.fill();
  } else {
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.size;
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(line[0], line[1]);
    for (let i = 2; i + 1 < line.length; i += 2) ctx.lineTo(line[i], line[i + 1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShape(ctx: Ctx, a: ShapeAnnotation): void {
  ctx.save();
  ctx.translate(a.x + a.w / 2, a.y + a.h / 2);
  ctx.rotate(a.rotation);
  ctx.beginPath();
  if (a.type === "rect") ctx.rect(-a.w / 2, -a.h / 2, a.w, a.h);
  else ctx.ellipse(0, 0, Math.max(a.w / 2, 0.01), Math.max(a.h / 2, 0.01), 0, 0, Math.PI * 2);
  if (a.fill !== "none" && a.fillOpacity > 0) {
    ctx.globalAlpha = a.fillOpacity / 100;
    ctx.fillStyle = a.fill;
    ctx.fill();
  }
  if (a.stroke !== "none" && a.strokeOpacity > 0 && a.strokeWidth > 0) {
    ctx.globalAlpha = a.strokeOpacity / 100;
    ctx.strokeStyle = a.stroke;
    ctx.lineWidth = a.strokeWidth;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.restore();
}

function drawLine(ctx: Ctx, a: LineAnnotation): void {
  ctx.save();
  ctx.globalAlpha = a.strokeOpacity / 100;
  ctx.strokeStyle = a.stroke;
  ctx.fillStyle = a.stroke;
  ctx.lineWidth = a.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a.x1, a.y1);
  if (a.type === "arrow" && (a.x1 !== a.x2 || a.y1 !== a.y2)) {
    const head = arrowHead(a.x1, a.y1, a.x2, a.y2, a.strokeWidth);
    ctx.lineTo(head.base.x, head.base.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(head.tip.x, head.tip.y);
    ctx.lineTo(head.left.x, head.left.y);
    ctx.lineTo(head.right.x, head.right.y);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A flipped picture mirrors everything drawn on it; text and emoji are drawn mirrored once more so they stay readable
 * (the position and the turn of the mark still follow the picture). `flip` says which flips the document has.
 */
export interface Flip {
  h: boolean;
  v: boolean;
}

const unflip = (ctx: Ctx, flip?: Flip) => {
  if (flip && (flip.h !== flip.v)) ctx.scale(flip.h ? -1 : 1, flip.v ? -1 : 1);
};

function drawEmoji(ctx: Ctx, a: EmojiAnnotation, flip?: Flip): void {
  ctx.save();
  ctx.translate(a.x + a.size / 2, a.y + a.size / 2);
  ctx.rotate(a.rotation);
  unflip(ctx, flip);
  ctx.font = `${a.size * 0.82}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(a.char, 0, a.size * 0.04);
  ctx.restore();
}

function drawText(ctx: Ctx, a: TextAnnotation, flip?: Flip): void {
  ctx.save();
  ctx.translate(a.x + a.w / 2, a.y + a.h / 2);
  ctx.rotate(a.rotation);
  unflip(ctx, flip);
  const rtl = isRtlText(a.text);
  const pad = a.background ? labelPadding(a.fontSize) : 0;
  if (a.background) {
    ctx.fillStyle = labelColor(a.color);
    ctx.fillRect(-a.w / 2, -a.h / 2, a.w, a.h);
  }
  ctx.fillStyle = a.color;
  ctx.font = `${a.fontSize}px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  const x = rtl ? a.w / 2 - pad : -a.w / 2 + pad;
  // A text with a fixed width wraps inside it (the same wrapping the editor measured the box with).
  const lines = a.fixedWidth
    ? textBox((s) => ctx.measureText(s).width, a.text, a.fontSize, a.background, a.w).lines
    : textLines(a.text);
  lines.forEach((line, i) => ctx.fillText(line, x, -a.h / 2 + pad + i * a.fontSize * LINE_HEIGHT));
  ctx.restore();
}

/** Draw one mark (a redaction is not drawn here: it is already in the pixels of the picture, see `prepareWork`). */
export function drawAnnotation(ctx: Ctx, a: Annotation, flip?: Flip): void {
  switch (a.type) {
    case "pen":
      return drawPen(ctx, a);
    case "highlighter":
      return drawHighlighter(ctx, a);
    case "rect":
    case "ellipse":
      return drawShape(ctx, a);
    case "line":
    case "arrow":
      return drawLine(ctx, a);
    case "emoji":
      return drawEmoji(ctx, a, flip);
    case "text":
      return drawText(ctx, a, flip);
    case "redact":
      return;
  }
}

export function drawAnnotations(ctx: Ctx, items: readonly Annotation[], flip?: Flip): void {
  for (const a of items) drawAnnotation(ctx, a, flip);
}

// --- the picture -------------------------------------------------------------------------------------------------------

/** The redactions of a document, in order. */
export function redactions(items: readonly Annotation[]): Extract<Annotation, { type: "redact" }>[] {
  return items.filter((a): a is Extract<Annotation, { type: "redact" }> => a.type === "redact");
}

/** A key that changes when the redacted pixels would change (so the editor re-makes the work canvas only then). */
export function workKey(items: readonly Annotation[]): string {
  return redactions(items)
    .map((r) => `${r.mode}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`)
    .join("|");
}

/**
 * The original with every redaction applied: a canvas of the original's size whose redacted areas hold pixelated, blurred
 * or black pixels computed from the original, not the original pixels. Everything else is drawn from this canvas.
 */
export function prepareWork(make: MakeCanvas, image: CanvasImageSource, width: number, height: number, items: readonly Annotation[]): WorkCanvas {
  const canvas = make(width, height);
  const ctx = canvas.getContext("2d") as Ctx;
  ctx.drawImage(image, 0, 0);
  for (const r of redactions(items)) {
    const area = clampArea(r, width, height);
    if (!area) continue;
    // Only the pixels of the area are read, changed and written back.
    const data = ctx.getImageData(area.x, area.y, area.w, area.h);
    redact(data, { x: 0, y: 0, w: area.w, h: area.h }, r.mode);
    ctx.putImageData(data, area.x, area.y);
  }
  return canvas;
}

/**
 * Draw the final picture: `work` (from `prepareWork`) cropped, flipped and turned, with the marks on it. `ctx` keeps whatever
 * transform it has (the editor's zoom and pan); `scale` shrinks or enlarges the picture (thumbnails). Returns the size.
 */
export function renderDoc(
  ctx: Ctx,
  work: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  doc: Pick<AnnotationDoc, "crop" | "rotation" | "flipH" | "flipV" | "items">,
  scale = 1,
): { width: number; height: number } {
  const g = docGeometry(doc, srcWidth, srcHeight);
  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);
  const m = g.matrix;
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  // Marks outside the crop are kept in the document but not drawn.
  ctx.beginPath();
  ctx.rect(g.crop.x, g.crop.y, g.crop.w, g.crop.h);
  ctx.clip();
  ctx.drawImage(work, 0, 0);
  drawAnnotations(ctx, doc.items, { h: doc.flipH, v: doc.flipV });
  ctx.restore();
  return { width: Math.max(1, Math.round(g.width * scale)), height: Math.max(1, Math.round(g.height * scale)) };
}
