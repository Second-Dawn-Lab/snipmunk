// Sizes on the screen versus sizes in the picture (no React). The size popovers (pen, highlighter, outline, text, emoji)
// show what the user sees on the screen: a 16 px text is 16 px tall on the screen at the zoom it is drawn at, whether the
// capture is 347 px wide or 4K. The mark stores image pixels, so the size is converted when it is made or restyled; marks
// that exist are never changed by a zoom.
import type { ToolValues } from "./styles";

/** The tool values that are sizes (in screen pixels in the settings and in the popovers). */
export const SIZE_VALUE_KEYS = ["lastPenSize", "lastHighlighterSize", "lastOutlineSize", "lastTextSize"] as const;
export type SizeKey = (typeof SIZE_VALUE_KEYS)[number];

/** The size of an emoji sticker on the screen when it is placed. */
export const EMOJI_SCREEN_SIZE = 40;

const MIN_ZOOM = 0.01;
const safe = (zoom: number) => (Number.isFinite(zoom) && zoom > MIN_ZOOM ? zoom : 1);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Screen pixels (CSS pixels, which already include the display scaling) to picture pixels at a zoom. */
export function toImagePx(screenPx: number, zoom: number): number {
  return round1(screenPx / safe(zoom));
}

/** Picture pixels to the screen pixels they take at a zoom. */
export function toScreenPx(imagePx: number, zoom: number): number {
  return round1(imagePx * safe(zoom));
}

/** The tool values with the sizes converted to picture pixels, for making a mark. */
export function imageValues(v: ToolValues, zoom: number): ToolValues {
  const out = { ...v };
  for (const k of SIZE_VALUE_KEYS) out[k] = toImagePx(v[k], zoom);
  return out;
}

/** A change of tool values (from a popover, in screen pixels) in picture pixels, for restyling marks. */
export function imagePatch(patch: Partial<ToolValues>, zoom: number): Partial<ToolValues> {
  const out = { ...patch };
  for (const k of SIZE_VALUE_KEYS) if (typeof patch[k] === "number") out[k] = toImagePx(patch[k], zoom);
  return out;
}

/** The size of an emoji sticker in picture pixels. */
export function emojiImageSize(zoom: number): number {
  return Math.max(4, toImagePx(EMOJI_SCREEN_SIZE, zoom));
}
