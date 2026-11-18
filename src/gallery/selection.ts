// Selection logic of the capture list (no React, no IPC), so it can be unit tested.
//
// A selection is a set of ids plus an "anchor": the capture a Shift range starts from. The capture shown in the preview
// ("active") lives next to it. Each group keeps its own selection (MainWindow); `order` is always the captures of the
// group in the order the list shows them.

export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly anchor: string | null;
}

export const emptySelection: Selection = { ids: new Set(), anchor: null };

export interface ClickMods {
  ctrl: boolean;
  shift: boolean;
}

/** What a click or key press changed. `active` is `undefined` when the preview keeps showing the same capture. */
export interface SelectionChange {
  selection: Selection;
  active: string | null | undefined;
}

/** The ids from `a` to `b` (either way round) in list order; just `b` when `a` is not in the list. */
export function rangeBetween(order: readonly string[], a: string | null, b: string): string[] {
  const to = order.indexOf(b);
  const from = a === null ? -1 : order.indexOf(a);
  if (to < 0) return [];
  if (from < 0) return [b];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

function make(ids: Iterable<string>, anchor: string | null): Selection {
  return { ids: new Set(ids), anchor };
}

/**
 * A click on a card.
 *  - plain: select only this one and show it;
 *  - Ctrl: add it to or remove it from the selection (it is shown when added);
 *  - Shift: select the range from the anchor (or from the capture on show) to this one, replacing the selection;
 *  - Ctrl+Shift: the same range, added to the selection.
 */
export function clickSelect(
  sel: Selection,
  order: readonly string[],
  id: string,
  mods: ClickMods,
  shownId: string | null,
): SelectionChange {
  if (mods.shift) {
    const from = sel.anchor !== null && order.includes(sel.anchor) ? sel.anchor : (shownId ?? id);
    const range = rangeBetween(order, from, id);
    const ids = mods.ctrl ? new Set([...sel.ids, ...range]) : new Set(range);
    return { selection: make(ids, from), active: id };
  }
  if (mods.ctrl) {
    const next = new Set(sel.ids);
    const added = !next.delete(id);
    if (added) next.add(id);
    return { selection: make(next, id), active: added ? id : undefined };
  }
  return { selection: make([id], id), active: id };
}

/** The check box of a card: like Ctrl+click, but the preview keeps showing what it showed. */
export function toggleSelect(sel: Selection, id: string): SelectionChange {
  const next = new Set(sel.ids);
  if (!next.delete(id)) next.add(id);
  return { selection: make(next, id), active: undefined };
}

/** Ctrl+A: every capture of the group. */
export function selectEvery(sel: Selection, order: readonly string[], shownId: string | null): SelectionChange {
  const anchor = sel.anchor !== null && order.includes(sel.anchor) ? sel.anchor : (shownId ?? order[0] ?? null);
  return { selection: make(order, anchor), active: undefined };
}

/** Esc / "Clear all". */
export function clearSelection(): Selection {
  return emptySelection;
}

/** Drop ids that no longer exist (deleted, or moved to another group). Returns the same object when nothing changed. */
export function pruneTo(sel: Selection, alive: ReadonlySet<string>): Selection {
  const ids = [...sel.ids].filter((id) => alive.has(id));
  const anchor = sel.anchor !== null && alive.has(sel.anchor) ? sel.anchor : null;
  if (ids.length === sel.ids.size && anchor === sel.anchor) return sel;
  return make(ids, anchor);
}

// --- keyboard ----------------------------------------------------------------------------------------------------

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "PageUp" | "PageDown" | "Home" | "End";

export interface NavLayout {
  /** 1 in the list view. */
  columns: number;
  /** Whole rows that fit in the visible part of the list (for Page Up / Page Down). */
  pageRows: number;
  rtl: boolean;
}

/**
 * Where an arrow key goes, as a change of position in the list (`"first"` / `"last"` for Home and End), or `null` when
 * the key does nothing in this layout. In the list view only Up and Down move; in the grids Left and Right move by
 * one (mirrored in right-to-left layouts) and Up and Down by a row.
 */
export function navStep(key: string, layout: NavLayout): number | "first" | "last" | null {
  const { columns, pageRows, rtl } = layout;
  const grid = columns > 1;
  switch (key) {
    case "ArrowUp":
      return -columns;
    case "ArrowDown":
      return columns;
    case "ArrowLeft":
      return grid ? (rtl ? 1 : -1) : null;
    case "ArrowRight":
      return grid ? (rtl ? -1 : 1) : null;
    case "PageUp":
      return -Math.max(1, pageRows) * columns;
    case "PageDown":
      return Math.max(1, pageRows) * columns;
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/** The index a step leads to from `from` (-1 = nothing shown yet), kept inside the list. */
export function stepTarget(count: number, from: number, step: number | "first" | "last"): number {
  if (count === 0) return -1;
  if (step === "first") return 0;
  if (step === "last") return count - 1;
  // Starting from nothing, a step forwards lands on the first capture and one backwards on the last.
  const base = from < 0 ? (step > 0 ? -1 : count) : from;
  return Math.min(count - 1, Math.max(0, base + step));
}

/**
 * An arrow key: move the capture on show; the selection becomes just that one, or with Shift the range from the anchor.
 * Returns `null` when the key leads nowhere (an empty list).
 */
export function keySelect(
  sel: Selection,
  order: readonly string[],
  shownId: string | null,
  step: number | "first" | "last",
  extend: boolean,
): SelectionChange | null {
  const target = stepTarget(order.length, shownId === null ? -1 : order.indexOf(shownId), step);
  if (target < 0) return null;
  const id = order[target];
  if (!extend) return { selection: make([id], id), active: id };
  const from = sel.anchor !== null && order.includes(sel.anchor) ? sel.anchor : (shownId ?? id);
  return { selection: make(rangeBetween(order, from, id), from), active: id };
}

// --- context menu -------------------------------------------------------------------------------------------------

export interface ContextTargets {
  /** The captures a menu entry acts on, in list order. */
  ids: string[];
  /** The selection while the menu is open: the card that was right-clicked is selected unless it already was. */
  selection: Selection;
  /** Rename works on a single capture only. */
  canRename: boolean;
}

/** Right-click on a card: the whole selection if the card is part of it, otherwise just that card (and it gets selected). */
export function contextTargets(sel: Selection, order: readonly string[], clicked: string): ContextTargets {
  if (sel.ids.has(clicked)) {
    const ids = order.filter((id) => sel.ids.has(id));
    return { ids, selection: sel, canRename: ids.length === 1 };
  }
  return { ids: [clicked], selection: make([clicked], clicked), canRename: true };
}

/** What Del deletes and what the bottom bar counts: the selection in list order. */
export function selectedInOrder(sel: Selection, order: readonly string[]): string[] {
  return order.filter((id) => sel.ids.has(id));
}
