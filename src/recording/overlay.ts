// Where the webcam picture goes on the recording, and how big the cursor is (no React): laid out at play and render time.

export type WebcamShape = "circle" | "rounded" | "rectangle";
export type WebcamSize = "s" | "m" | "l";
export type Corner = "tl" | "tr" | "bl" | "br";

export interface WebcamLayout {
  shape: WebcamShape;
  size: WebcamSize;
  corner: Corner;
  /** A dragged position (the centre, 0 to 1 of the video) instead of a corner. */
  custom?: { cx: number; cy: number } | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The share of the video's shorter side that the webcam's long side takes. */
export const SIZE_SHARE: Readonly<Record<WebcamSize, number>> = { s: 0.18, m: 0.26, l: 0.36 };

/** The distance from the edge, in shares of the shorter side. */
export const EDGE_MARGIN = 0.03;

/** The webcam's box in video pixels. Circles and rounded squares are square; a rectangle is 16:9. */
export function webcamBox(videoW: number, videoH: number, layout: WebcamLayout): Box {
  const short = Math.min(videoW, videoH);
  const side = Math.round(short * SIZE_SHARE[layout.size]);
  const w = layout.shape === "rectangle" ? Math.round(side * 1.35) : side;
  const h = layout.shape === "rectangle" ? Math.round((w * 9) / 16) : side;
  const margin = Math.round(short * EDGE_MARGIN);
  if (layout.custom) {
    const x = Math.min(videoW - w, Math.max(0, Math.round(layout.custom.cx * videoW - w / 2)));
    const y = Math.min(videoH - h, Math.max(0, Math.round(layout.custom.cy * videoH - h / 2)));
    return { x, y, w, h };
  }
  const x = layout.corner === "tl" || layout.corner === "bl" ? margin : videoW - w - margin;
  const y = layout.corner === "tl" || layout.corner === "tr" ? margin : videoH - h - margin;
  return { x, y, w, h };
}

/** The corner nearest to a point (0 to 1 of the video), for snapping a dragged webcam. */
export function nearestCorner(cx: number, cy: number): Corner {
  return `${cy < 0.5 ? "t" : "b"}${cx < 0.5 ? "l" : "r"}` as Corner;
}

/** The corner radius of the webcam's shape in video pixels. */
export function webcamRadius(shape: WebcamShape, box: Box): number {
  if (shape === "circle") return Math.min(box.w, box.h) / 2;
  if (shape === "rounded") return Math.round(Math.min(box.w, box.h) * 0.18);
  return Math.round(Math.min(box.w, box.h) * 0.04);
}

/** The part of a camera frame (cw x ch) that fills the box: centred, cropped, no stretching. */
export function coverCrop(cw: number, ch: number, box: Box): Box {
  const target = box.w / box.h;
  const source = cw / ch;
  if (source > target) {
    const w = Math.round(ch * target);
    return { x: Math.round((cw - w) / 2), y: 0, w, h: ch };
  }
  const h = Math.round(cw / target);
  return { x: 0, y: Math.round((ch - h) / 2), w: cw, h };
}

export type CursorScale = 1 | 1.5 | 2;

/** The cursor image size in video pixels: the cursor's own size times the chosen scale. */
export function cursorSize(imageW: number, imageH: number, scale: CursorScale): { w: number; h: number } {
  return { w: Math.round(imageW * scale), h: Math.round(imageH * scale) };
}

/** Where to draw the cursor image so its hot spot is on the position. */
export function cursorOrigin(x: number, y: number, hotX: number, hotY: number, scale: CursorScale): { x: number; y: number } {
  return { x: x - hotX * scale, y: y - hotY * scale };
}

/** H.264 needs even dimensions: the recorded area, rounded down to even numbers (at least 2). */
export function evenSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(2, w - (w % 2)), h: Math.max(2, h - (h % 2)) };
}
