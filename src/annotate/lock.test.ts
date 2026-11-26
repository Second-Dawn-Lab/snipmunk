import { describe, expect, it } from "vitest";
import { commitAll, made, restrict, selectable, unlocked } from "./lock";

describe("marks lock like the Snipping Tool", () => {
  it("a new mark is the only one that can be edited; committing ends that", () => {
    expect(restrict(made(["a2"]), ["a1", "a2"])).toEqual(["a2"]);
    expect(commitAll(made(["a1"]))).toBe(unlocked);
  });
  it("a selection and the hit candidates only hold live marks, committed ones (old captures too) are out", () => {
    const s = made(["b"]);
    expect(restrict(s, ["a", "b", "c"])).toEqual(["b"]);
    expect(selectable(s, [{ id: "a" }, { id: "b" }])).toEqual([{ id: "b" }]);
    expect(restrict(unlocked, ["a", "b"])).toEqual([]);
    expect(selectable(unlocked, [{ id: "old" }])).toEqual([]);
  });
  it("committing nothing changes nothing", () => {
    expect(commitAll(unlocked)).toBe(unlocked);
  });
});
