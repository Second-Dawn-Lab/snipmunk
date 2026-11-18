import { describe, expect, it } from "vitest";
import {
  contentHeight,
  dropSlot,
  GAP,
  gridSpec,
  itemPosition,
  pageRows,
  scrollToShow,
  slotMark,
  TILE,
  visibleRange,
} from "./layout";

describe("the grid of each view", () => {
  it("is one column of full-width cards in the list view", () => {
    const g = gridSpec("list", 310);
    expect(g.columns).toBe(1);
    expect(g.itemWidth).toBe(310);
    expect(g.rowHeight).toBe(TILE.list.height + GAP);
    expect(g.offset).toBe(0);
  });

  it("fits as many 160 px tiles as the width allows, and centres them", () => {
    const g = gridSpec("medium", 360);
    expect(g.columns).toBe(2);
    expect(g.itemWidth).toBe(160);
    expect(g.offset).toBe(16);
    expect(gridSpec("medium", 168 * 3 - GAP).columns).toBe(3);
    expect(gridSpec("medium", 168 * 3 - GAP - 1).columns).toBe(2);
  });

  it("shows one 260 px tile in a narrow list and never zero columns", () => {
    expect(gridSpec("large", 310).columns).toBe(1);
    expect(gridSpec("large", 50).columns).toBe(1);
    expect(gridSpec("large", 0).columns).toBe(1);
    expect(gridSpec("large", 560).columns).toBe(2);
  });

  it("measures the scrolling content", () => {
    const g = gridSpec("medium", 360);
    expect(contentHeight(0, g)).toBe(0);
    expect(contentHeight(1, g)).toBe(TILE.medium.height);
    expect(contentHeight(2, g)).toBe(TILE.medium.height);
    expect(contentHeight(3, g)).toBe(2 * g.rowHeight - GAP);
  });

  it("places items row by row from the inline start", () => {
    const g = gridSpec("medium", 360);
    expect(itemPosition(0, g)).toEqual({ top: 0, start: 16 });
    expect(itemPosition(1, g)).toEqual({ top: 0, start: 16 + 168 });
    expect(itemPosition(2, g)).toEqual({ top: g.rowHeight, start: 16 });
  });
});

describe("what is built", () => {
  const list = gridSpec("list", 300);

  it("covers the visible rows plus a margin and nothing more", () => {
    const r = visibleRange(0, 400, 300, list);
    expect(r.start).toBe(0);
    expect(r.end).toBeLessThan(20);
    expect(r.end).toBeGreaterThan(Math.floor(400 / list.rowHeight));
  });

  it("follows the scroll position", () => {
    const top = 10_000;
    const r = visibleRange(top, 400, 300, list);
    expect(r.start).toBe(Math.floor(top / list.rowHeight) - 3);
    expect(r.end).toBeLessThanOrEqual(300);
    expect(r.end - r.start).toBeLessThan(20);
  });

  it("stops at the end of the list", () => {
    expect(visibleRange(1_000_000, 400, 300, list).end).toBe(300);
  });

  it("works in whole rows for grids", () => {
    const g = gridSpec("medium", 360);
    const r = visibleRange(0, 300, 300, g);
    expect(r.start % g.columns).toBe(0);
    expect(r.end).toBeLessThan(40);
  });

  it("an empty list builds nothing, a not yet measured one builds a few", () => {
    expect(visibleRange(0, 400, 0, list)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 0, 300, list).end).toBeLessThan(10);
  });
});

describe("scrolling an item into view", () => {
  const g = gridSpec("list", 300);

  it("keeps the position when the item is visible", () => {
    expect(scrollToShow(2, 0, 400, g)).toBe(0);
  });

  it("scrolls up to an item above and down to an item below", () => {
    expect(scrollToShow(1, 500, 400, g)).toBe(g.rowHeight);
    const below = scrollToShow(20, 0, 400, g);
    expect(below).toBe(20 * g.rowHeight + g.itemHeight - 400);
  });

  it("counts the rows of a page", () => {
    expect(pageRows(400, g)).toBe(5);
    expect(pageRows(10, g)).toBe(1);
  });
});

describe("where a drop lands", () => {
  const list = gridSpec("list", 300);
  const grid = gridSpec("medium", 360);

  it("is before or after a card in the list, depending on the half of the card", () => {
    expect(dropSlot(100, 5, 10, list)).toBe(0);
    expect(dropSlot(100, 40, 10, list)).toBe(1);
    expect(dropSlot(100, list.rowHeight + 5, 10, list)).toBe(1);
    expect(dropSlot(100, list.rowHeight * 3 + 50, 10, list)).toBe(4);
  });

  it("is the start above the list and the end below it", () => {
    expect(dropSlot(100, -20, 10, list)).toBe(0);
    expect(dropSlot(100, 10_000, 10, list)).toBe(10);
    expect(dropSlot(100, 0, 0, list)).toBe(0);
  });

  it("is before or after a tile in a grid", () => {
    expect(dropSlot(20, 10, 9, grid)).toBe(0);
    expect(dropSlot(16 + 120, 10, 9, grid)).toBe(1);
    expect(dropSlot(16 + 168 + 10, 10, 9, grid)).toBe(1);
    expect(dropSlot(16 + 168 + 120, 10, 9, grid)).toBe(2);
    expect(dropSlot(20, grid.rowHeight + 10, 9, grid)).toBe(2);
  });

  it("clamps a point beside the grid to the nearest column", () => {
    expect(dropSlot(0, 10, 9, grid)).toBe(0);
    expect(dropSlot(359, 10, 9, grid)).toBe(2);
  });

  it("never goes past the end", () => {
    expect(dropSlot(300, grid.rowHeight * 2 + 10, 5, grid)).toBe(5);
  });

  it("is drawn as a bar between cards in the list and between tiles in a grid", () => {
    expect(slotMark(0, 10, list).direction).toBe("horizontal");
    expect(slotMark(3, 10, list).top).toBe(3 * list.rowHeight - GAP / 2);
    const g = slotMark(1, 9, grid);
    expect(g.direction).toBe("vertical");
    expect(g.start).toBe(itemPosition(1, grid).start - GAP / 2);
    expect(g.length).toBe(grid.itemHeight);
    const end = slotMark(9, 9, grid);
    expect(end.start).toBe(itemPosition(8, grid).start + grid.itemWidth + GAP / 2);
  });
});
