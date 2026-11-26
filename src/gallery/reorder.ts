// Reorder, move and drag math (no React, no IPC), so it can be unit tested.

/** The captures a drag carries: the whole selection when the grabbed card is part of it, else only that card. */
export function draggedIds(order: readonly string[], selected: ReadonlySet<string>, grabbed: string): string[] {
  if (!selected.has(grabbed)) return order.includes(grabbed) ? [grabbed] : [];
  return order.filter((id) => selected.has(id));
}

/**
 * The list after dropping `moving` at `slot`, a position of the *current* list (0 = before the first item, `order.length`
 * = after the last). The moved items keep their order among themselves.
 */
export function moveIds(order: readonly string[], moving: readonly string[], slot: number): string[] {
  const set = new Set(moving);
  const carried = order.filter((id) => set.has(id));
  const at = clampSlot(slot, order.length);
  const rest = order.filter((id) => !set.has(id));
  const before = order.slice(0, at).filter((id) => set.has(id)).length;
  const insertAt = at - before;
  return [...rest.slice(0, insertAt), ...carried, ...rest.slice(insertAt)];
}

function clampSlot(slot: number, count: number): number {
  return Math.min(count, Math.max(0, Math.round(slot)));
}

/** Dropping would not change the list. */
export function isNoopMove(order: readonly string[], moving: readonly string[], slot: number): boolean {
  if (moving.length === 0) return true;
  const next = moveIds(order, moving, slot);
  return next.length === order.length && next.every((id, i) => id === order[i]);
}

// --- pointer drags ---------------------------------------------------------------------------------------------------

/** A press turns into a drag once the pointer has moved this far (CSS pixels). */
export const DRAG_THRESHOLD = 5;

export function exceedsThreshold(dx: number, dy: number, threshold = DRAG_THRESHOLD): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

/**
 * How fast to scroll while a drag is near an edge of the list: negative towards the start, positive towards the end,
 * faster the closer the pointer is to (or beyond) the edge. 0 in the middle.
 */
export function autoScrollDelta(pointer: number, start: number, end: number, edge = 48, maxSpeed = 22): number {
  const zone = Math.min(edge, (end - start) / 2);
  if (zone <= 0) return 0;
  if (pointer < start + zone) return -Math.round(maxSpeed * Math.min(1, (start + zone - pointer) / zone));
  if (pointer > end - zone) return Math.round(maxSpeed * Math.min(1, (pointer - (end - zone)) / zone));
  return 0;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface IdRect extends Rect {
  id: string;
}

export function insideRect(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** The id of the rectangle under the point (the first one when they overlap), or `null`. */
export function hitTest(rects: readonly IdRect[], x: number, y: number): string | null {
  return rects.find((r) => insideRect(r, x, y))?.id ?? null;
}

/**
 * Where a dragged group tab would be inserted among `tabs` (in the order they are laid out): a slot from 0 to `tabs.length`.
 * In a right-to-left layout the tabs run from the right, so the comparison is mirrored.
 */
export function tabSlot(tabs: readonly Rect[], x: number, rtl: boolean): number {
  for (let i = 0; i < tabs.length; i++) {
    const mid = (tabs[i].left + tabs[i].right) / 2;
    if (rtl ? x > mid : x < mid) return i;
  }
  return tabs.length;
}

/** `ids` with the item `moving` moved to `slot` (a position of the current list). */
export function moveOne(ids: readonly string[], moving: string, slot: number): string[] {
  return moveIds(ids, [moving], slot);
}
