import { describe, expect, it } from "vitest";
import { commitAll, isLive, lockStep, made, restrict, selectable, unlocked } from "./lock";

describe("marks lock like the Snipping Tool", () => {
  it("a new mark is the only one that can be edited; the previous one is committed", () => {
    const first = made(["a1"]);
    expect(isLive(first, "a1")).toBe(true);
    const second = made(["a2"]);
    expect(isLive(second, "a1")).toBe(false);
    expect(isLive(second, "a2")).toBe(true);
  });
  it("a press on the live mark keeps it; a press elsewhere commits it", () => {
    const s = made(["a1"]);
    expect(lockStep(s, { type: "press", onLive: true })).toBe(s);
    expect(lockStep(s, { type: "press", onLive: false })).toEqual(unlocked);
  });
  it("a tool change, Esc, Enter, another capture and undo commit; other keys do not", () => {
    const s = made(["a1"]);
    for (const ev of [{ type: "toolChanged" }, { type: "key", key: "Escape" }, { type: "key", key: "Enter" }, { type: "captureChanged" }, { type: "history" }] as const) {
      expect(lockStep(s, ev).live.size, JSON.stringify(ev)).toBe(0);
    }
    expect(lockStep(s, { type: "key", key: "a" })).toBe(s);
    expect(lockStep(s, { type: "key", key: "ArrowLeft" })).toBe(s);
  });
  it("the Text tool handing over to Select keeps the finished box", () => {
    const s = made(["t1"]);
    expect(lockStep(s, { type: "toolChanged", keep: true })).toBe(s);
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
