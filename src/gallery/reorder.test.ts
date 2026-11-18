import { describe, expect, it } from "vitest";
import {
  autoScrollDelta,
  draggedIds,
  exceedsThreshold,
  hitTest,
  insertIndexWithout,
  isNoopMove,
  moveIds,
  moveOne,
  tabSlot,
} from "./reorder";

const order = ["a", "b", "c", "d", "e"];

describe("what a drag carries", () => {
  it("is the whole selection, in list order, when the grabbed card is selected", () => {
    expect(draggedIds(order, new Set(["d", "b"]), "d")).toEqual(["b", "d"]);
  });
  it("is only the grabbed card when it is not selected", () => {
    expect(draggedIds(order, new Set(["b", "c"]), "e")).toEqual(["e"]);
    expect(draggedIds(order, new Set(), "a")).toEqual(["a"]);
  });
  it("is nothing for a card that is not in the list", () => {
    expect(draggedIds(order, new Set(), "zz")).toEqual([]);
  });
});

describe("reordering", () => {
  it("moves one card to a slot", () => {
    expect(moveIds(order, ["a"], 3)).toEqual(["b", "c", "a", "d", "e"]);
    expect(moveIds(order, ["d"], 1)).toEqual(["a", "d", "b", "c", "e"]);
    expect(moveIds(order, ["c"], 0)).toEqual(["c", "a", "b", "d", "e"]);
    expect(moveIds(order, ["b"], 5)).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("moves several cards together, keeping their order", () => {
    expect(moveIds(order, ["e", "b"], 3)).toEqual(["a", "c", "b", "e", "d"]);
    expect(moveIds(order, ["a", "b"], 5)).toEqual(["c", "d", "e", "a", "b"]);
    expect(moveIds(order, ["d", "e"], 0)).toEqual(["d", "e", "a", "b", "c"]);
  });

  it("counts the slot in the current list, also when cards before it move away", () => {
    // slot 4 = before "e"; "a" and "b" leave from before it.
    expect(moveIds(order, ["a", "b"], 4)).toEqual(["c", "d", "a", "b", "e"]);
  });

  it("keeps every card exactly once, whatever the slot", () => {
    for (let slot = -2; slot <= 8; slot++) {
      const next = moveIds(order, ["b", "d"], slot);
      expect([...next].sort()).toEqual(order);
    }
  });

  it("recognises a drop that changes nothing", () => {
    expect(isNoopMove(order, ["b"], 1)).toBe(true);
    expect(isNoopMove(order, ["b"], 2)).toBe(true);
    expect(isNoopMove(order, ["b", "c"], 1)).toBe(true);
    expect(isNoopMove(order, ["b"], 3)).toBe(false);
    expect(isNoopMove(order, [], 3)).toBe(true);
  });

  it("gives the backend the position in the list without the moved cards", () => {
    expect(insertIndexWithout(order, ["a", "b"], 4)).toBe(2);
    expect(insertIndexWithout(order, ["d"], 1)).toBe(1);
    expect(insertIndexWithout(order, ["a"], 5)).toBe(4);
    // Cards of another group are not in this list: nothing is removed from before the slot.
    expect(insertIndexWithout(order, ["x"], 3)).toBe(3);
  });

  it("moves one tab", () => {
    expect(moveOne(["g1", "g2", "g3"], "g1", 3)).toEqual(["g2", "g3", "g1"]);
  });
});

describe("pointer drags", () => {
  it("start after the pointer moved a few pixels", () => {
    expect(exceedsThreshold(2, 2)).toBe(false);
    expect(exceedsThreshold(3, 4)).toBe(true);
    expect(exceedsThreshold(0, -5)).toBe(true);
  });

  it("scroll towards an edge, faster the closer the pointer is", () => {
    expect(autoScrollDelta(300, 100, 500)).toBe(0);
    expect(autoScrollDelta(110, 100, 500)).toBeLessThan(0);
    expect(autoScrollDelta(490, 100, 500)).toBeGreaterThan(0);
    expect(autoScrollDelta(101, 100, 500)).toBeLessThan(autoScrollDelta(140, 100, 500));
    expect(autoScrollDelta(60, 100, 500)).toBe(-22);
    expect(autoScrollDelta(900, 100, 500)).toBe(22);
  });

  it("do not scroll in a list too small for two edge zones", () => {
    expect(autoScrollDelta(110, 100, 100)).toBe(0);
    expect(Math.abs(autoScrollDelta(105, 100, 130))).toBeLessThanOrEqual(22);
  });
});

describe("hit testing", () => {
  const rects = [
    { id: "g1", left: 0, top: 0, right: 100, bottom: 30 },
    { id: "g2", left: 104, top: 0, right: 200, bottom: 30 },
  ];
  it("finds the tab under the pointer", () => {
    expect(hitTest(rects, 50, 10)).toBe("g1");
    expect(hitTest(rects, 150, 10)).toBe("g2");
    expect(hitTest(rects, 100, 10)).toBe("g1");
  });
  it("finds nothing in the gaps or outside", () => {
    expect(hitTest(rects, 102, 10)).toBeNull();
    expect(hitTest(rects, 50, 31)).toBeNull();
    expect(hitTest([], 1, 1)).toBeNull();
  });
});

describe("where a dragged tab goes", () => {
  const tabs = [
    { left: 0, top: 0, right: 100, bottom: 30 },
    { left: 104, top: 0, right: 200, bottom: 30 },
    { left: 204, top: 0, right: 300, bottom: 30 },
  ];
  it("is before the first tab whose middle is still ahead", () => {
    expect(tabSlot(tabs, 10, false)).toBe(0);
    expect(tabSlot(tabs, 60, false)).toBe(1);
    expect(tabSlot(tabs, 160, false)).toBe(2);
    expect(tabSlot(tabs, 290, false)).toBe(3);
  });
  it("is mirrored in a right-to-left layout, where the tabs run from the right", () => {
    const rtl = [
      { left: 204, top: 0, right: 300, bottom: 30 },
      { left: 104, top: 0, right: 200, bottom: 30 },
      { left: 0, top: 0, right: 100, bottom: 30 },
    ];
    expect(tabSlot(rtl, 290, true)).toBe(0);
    expect(tabSlot(rtl, 160, true)).toBe(1);
    expect(tabSlot(rtl, 10, true)).toBe(3);
  });
});
