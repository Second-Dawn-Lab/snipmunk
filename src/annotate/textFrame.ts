// The frame of a text box that can be edited (no React): the text area inside and a grab zone around it. Pressing the grab zone
// moves the box; inside, the cursor is the I-beam and the press places the caret.
import type { Pt } from "./geometry";

/** The width of the grab zone around the box, in screen pixels (outside the box, including its visible border). */
export const TEXT_GRAB_PX = 8;

export type FrameZone = "inside" | "border" | "outside";

export interface FrameBox {
  /** The anchor (top left corner) the box turns around, and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians. */
  rotation: number;
}

/** Where a point is relative to a text box: inside it, in the grab zone around it (`grab` units wide), or outside. */
export function frameZone(box: FrameBox, p: Pt, grab: number): FrameZone {
  // Into the box's own, unrotated space: the box turns about its anchor.
  const dx = p.x - box.x;
  const dy = p.y - box.y;
  const c = Math.cos(-box.rotation);
  const s = Math.sin(-box.rotation);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  if (lx >= 0 && lx <= box.w && ly >= 0 && ly <= box.h) return "inside";
  return lx >= -grab && lx <= box.w + grab && ly >= -grab && ly <= box.h + grab ? "border" : "outside";
}

/** The grab zone in picture pixels for a zoom (the zone is as wide on the screen at every zoom). */
export const grabInPicture = (zoom: number) => TEXT_GRAB_PX / Math.max(0.01, zoom);

/** The size (picture pixels) of the text being edited: its text area on the screen over the zoom; a fixed width stays. */
export function editBoxSize(item: { w: number; fixedWidth?: boolean }, area: { w: number; h: number }, zoom: number): { w: number; h: number } {
  const z = Math.max(0.01, zoom);
  return { w: item.fixedWidth ? item.w : area.w / z, h: area.h / z };
}
