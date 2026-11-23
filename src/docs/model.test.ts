import { describe, expect, it } from "vitest";
import type { GuideStep } from "../ipc";
import { History, createDocument, cropRect, duplicateBlock, insertBlock, markerColor, moveBlock, moveBlockTo, moveBlocks, removeBlocks, stepNumbers, syncSteps, updateBlock, viewRect, type ContentBlock, type GuideDoc, type StepBlock } from "./model";

const defaults = { marker: { left: "#f00", right: "#00f", shape: "circle" as const, size: "medium" as const }, badge: "circle" as const, picture: "window" as const, keepFull: false, zoomDefault: false };
const step = (n: number, extra: Partial<GuideStep> = {}): GuideStep => ({
  n,
  kind: "click",
  t: 0,
  image: `s${n}.png`,
  imageSize: [1000, 600],
  click: [500, 300],
  window: { rect: [100, 50, 800, 500], title: "W", process: "p" },
  zoom: [400, 250, 200, 100],
  text: [{ t: `Step ${n}` }],
  deleted: false,
  ...extra,
});
const base = (): GuideDoc => createDocument("T", 1, [step(1), step(2), step(3)], defaults);
const content = (id: string): ContentBlock => ({ id, type: "content", doc: { type: "doc", content: [] } });
const ids = (d: GuideDoc) => d.blocks.map((b) => b.id);

describe("guide blocks", () => {
  it("makes a block per recorded step, and appends steps that were recorded later (or inserts them after a block)", () => {
    const d = base();
    expect(d.blocks.map((b) => (b.type === "step" ? b.n : 0))).toEqual([1, 2, 3]);
    const more = syncSteps(d, [step(1), step(2), step(3), step(4), step(5, { deleted: true })]);
    expect(more.blocks.length).toBe(4);
    expect((more.blocks[3] as StepBlock).n).toBe(4);
    const mid = syncSteps(d, [step(1), step(2), step(3), step(4)], d.blocks[0].id);
    expect(mid.blocks.map((b) => (b as StepBlock).n)).toEqual([1, 4, 2, 3]);
    expect(syncSteps(d, [step(1), step(2), step(3)])).toBe(d);
  });

  it("inserts, removes, moves and duplicates blocks without changing the original", () => {
    const d = base();
    const [a, b, c] = ids(d);
    const withText = insertBlock(d, 1, content("t1"));
    expect(ids(withText)).toEqual([a, "t1", b, c]);
    expect(ids(d)).toEqual([a, b, c]);
    expect(ids(removeBlocks(withText, new Set([a, c])))).toEqual(["t1", b]);
    expect(ids(moveBlock(d, a, 1))).toEqual([b, a, c]);
    expect(moveBlock(d, a, -1)).toBe(d);
    expect(ids(moveBlockTo(d, a, 3))).toEqual([b, c, a]);
    expect(ids(moveBlockTo(d, c, 0))).toEqual([c, a, b]);
    expect(ids(moveBlocks(d, new Set([b, c]), -1))).toEqual([b, c, a]);
    expect(ids(moveBlocks(d, new Set([a, b]), 1))).toEqual([c, a, b]);
    const { doc: dup, id } = duplicateBlock(d, b);
    expect(dup.blocks.length).toBe(4);
    expect(dup.blocks[2].id).toBe(id);
    expect(id).not.toBe(b);
    expect((dup.blocks[2] as StepBlock).n).toBe(2);
    // Editing the copy leaves the original alone.
    const edited = updateBlock<StepBlock>(dup, id!, { markerHidden: true });
    expect((edited.blocks[1] as StepBlock).markerHidden).toBeUndefined();
  });

  it("numbers only steps, in the order of the blocks", () => {
    const d = insertBlock(base(), 1, content("t"));
    const n = stepNumbers(d);
    expect([...n.values()]).toEqual([1, 2, 3]);
    expect(n.has("t")).toBe(false);
  });

  it("shows the window by default, the screen when asked, a chosen crop, and the zoom area when zoom is on", () => {
    const d = base();
    const s = step(1);
    const b = d.blocks[0] as StepBlock;
    expect(cropRect(s, b, d)).toEqual([100, 50, 800, 500]);
    expect(cropRect(s, b, { ...d, picture: "screen" })).toEqual([0, 0, 1000, 600]);
    expect(cropRect(s, b, { ...d, keepFull: true })).toEqual([0, 0, 1000, 600]);
    expect(cropRect(s, { ...b, crop: [10, 10, 300, 200] }, d)).toEqual([10, 10, 300, 200]);
    expect(cropRect(step(1, { window: null }), b, d)).toEqual([0, 0, 1000, 600]);
    expect(viewRect(s, b, d)).toEqual([100, 50, 800, 500]);
    expect(viewRect(s, { ...b, zoom: true }, d)).toEqual([400, 250, 200, 100]);
    expect(viewRect(s, b, { ...d, zoomDefault: true })).toEqual([400, 250, 200, 100]);
    expect(viewRect(s, { ...b, zoom: false }, { ...d, zoomDefault: true })).toEqual([100, 50, 800, 500]);
    // A step without a click has no zoom.
    expect(viewRect(step(1, { click: null }), { ...b, zoom: true }, d)).toEqual([100, 50, 800, 500]);
  });

  it("uses the right colour for a right click and the left one for the others (a block can have its own)", () => {
    const d = base();
    const b = d.blocks[0] as StepBlock;
    expect(markerColor(step(1), b, d)).toBe("#f00");
    expect(markerColor(step(1, { kind: "rightClick" }), b, d)).toBe("#00f");
    expect(markerColor(step(1), { ...b, marker: { left: "#0f0" } }, d)).toBe("#0f0");
  });
});

describe("the history of the document", () => {
  it("undoes and redoes changes of any kind, and a new change clears redo", () => {
    const h = new History();
    const d0 = base();
    const d1 = insertBlock(d0, 0, content("t"));
    h.push(d0);
    const d2 = removeBlocks(d1, new Set([d1.blocks[1].id]));
    h.push(d1);
    expect(h.canUndo).toBe(true);
    expect(h.undo(d2)).toBe(d1);
    expect(h.undo(d1)).toBe(d0);
    expect(h.undo(d0)).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo(d0)).toBe(d1);
    h.push(d1);
    expect(h.canRedo).toBe(false);
    h.clear();
    expect(h.canUndo).toBe(false);
  });

  it("merges the edits of one typing run into one undo step", () => {
    const h = new History();
    const d = base();
    h.push(d, "text:b1", 800, 1000);
    h.push(updateBlock<StepBlock>(d, d.blocks[0].id, { markerHidden: true }), "text:b1", 800, 1300);
    h.push(d, "text:b1", 800, 1500);
    // (three edits within 800 ms of each other: one step back)
    expect(h.undo(d)).toBe(d);
    expect(h.canUndo).toBe(false);
    // A pause, or another block, starts a new step.
    h.push(d, "text:b1", 800, 5000);
    h.push(d, "text:b2", 800, 5100);
    expect(h.undo(d)).toBe(d);
    expect(h.undo(d)).toBe(d);
  });
});
