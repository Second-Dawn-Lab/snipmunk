import { describe, expect, it } from "vitest";
import { History } from "./history";

describe("undo and redo", () => {
  it("steps back and forward through the states", () => {
    const h = new History("a");
    h.push("b");
    h.push("c");
    expect(h.current).toBe("c");
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
    expect(h.undo()).toBeNull();
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe("b");
    expect(h.redo()).toBe("c");
    expect(h.redo()).toBeNull();
  });

  it("a new change drops what could have been redone", () => {
    const h = new History("a");
    h.push("b");
    h.push("c");
    h.undo();
    h.push("d");
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe("b");
  });

  it("joins changes with the same key that come quickly, like dragging a slider", () => {
    let t = 0;
    const h = new History("a", 200, () => t);
    h.push("b", "colour");
    t = 100;
    h.push("c", "colour");
    t = 200;
    h.push("d", "colour");
    expect(h.undo()).toBe("a");
    t = 5000;
    h.push("e", "colour");
    t = 5100;
    h.push("f", "size");
    expect(h.undo()).toBe("e");
  });

  it("does not join across a slow pause or a different key, or after undo", () => {
    let t = 0;
    const h = new History("a", 200, () => t);
    h.push("b", "k");
    t = 2000;
    h.push("c", "k");
    expect(h.undo()).toBe("b");
    h.push("d", "k");
    expect(h.undo()).toBe("b");
  });

  it("forgets the oldest steps beyond the limit", () => {
    const h = new History(0, 5);
    for (let i = 1; i <= 20; i++) h.push(i);
    let steps = 0;
    while (h.undo() !== null) steps++;
    expect(steps).toBe(4);
    expect(h.current).toBe(16);
  });
});
