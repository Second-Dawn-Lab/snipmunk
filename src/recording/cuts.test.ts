import { describe, expect, it } from "vitest";
import { EditHistory, addSplit, cutEndAt, editedTime, keptMs, normalizeCuts, segmentAt, segments, toggleSegment } from "./cuts";

const c = (startMs: number, endMs: number) => ({ startMs, endMs });

describe("cuts", () => {
  it("sorts, merges, clamps and drops empty cuts", () => {
    expect(normalizeCuts([c(5000, 6000), c(1000, 2000), c(1500, 2500), c(2500, 3000), c(9000, 9000), c(8000, 99000)], 10000)).toEqual([c(1000, 3000), c(5000, 6000), c(8000, 10000)]);
  });

  it("works out the kept length and the edited time", () => {
    const cuts = [c(1000, 3000), c(5000, 6000), c(8000, 10000)];
    expect(keptMs(0, 10000, cuts)).toBe(5000);
    expect(keptMs(2000, 9000, cuts)).toBe(4000);
    expect(editedTime(500, 0, cuts)).toBe(500);
    expect(editedTime(3000, 0, cuts)).toBe(1000);
    expect(editedTime(6000, 0, cuts)).toBe(3000);
    expect(editedTime(3500, 2000, cuts)).toBe(500);
    expect(cutEndAt(1500, cuts)).toBe(3000);
    expect(cutEndAt(3000, cuts)).toBeNull();
  });

  it("splits make segments; deleting one cuts it out and it can be restored", () => {
    let splits = addSplit([], 4000, 0, 10000);
    splits = addSplit(splits, 7000, 0, 10000);
    expect(addSplit(splits, 4050, 0, 10000)).toEqual(splits);
    expect(addSplit(splits, 20, 0, 10000)).toEqual(splits);
    let list = segments(0, 10000, splits, []);
    expect(list.map((s) => [s.startMs, s.endMs, s.cut])).toEqual([[0, 4000, false], [4000, 7000, false], [7000, 10000, false]]);
    let cuts = toggleSegment([], segmentAt(list, 5000)!);
    expect(cuts).toEqual([c(4000, 7000)]);
    list = segments(0, 10000, splits, cuts);
    expect(segmentAt(list, 5000)!.cut).toBe(true);
    cuts = toggleSegment(cuts, segmentAt(list, 5000)!);
    expect(cuts).toEqual([]);
    // Two neighbours that are cut become one cut; restoring one of the segments leaves the other.
    const plain = segments(0, 10000, splits, []);
    cuts = toggleSegment(toggleSegment([], segmentAt(plain, 1000)!), segmentAt(plain, 5000)!);
    expect(cuts).toEqual([c(0, 7000)]);
    cuts = toggleSegment(cuts, segmentAt(segments(0, 10000, splits, cuts), 5000)!);
    expect(cuts).toEqual([c(0, 4000)]);
  });

  it("undoes and redoes", () => {
    const h = new EditHistory();
    const a = { cuts: [], splits: [] as number[] };
    const b = { cuts: [c(1, 2)], splits: [1] };
    h.push(a);
    expect(h.canUndo).toBe(true);
    expect(h.undo(b)).toEqual(a);
    expect(h.canRedo).toBe(true);
    expect(h.redo(a)).toEqual(b);
    expect(h.undo(a)).toEqual(a);
    h.push(b);
    expect(h.canRedo).toBe(false);
    expect(new EditHistory().undo(a)).toBeNull();
  });
});
