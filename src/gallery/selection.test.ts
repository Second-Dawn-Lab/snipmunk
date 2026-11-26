import { describe, expect, it } from "vitest";
import {
  clearSelection,
  clickSelect,
  contextTargets,
  emptySelection,
  keySelect,
  navStep,
  pruneTo,
  rangeBetween,
  selectEvery,
  stepTarget,
  toggleSelect,
  type Selection,
} from "./selection";

const order = ["a", "b", "c", "d", "e", "f"];
const sel = (ids: string[], anchor: string | null = ids[ids.length - 1] ?? null): Selection => ({
  ids: new Set(ids),
  anchor,
});
const ids = (s: Selection) => [...s.ids].sort();
const plain = { ctrl: false, shift: false };

describe("clicking a card", () => {
  it("selects only that card and shows it", () => {
    const r = clickSelect(sel(["a", "b"]), order, "d", plain, "a");
    expect(ids(r.selection)).toEqual(["d"]);
    expect(r.selection.anchor).toBe("d");
    expect(r.active).toBe("d");
  });

  it("Ctrl+click adds a card and shows it", () => {
    const r = clickSelect(sel(["a"]), order, "c", { ctrl: true, shift: false }, "a");
    expect(ids(r.selection)).toEqual(["a", "c"]);
    expect(r.active).toBe("c");
    expect(r.selection.anchor).toBe("c");
  });

  it("Ctrl+click on a selected card removes it and keeps the preview", () => {
    const r = clickSelect(sel(["a", "c"]), order, "c", { ctrl: true, shift: false }, "c");
    expect(ids(r.selection)).toEqual(["a"]);
    expect(r.active).toBeUndefined();
  });

  it("Shift+click selects the range from the anchor, either way round", () => {
    const down = clickSelect(sel(["b"], "b"), order, "e", { ctrl: false, shift: true }, "b");
    expect(ids(down.selection)).toEqual(["b", "c", "d", "e"]);
    expect(down.selection.anchor).toBe("b");
    expect(down.active).toBe("e");
    const up = clickSelect(sel(["e"], "e"), order, "b", { ctrl: false, shift: true }, "e");
    expect(ids(up.selection)).toEqual(["b", "c", "d", "e"]);
  });

  it("Shift+click replaces the selection but keeps the anchor for the next range", () => {
    const first = clickSelect(sel(["b"], "b"), order, "d", { ctrl: false, shift: true }, "b");
    const second = clickSelect(first.selection, order, "a", { ctrl: false, shift: true }, "d");
    expect(ids(second.selection)).toEqual(["a", "b"]);
  });

  it("Shift+click without an anchor starts from the capture on show", () => {
    const r = clickSelect(emptySelection, order, "d", { ctrl: false, shift: true }, "b");
    expect(ids(r.selection)).toEqual(["b", "c", "d"]);
  });

  it("Shift+click with nothing at all selects just that card", () => {
    const r = clickSelect(emptySelection, order, "d", { ctrl: false, shift: true }, null);
    expect(ids(r.selection)).toEqual(["d"]);
  });

  it("Ctrl+Shift+click adds the range to the selection", () => {
    const r = clickSelect(sel(["a"], "c"), order, "e", { ctrl: true, shift: true }, "c");
    expect(ids(r.selection)).toEqual(["a", "c", "d", "e"]);
  });

  it("an anchor that is no longer in the list is replaced", () => {
    const r = clickSelect(sel(["x"], "x"), order, "c", { ctrl: false, shift: true }, "a");
    expect(ids(r.selection)).toEqual(["a", "b", "c"]);
  });
});

describe("the check box", () => {
  it("toggles one card and leaves the preview alone", () => {
    const on = toggleSelect(sel(["a"]), "c");
    expect(ids(on.selection)).toEqual(["a", "c"]);
    expect(on.active).toBeUndefined();
    expect(ids(toggleSelect(on.selection, "a").selection)).toEqual(["c"]);
  });
});

describe("select all, clear and prune", () => {
  it("Ctrl+A selects every capture of the group", () => {
    const r = selectEvery(emptySelection, order, "c");
    expect(ids(r.selection)).toEqual(order);
    expect(r.selection.anchor).toBe("c");
    expect(r.active).toBeUndefined();
  });

  it("Ctrl+A of an empty group is an empty selection", () => {
    expect(selectEvery(emptySelection, [], null).selection.ids.size).toBe(0);
  });

  it("clearing empties the selection", () => {
    expect(clearSelection().ids.size).toBe(0);
  });

  it("pruning drops captures that are gone and keeps the object when nothing changed", () => {
    const s = sel(["a", "b", "c"], "b");
    expect(pruneTo(s, new Set(order))).toBe(s);
    const p = pruneTo(s, new Set(["a", "c"]));
    expect(ids(p)).toEqual(["a", "c"]);
    expect(p.anchor).toBeNull();
  });
});

