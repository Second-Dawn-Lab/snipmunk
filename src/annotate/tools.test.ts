import { describe, expect, it } from "vitest";
import { keyOf, toolForKey, undoKeyFor } from "./tools";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods,
});

describe("tool shortcuts", () => {
  it("V P H E S T C R B", () => {
    expect(["v", "p", "h", "e", "s", "t", "c", "r", "b"].map((k) => toolForKey(key(k)))).toEqual([
      "select", "pen", "highlighter", "eraser", "shapes", "text", "crop", "rotate", "blur",
    ]);
  });
  it("ignore the case and other keys, and keys held with Ctrl, Alt or Meta", () => {
    expect(toolForKey(key("P"))).toBe("pen");
    expect(toolForKey(key("x"))).toBeNull();
    expect(toolForKey(key("p", { ctrlKey: true }))).toBeNull();
    expect(toolForKey(key("p", { altKey: true }))).toBeNull();
    expect(toolForKey(key("p", { metaKey: true }))).toBeNull();
  });
  it("show the letter in the tooltip", () => {
    expect(keyOf("pen")).toBe("P");
    expect(keyOf("rotate")).toBe("R");
    expect(keyOf("blur")).toBe("B");
  });
});

describe("undo keys", () => {
  it("Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo", () => {
    expect(undoKeyFor(key("z", { ctrlKey: true }))).toBe("undo");
    expect(undoKeyFor(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(undoKeyFor(key("y", { ctrlKey: true }))).toBe("redo");
  });
  it("need Ctrl, and ignore Alt and Ctrl+Shift+Y", () => {
    expect(undoKeyFor(key("z"))).toBeNull();
    expect(undoKeyFor(key("z", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(undoKeyFor(key("y", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(undoKeyFor(key("a", { ctrlKey: true }))).toBeNull();
  });
});
