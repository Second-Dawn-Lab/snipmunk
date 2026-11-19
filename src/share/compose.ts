// Stack and Grid: where each capture goes in one composed picture (no React, no canvas).
// Both use a fixed 16 px gap and a white background; captures are centred in their cell.

export const GAP = 16;
/** A composed picture bigger than this is not made (a side over 16k pixels or over 200 megapixels). */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 200_000_000;

export interface Size {
  w: number;
  h: number;
}

export interface Placed {
  /** Index of the capture in the input list. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Composition {
  width: number;
  height: number;
  items: Placed[];
}

/** One column of captures, top to bottom, each at its own width and centred. */
export function stackLayout(sizes: readonly Size[]): Composition {
  const width = Math.max(0, ...sizes.map((s) => s.w));
  let y = 0;
  const items = sizes.map((s, index) => {
    const p = { index, x: Math.round((width - s.w) / 2), y, w: s.w, h: s.h };
    y += s.h + GAP;
    return p;
  });
  return { width, height: Math.max(0, y - GAP), items };
}

/** The number of columns for a count: 2 for 2 to 4 captures, 3 for 5 to 9, 4 above. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

/**
 * Rows of up to `columns` captures. The cells of a row are as big as the biggest capture in that row, the captures are centred
 * in their cell, and a row that is narrower than the widest one is centred.
 */
export function gridLayout(sizes: readonly Size[], columns = gridColumns(sizes.length)): Composition {
  const rows: number[][] = [];
  for (let i = 0; i < sizes.length; i += columns) rows.push(sizes.slice(i, i + columns).map((_, j) => i + j));
  const cell = rows.map((row) => ({ w: Math.max(...row.map((i) => sizes[i].w)), h: Math.max(...row.map((i) => sizes[i].h)) }));
  const rowWidth = rows.map((row, r) => row.length * cell[r].w + (row.length - 1) * GAP);
  const width = Math.max(0, ...rowWidth);
  const items: Placed[] = [];
  let y = 0;
  rows.forEach((row, r) => {
    const x0 = Math.round((width - rowWidth[r]) / 2);
    row.forEach((i, c) => {
      const s = sizes[i];
      const cx = x0 + c * (cell[r].w + GAP);
      items.push({ index: i, x: cx + Math.round((cell[r].w - s.w) / 2), y: y + Math.round((cell[r].h - s.h) / 2), w: s.w, h: s.h });
    });
    y += cell[r].h + GAP;
  });
  return { width, height: Math.max(0, y - GAP), items };
}

/** Is a composed picture of this size too big to make? */
export function tooLarge(width: number, height: number): boolean {
  return width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS;
}

export type ComposeMode = "stack" | "grid";

export function layoutFor(mode: ComposeMode, sizes: readonly Size[]): Composition {
  return mode === "stack" ? stackLayout(sizes) : gridLayout(sizes);
}