describe("ranges", () => {
  it("are inclusive and ignore unknown ends", () => {
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, null, "d")).toEqual(["d"]);
    expect(rangeBetween(order, "zz", "d")).toEqual(["d"]);
    expect(rangeBetween(order, "b", "zz")).toEqual([]);
  });
});

describe("keyboard navigation", () => {
  const list = { columns: 1, pageRows: 5, rtl: false };
  const grid = { columns: 3, pageRows: 2, rtl: false };

  it("moves by one in the list and ignores Left and Right", () => {
    expect(navStep("ArrowDown", list)).toBe(1);
    expect(navStep("ArrowUp", list)).toBe(-1);
    expect(navStep("ArrowLeft", list)).toBeNull();
    expect(navStep("ArrowRight", list)).toBeNull();
  });

  it("moves by one with Left and Right and by a row with Up and Down in a grid", () => {
    expect(navStep("ArrowRight", grid)).toBe(1);
    expect(navStep("ArrowLeft", grid)).toBe(-1);
    expect(navStep("ArrowDown", grid)).toBe(3);
    expect(navStep("ArrowUp", grid)).toBe(-3);
  });

  it("mirrors Left and Right in a right-to-left layout", () => {
    const rtl = { ...grid, rtl: true };
    expect(navStep("ArrowRight", rtl)).toBe(-1);
    expect(navStep("ArrowLeft", rtl)).toBe(1);
    expect(navStep("ArrowDown", rtl)).toBe(3);
  });

  it("Page Up, Page Down, Home and End", () => {
    expect(navStep("PageDown", grid)).toBe(6);
    expect(navStep("PageUp", list)).toBe(-5);
    expect(navStep("Home", list)).toBe("first");
    expect(navStep("End", list)).toBe("last");
    expect(navStep("x", list)).toBeNull();
  });

  it("stays inside the list", () => {
    expect(stepTarget(6, 4, 3)).toBe(5);
    expect(stepTarget(6, 1, -3)).toBe(0);
    expect(stepTarget(6, 2, "last")).toBe(5);
    expect(stepTarget(0, -1, 1)).toBe(-1);
  });

  it("from nothing, forwards lands on the first and backwards on the last", () => {
    expect(stepTarget(6, -1, 1)).toBe(0);
    expect(stepTarget(6, -1, -1)).toBe(5);
  });

  it("an arrow key selects only the capture it lands on", () => {
    const r = keySelect(sel(["a", "b", "c"], "a"), order, "c", 1, false)!;
    expect(ids(r.selection)).toEqual(["d"]);
    expect(r.active).toBe("d");
    expect(r.selection.anchor).toBe("d");
  });

  it("Shift+arrow extends the range from the anchor, and shrinks it again", () => {
    const start = sel(["b"], "b");
    const down = keySelect(start, order, "b", 1, true)!;
    expect(ids(down.selection)).toEqual(["b", "c"]);
    const more = keySelect(down.selection, order, down.active as string, 1, true)!;
    expect(ids(more.selection)).toEqual(["b", "c", "d"]);
    const back = keySelect(more.selection, order, more.active as string, -2, true)!;
    expect(ids(back.selection)).toEqual(["b"]);
    expect(back.selection.anchor).toBe("b");
  });

  it("Shift+arrow without an anchor starts at the capture on show", () => {
    const r = keySelect(emptySelection, order, "c", 1, true)!;
    expect(ids(r.selection)).toEqual(["c", "d"]);
  });

  it("does nothing in an empty list", () => {
    expect(keySelect(emptySelection, [], null, 1, false)).toBeNull();
  });
});

describe("the context menu", () => {
  it("acts on the whole selection when the card is part of it", () => {
    const s = sel(["e", "a", "c"], "c");
    const t = contextTargets(s, order, "c");
    expect(t.ids).toEqual(["a", "c", "e"]);
    expect(t.selection).toBe(s);
    expect(t.canRename).toBe(false);
  });

  it("acts on one card, and selects it, when the card is not part of the selection", () => {
    const t = contextTargets(sel(["a", "b"]), order, "d");
    expect(t.ids).toEqual(["d"]);
    expect(ids(t.selection)).toEqual(["d"]);
    expect(t.canRename).toBe(true);
  });

  it("can rename when the selection is only that card", () => {
    expect(contextTargets(sel(["b"]), order, "b").canRename).toBe(true);
  });
});
