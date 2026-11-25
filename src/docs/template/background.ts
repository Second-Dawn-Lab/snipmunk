// The picture behind the cover and the pages (no React): which pages have it, how the web draws it and where Word puts it.

import type { Background } from "./model";

/** The key of the prepared picture (opacity and grey already in it) among the pictures of an export. */
export const BACKGROUND_KEY = "@background";
/** The picture as the cover designs "image" and "split" show it (with the overlay of "image" already in it). */
export const ART_KEY = "@art";

/** Whether a cover design shows the picture as part of the cover itself (not behind it). */
export const hasArt = (design: string): boolean => design === "image" || design === "split";

/** The CSS of that picture: it fills its box. */
export const artCss = (src: string): string => `background-image:url("${src}");background-repeat:no-repeat;background-position:center;background-size:cover`;

export const onCover = (b: Background): boolean => b.apply !== "notCover";
export const onPages = (b: Background): boolean => b.apply !== "cover";

/** Only a picture of its own size or of a chosen width has a position: "Fit" and "Fill" are centred. */
export const hasPosition = (b: Pick<Background, "size">): boolean => b.size === "original" || b.size === "custom";

/** The CSS of the picture in its box (the whole page). */
export function backgroundCss(b: Background, src: string): string {
  const size = b.size === "original" ? "auto" : b.size === "fit" ? "contain" : b.size === "fill" ? "cover" : `${b.scale}% auto`;
  const position = hasPosition(b) ? `${b.x} ${b.y}` : "center center";
  return `background-image:url("${src}");background-repeat:no-repeat;background-position:${position};background-size:${size}`;
}

/** Where the picture lies on a page of `page` millimetres (the same rules as the CSS; a picture's own size is at 96 per inch). */
export function backgroundBox(b: Background, page: { w: number; h: number }, image: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const ratio = image.width / Math.max(1, image.height);
  let w = (image.width / 96) * 25.4;
  if (b.size === "custom") w = (page.w * b.scale) / 100;
  else if (b.size !== "original") {
    const byWidth = page.w;
    const byHeight = page.h * ratio;
    w = b.size === "fit" ? Math.min(byWidth, byHeight) : Math.max(byWidth, byHeight);
  }
  const h = w / ratio;
  const place = (at: string, room: number) => (at === "left" || at === "top" ? 0 : at === "center" ? room / 2 : room);
  return { x: place(hasPosition(b) ? b.x : "center", page.w - w), y: place(hasPosition(b) ? b.y : "center", page.h - h), w, h };
}
