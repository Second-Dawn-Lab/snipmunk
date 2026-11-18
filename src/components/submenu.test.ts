import { describe, expect, it } from "vitest";
import { inSafeTriangle, inTriangle, insideRect, placeFlyout, submenuKey } from "./submenu";

const viewport = { width: 1000, height: 700 };
const parent = { left: 100, top: 200, right: 300, bottom: 234 };
const panel = { width: 200, height: 300 };

describe("where a flyout opens", () => {
  it("is to the right of its entry in left-to-right layouts, level with it", () => {
    const p = placeFlyout({ parent, panel, viewport, rtl: false });
    expect(p.side).toBe("right");
    expect(p.left).toBe(296);
    expect(p.top).toBe(196);
  });

  it("is to the left in right-to-left layouts", () => {
    const p = placeFlyout({ parent: { ...parent, left: 600, right: 800 }, panel, viewport, rtl: true });
    expect(p.side).toBe("left");
    expect(p.left).toBe(604 - 200);
  });

  it("flips to the other side when there is no room", () => {
    const p = placeFlyout({ parent: { ...parent, left: 700, right: 900 }, panel, viewport, rtl: false });
    expect(p.side).toBe("left");
    expect(p.left).toBe(704 - 200);
    const q = placeFlyout({ parent: { ...parent, left: 10, right: 210 }, panel, viewport, rtl: true });
    expect(q.side).toBe("right");
  });

  it("stays inside the window when neither side has room", () => {
    const p = placeFlyout({ parent: { left: 10, top: 10, right: 190, bottom: 40 }, panel: { width: 300, height: 100 }, viewport: { width: 220, height: 300 }, rtl: false });
    expect(p.left).toBe(8);
  });

  it("shifts up when it would run out of the bottom", () => {
    const p = placeFlyout({ parent: { ...parent, top: 600, bottom: 634 }, panel, viewport, rtl: false });
    expect(p.top + 300).toBeLessThanOrEqual(700 - 8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it("scrolls inside a window shorter than the flyout", () => {
    const p = placeFlyout({ parent, panel: { width: 200, height: 900 }, viewport: { width: 1000, height: 400 }, rtl: false });
    expect(p.top).toBe(8);
    expect(p.maxHeight).toBe(384);
  });
});

describe("the safe triangle", () => {
  const flyout = { left: 300, top: 200, right: 500, bottom: 500 };

  it("knows what is inside a triangle", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 0, y: 10 };
    expect(inTriangle({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(inTriangle({ x: 9, y: 9 }, a, b, c)).toBe(false);
    expect(inTriangle({ x: -1, y: 2 }, a, b, c)).toBe(false);
  });

  it("keeps the flyout open while the pointer heads for it across other entries", () => {
    const from = { x: 150, y: 215 };
    // Moving right and a little down towards the flyout, crossing the entries below the parent.
    expect(inSafeTriangle(from, { x: 220, y: 260 }, flyout, "right")).toBe(true);
    expect(inSafeTriangle(from, { x: 280, y: 400 }, flyout, "right")).toBe(true);
  });

  it("lets it close when the pointer goes somewhere else", () => {
    const from = { x: 150, y: 215 };
    expect(inSafeTriangle(from, { x: 150, y: 600 }, flyout, "right")).toBe(false);
    expect(inSafeTriangle(from, { x: 60, y: 215 }, flyout, "right")).toBe(false);
    expect(inSafeTriangle(from, { x: 200, y: 100 }, flyout, "right")).toBe(false);
  });

  it("works for a flyout on the left", () => {
    const left = { left: 0, top: 200, right: 200, bottom: 500 };
    const from = { x: 350, y: 215 };
    expect(inSafeTriangle(from, { x: 280, y: 260 }, left, "left")).toBe(true);
    expect(inSafeTriangle(from, { x: 350, y: 600 }, left, "left")).toBe(false);
  });

  it("knows if a point is inside a rectangle", () => {
    expect(insideRect(flyout, { x: 400, y: 300 })).toBe(true);
    expect(insideRect(flyout, { x: 250, y: 300 })).toBe(false);
  });
});

describe("keys at a submenu entry", () => {
  it("open with the arrow that points away from the menu, close with the other", () => {
    expect(submenuKey("ArrowRight", false)).toBe("open");
    expect(submenuKey("ArrowLeft", false)).toBe("close");
    expect(submenuKey("ArrowLeft", true)).toBe("open");
    expect(submenuKey("ArrowRight", true)).toBe("close");
    expect(submenuKey("ArrowDown", false)).toBeNull();
    expect(submenuKey("Enter", true)).toBeNull();
  });
});
