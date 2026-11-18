// The view of the editor (no React): zoom and pan of the final picture inside the stage.

export interface View {
  /** Screen pixels per picture pixel. */
  zoom: number;
  /** Where the picture's top-left corner is, in stage pixels (CSS pixels). */
  ox: number;
  oy: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** The zoom that shows all of a picture in a stage (never above 100 %). */
export function fitZoom(pic: { width: number; height: number }, stage: { width: number; height: number }, padding = 16): number {
  const w = stage.width - 2 * padding;
  const h = stage.height - 2 * padding;
  if (pic.width <= 0 || pic.height <= 0 || w <= 0 || h <= 0) return 1;
  return Math.min(1, w / pic.width, h / pic.height);
}

/** The picture centred in the stage at `zoom`. */
export function centred(pic: { width: number; height: number }, stage: { width: number; height: number }, zoom: number): View {
  return { zoom, ox: (stage.width - pic.width * zoom) / 2, oy: (stage.height - pic.height * zoom) / 2 };
}

/** A stage point -> a point of the picture. */
export function toPicture(v: View, x: number, y: number): { x: number; y: number } {
  return { x: (x - v.ox) / v.zoom, y: (y - v.oy) / v.zoom };
}

export function toStage(v: View, x: number, y: number): { x: number; y: number } {
  return { x: x * v.zoom + v.ox, y: y * v.zoom + v.oy };
}

/** Zoom to `zoom`, keeping the picture point under the stage point (`sx`, `sy`) where it is. */
export function zoomAt(v: View, zoom: number, sx: number, sy: number): View {
  const z = clampZoom(zoom);
  const p = toPicture(v, sx, sy);
  return { zoom: z, ox: sx - p.x * z, oy: sy - p.y * z };
}

/** The zoom after one wheel notch (`deltaY` > 0 zooms out): about 12 % per notch, proportional to how far it turned. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-Math.sign(deltaY) * Math.min(Math.abs(deltaY), 300) * 0.0012));
}

/** Pan so that part of the picture always stays visible in the stage. */
export function clampPan(v: View, pic: { width: number; height: number }, stage: { width: number; height: number }, keep = 80): View {
  const w = pic.width * v.zoom;
  const h = pic.height * v.zoom;
  const ox = Math.min(Math.max(v.ox, keep - w), stage.width - keep);
  const oy = Math.min(Math.max(v.oy, keep - h), stage.height - keep);
  return { ...v, ox, oy };
}
