// Layout math of the capture list for the three views (no React), used by the virtual scroller and by the drag and drop.
// Every item has the same size, so which items are on screen is plain arithmetic and a list of 5000 costs the same as a
// list of 50.

export type GalleryView = "list" | "medium" | "large";

export const GALLERY_VIEWS: readonly GalleryView[] = ["list", "medium", "large"];

export function isGalleryView(value: unknown): value is GalleryView {
  return value === "list" || value === "medium" || value === "large";
}

/** The size of the thumbnail picture and of the whole tile, in CSS pixels. */
export const TILE = {
  list: { width: 0, thumbHeight: 54, height: 72 },
  medium: { width: 160, thumbHeight: 100, height: 140 },
  large: { width: 260, thumbHeight: 163, height: 216 },
} as const;

/** Space between items. */
export const GAP = 8;

export interface GridSpec {
  view: GalleryView;
  columns: number;
  /** Width of one item. */
  itemWidth: number;
  /** Height of one item. */
  itemHeight: number;
  /** Distance from one row to the next. */
  rowHeight: number;
  /** Distance from one column to the next. */
  colWidth: number;
  /** Space before the first column, so a grid is centred in the list. */
  offset: number;
  /** Width the spec was made for. */
  width: number;
}

/** The grid for `view` in a list `width` pixels wide (inside its padding). */
export function gridSpec(view: GalleryView, width: number): GridSpec {
  const tile = TILE[view];
  const w = Math.max(0, Math.floor(width));
  if (view === "list") {
    return {
      view,
      columns: 1,
      itemWidth: w,
      itemHeight: tile.height,
      rowHeight: tile.height + GAP,
      colWidth: w + GAP,
      offset: 0,
      width: w,
    };
  }
  const columns = Math.max(1, Math.floor((w + GAP) / (tile.width + GAP)));
  const used = columns * tile.width + (columns - 1) * GAP;
  return {
    view,
    columns,
    itemWidth: tile.width,
    itemHeight: tile.height,
    rowHeight: tile.height + GAP,
    colWidth: tile.width + GAP,
    offset: Math.max(0, Math.floor((w - used) / 2)),
    width: w,
  };
}

export function rowCount(count: number, spec: GridSpec): number {
  return Math.ceil(count / spec.columns);
}

/** Height of the scrolling content for `count` items. */
export function contentHeight(count: number, spec: GridSpec): number {
  const rows = rowCount(count, spec);
  return rows === 0 ? 0 : rows * spec.rowHeight - GAP;
}

/** Position of an item from the top and the inline-start edge of the list. */
export function itemPosition(index: number, spec: GridSpec): { top: number; start: number } {
  return {
    top: Math.floor(index / spec.columns) * spec.rowHeight,
    start: spec.offset + (index % spec.columns) * spec.colWidth,
  };
}

/** The items to build for the part of the list that is on screen, plus `overscanRows` above and below. `end` is exclusive. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  spec: GridSpec,
  overscanRows = 3,
): { start: number; end: number } {
  if (count === 0 || viewportHeight <= 0) return { start: 0, end: Math.min(count, spec.columns * (overscanRows + 1)) };
  const firstRow = Math.max(0, Math.floor(scrollTop / spec.rowHeight) - overscanRows);
  const lastRow = Math.min(rowCount(count, spec) - 1, Math.floor((scrollTop + viewportHeight) / spec.rowHeight) + overscanRows);
  return { start: Math.min(count, firstRow * spec.columns), end: Math.min(count, (lastRow + 1) * spec.columns) };
}

/** The scroll position that shows an item completely, or the current one when it already is. */
export function scrollToShow(index: number, scrollTop: number, viewportHeight: number, spec: GridSpec, padding = 0): number {
  const top = Math.floor(index / spec.columns) * spec.rowHeight;
  const bottom = top + spec.itemHeight;
  if (top - padding < scrollTop) return Math.max(0, top - padding);
  if (bottom + padding > scrollTop + viewportHeight) return Math.max(0, bottom + padding - viewportHeight);
  return scrollTop;
}

/** How many whole rows fit in the visible part (for Page Up / Page Down). */
export function pageRows(viewportHeight: number, spec: GridSpec): number {
  return Math.max(1, Math.floor(viewportHeight / spec.rowHeight));
}

/**
 * Where a dragged item would be inserted when dropped at a point of the list: a slot from 0 (before the first item) to
 * `count` (after the last). `x` is measured from the inline-start edge (the right edge in right-to-left layouts), `y`
 * from the top of the content (the scroll position is already added).
 */
export function dropSlot(x: number, y: number, count: number, spec: GridSpec): number {
  if (count === 0) return 0;
  if (y < 0) return 0;
  const row = Math.floor(y / spec.rowHeight);
  if (row >= rowCount(count, spec)) return count;
  const inRowY = y - row * spec.rowHeight;
  if (spec.columns === 1) return Math.min(count, row + (inRowY > spec.itemHeight / 2 ? 1 : 0));
  const rel = x - spec.offset;
  const col = Math.min(spec.columns - 1, Math.max(0, Math.floor(rel / spec.colWidth)));
  const inCol = rel - col * spec.colWidth;
  const after = inCol > spec.itemWidth / 2 ? 1 : 0;
  return Math.min(count, row * spec.columns + col + after);
}

/** Where to draw the insertion mark of a slot: a bar before the item at the slot (after the last item for the end). */
export function slotMark(
  slot: number,
  count: number,
  spec: GridSpec,
): { top: number; start: number; length: number; direction: "horizontal" | "vertical" } {
  if (spec.columns === 1) {
    const y = slot === 0 ? -GAP / 2 : slot * spec.rowHeight - GAP / 2;
    return { top: y, start: 0, length: spec.width, direction: "horizontal" };
  }
  if (slot < count) {
    const pos = itemPosition(slot, spec);
    return { top: pos.top, start: pos.start - GAP / 2, length: spec.itemHeight, direction: "vertical" };
  }
  const last = itemPosition(Math.max(0, count - 1), spec);
  return { top: last.top, start: last.start + spec.itemWidth + GAP / 2, length: spec.itemHeight, direction: "vertical" };
}
