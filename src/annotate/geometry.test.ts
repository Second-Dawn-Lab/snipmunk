import { describe, expect, it } from "vitest";
import {
  arrowHead, boundsOf, boxOf, canRotate, distToSegment, dragHandle, dragLine, dragRect, handleAt, handlesOf, hitTest, itemsInRect,
  resizeBox, rotatePoint, rotateTo, snapLine, topmostAt, translate,
} from "./geometry";
import type { Annotation, ShapeAnnotation } from "./schema";

const rect = (o: Partial<ShapeAnnotation> = {}): ShapeAnnotation => ({
  type: "rect", id: "r", x: 100, y: 100, w: 200, h: 100, rotation: 0, fill: "none", fillOpacity: 100, stroke: "#ff0000", strokeOpacity: 100, strokeWidth: 4, ...o,
});
const pen: Annotation = { type: "pen", id: "p", points: [0, 0, 0.5, 100, 0, 0.5, 100, 50, 0.5], color: "#000000", size: 6 };
const arrow: Annotation = { type: "arrow", id: "a", x1: 0, y1: 0, x2: 100, y2: 0, stroke: "#000000", strokeOpacity: 100, strokeWidth: 4 };

describe("distances", () => {
  it("to a segment", () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
  it("rotating a point", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("hit testing", () => {
  it("hits a pen stroke near its line and not far from it", () => {
    expect(hitTest(pen, { x: 50, y: 2 }, 0)).toBe(true);
    expect(hitTest(pen, { x: 50, y: 10 }, 0)).toBe(false);
    expect(hitTest(pen, { x: 50, y: 10 }, 8)).toBe(true);
    expect(hitTest(pen, { x: 100, y: 40 }, 0)).toBe(true);
  });
  it("hits an unfilled rectangle on its border only, a filled one anywhere inside", () => {
    expect(hitTest(rect(), { x: 100, y: 150 }, 0)).toBe(true);
    expect(hitTest(rect(), { x: 200, y: 150 }, 0)).toBe(false);
    expect(hitTest(rect({ fill: "#00ff00" }), { x: 200, y: 150 }, 0)).toBe(true);
    expect(hitTest(rect({ fill: "#00ff00" }), { x: 400, y: 150 }, 0)).toBe(false);
  });
  it("takes the rotation of a shape into account", () => {
    const r = rect({ fill: "#00ff00", rotation: Math.PI / 2 }); // 200 x 100 turned: now 100 wide, 200 tall around (200, 150)
    expect(hitTest(r, { x: 200, y: 60 }, 0)).toBe(true);
    expect(hitTest(r, { x: 140, y: 150 }, 0)).toBe(false);
  });
  it("hits an ellipse inside its curve, not in the corner of its box", () => {
    const e: Annotation = { ...rect({ fill: "#00ff00" }), type: "ellipse" };
    expect(hitTest(e, { x: 200, y: 150 }, 0)).toBe(true);
    expect(hitTest(e, { x: 105, y: 105 }, 0)).toBe(false);
  });
  it("hits a line and an arrow near them", () => {
    expect(hitTest(arrow, { x: 50, y: 3 }, 0)).toBe(true);
    expect(hitTest(arrow, { x: 50, y: 20 }, 0)).toBe(false);
  });
  it("hits text, emoji and redactions inside their box", () => {
    const text: Annotation = { type: "text", id: "t", x: 0, y: 0, w: 100, h: 30, text: "x", fontSize: 20, color: "#000000", background: false, rotation: 0, fixedWidth: false };
    const emoji: Annotation = { type: "emoji", id: "e", x: 0, y: 0, size: 50, char: "🔥", rotation: 0 };
    const cut: Annotation = { type: "redact", id: "x", x: 0, y: 0, w: 50, h: 50, mode: "box" };
    expect(hitTest(text, { x: 90, y: 20 }, 0)).toBe(true);
    expect(hitTest(text, { x: 110, y: 20 }, 0)).toBe(false);
    expect(hitTest(emoji, { x: 25, y: 25 }, 0)).toBe(true);
    expect(hitTest(cut, { x: 49, y: 49 }, 0)).toBe(true);
    expect(hitTest(cut, { x: 60, y: 25 }, 0)).toBe(false);
  });
  it("the topmost mark wins", () => {
    const a = rect({ id: "a", fill: "#00ff00" });
    const b = rect({ id: "b", fill: "#0000ff" });
    expect(topmostAt([a, b], { x: 200, y: 150 }, 0)).toBe("b");
    expect(topmostAt([b, a], { x: 200, y: 150 }, 0)).toBe("a");
    expect(topmostAt([a, b], { x: 0, y: 0 }, 0)).toBeNull();
  });
  it("a drag box selects the marks it touches", () => {
    expect(itemsInRect([rect({ id: "a" }), pen], { x: 90, y: 90, w: 30, h: 30 })).toEqual(["a"]);
    expect(itemsInRect([rect({ id: "a" }), pen], { x: -10, y: -10, w: 500, h: 500 }).sort()).toEqual(["a", "p"]);
  });
});

describe("bounds and moving", () => {
  it("bounds include the ink of a stroke and the line width", () => {
    expect(boundsOf(pen)).toEqual({ x: -3, y: -3, w: 106, h: 56 });
    expect(boundsOf(rect())).toEqual({ x: 98, y: 98, w: 204, h: 104 });
  });
  it("the bounds of a turned shape are those of its corners", () => {
    const b = boundsOf(rect({ rotation: Math.PI / 2, strokeWidth: 0 }));
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
  });
  it("moves every kind of mark", () => {
    expect(translate(rect(), 5, -5)).toMatchObject({ x: 105, y: 95 });
    expect(translate(arrow, 1, 2)).toMatchObject({ x1: 1, y1: 2, x2: 101, y2: 2 });
    expect((translate(pen, 10, 20) as typeof pen).points.slice(0, 3)).toEqual([10, 20, 0.5]);
    expect(pen.points[0]).toBe(0);
  });
  it("the box of a line is its end points", () => {
    expect(boxOf(arrow)).toEqual({ x: 0, y: 0, w: 100, h: 0, rotation: 0 });
  });
});

describe("handles", () => {
  it("has eight around a shape and one to turn it", () => {
    const h = handlesOf(rect(), 24);
    expect(h.map((x) => x.kind)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"]);
    expect(h[0]).toMatchObject({ x: 100, y: 100 });
    expect(h[8]).toMatchObject({ x: 200, y: 76 });
  });
  it("has the end points of a line and none to turn", () => {
    expect(handlesOf(arrow, 24).map((x) => x.kind)).toEqual(["p1", "p2"]);
    expect(handlesOf(pen, 24).some((x) => x.kind === "rotate")).toBe(false);
    expect(canRotate(pen)).toBe(false);
    expect(canRotate(rect())).toBe(true);
  });
  it("finds the nearest handle within a radius", () => {
    const h = handlesOf(rect(), 24);
    expect(handleAt(h, { x: 103, y: 99 }, 8)?.kind).toBe("nw");
    expect(handleAt(h, { x: 150, y: 150 }, 8)).toBeNull();
  });
  it("resizing keeps the opposite side where it is", () => {
    const b = resizeBox({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "se", { x: 400, y: 260 });
    expect(b).toEqual({ x: 100, y: 100, w: 300, h: 160, rotation: 0 });
    const w = resizeBox({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "w", { x: 50, y: 999 });
    expect(w).toEqual({ x: 50, y: 100, w: 250, h: 100, rotation: 0 });
  });
  it("resizing never goes below the minimum, and flipping over is stopped there", () => {
    const b = resizeBox({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "e", { x: 20, y: 0 }, 6);
    expect(b.w).toBe(6);
    expect(b.x).toBe(100);
  });
  it("resizing a turned shape keeps its far side in place", () => {
    const start = { x: 100, y: 100, w: 200, h: 100, rotation: Math.PI / 2 };
    const anchorBefore = handlesOf({ ...rect(), ...start }, 0).find((h) => h.kind === "w")!;
    const next = resizeBox(start, "e", rotatePoint({ x: 350, y: 150 }, { x: 200, y: 150 }, 0));
    const anchorAfter = handlesOf({ ...rect(), ...next }, 0).find((h) => h.kind === "w")!;
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y);
  });
  it("dragging a corner of a pen stroke scales its points", () => {
    const next = dragHandle(pen, "se", { x: 200, y: 100 }) as typeof pen;
    expect(next.points.slice(3, 6)).toEqual([200, 0, 0.5]);
    expect(next.points.slice(6, 9)).toEqual([200, 100, 0.5]);
  });
  it("dragging a corner of text scales its font", () => {
    const t: Annotation = { type: "text", id: "t", x: 0, y: 0, w: 100, h: 40, text: "x", fontSize: 20, color: "#000000", background: false, rotation: 0, fixedWidth: false };
    const next = dragHandle(t, "se", { x: 200, y: 80 }) as typeof t;
    expect(next.fontSize).toBeCloseTo(40);
  });
  it("dragging an end of a line moves it, with Shift in 45 degree steps", () => {
    expect(dragHandle(arrow, "p2", { x: 60, y: 40 })).toMatchObject({ x2: 60, y2: 40 });
    const s = dragHandle(arrow, "p2", { x: 100, y: 10 }, true) as typeof arrow;
    expect(s.y2).toBeCloseTo(0);
    expect(s.x2).toBeCloseTo(Math.hypot(100, 10));
  });
  it("turns a shape towards the pointer", () => {
    const r = rotateTo(rect(), { x: 400, y: 150 }, false);
    expect(r.rotation).toBeCloseTo(Math.PI / 2);
    const snapped = rotateTo(rect(), { x: 400, y: 160 }, true);
    expect((snapped.rotation / (Math.PI / 12)) % 1).toBeCloseTo(0);
    expect(rotateTo(pen, { x: 1, y: 1 }, false)).toBe(pen);
  });
});

describe("Shift while drawing shapes", () => {
  it("makes a square or circle", () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 60, y: 30 }, false)).toEqual({ x: 10, y: 10, w: 50, h: 20 });
    expect(dragRect({ x: 10, y: 10 }, { x: 60, y: 30 }, true)).toEqual({ x: 10, y: 10, w: 50, h: 50 });
    expect(dragRect({ x: 10, y: 10 }, { x: -40, y: -5 }, true)).toEqual({ x: -40, y: -40, w: 50, h: 50 });
    expect(dragRect({ x: 10, y: 10 }, { x: 10, y: 10 }, true)).toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });
  it("snaps lines to 45 degree angles", () => {
    expect(dragLine({ x: 0, y: 0 }, { x: 100, y: 30 }, false)[1]).toEqual({ x: 100, y: 30 });
    const s = snapLine({ x: 0, y: 0 }, { x: 100, y: 30 });
    expect(s.y).toBeCloseTo(0);
    const d = snapLine({ x: 0, y: 0 }, { x: 80, y: 100 });
    expect(d.x).toBeCloseTo(d.y);
    expect(snapLine({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe("the arrow head", () => {
  it("grows with the stroke and stops the line short of the tip", () => {
    const thin = arrowHead(0, 0, 200, 0, 2);
    const thick = arrowHead(0, 0, 200, 0, 12);
    expect(thin.tip).toEqual({ x: 200, y: 0 });
    expect(thick.left.x).toBeLessThan(thin.left.x);
    expect(Math.abs(thick.left.y)).toBeGreaterThan(Math.abs(thin.left.y));
    expect(thin.base.x).toBeLessThan(200);
    expect(thin.base.x).toBeGreaterThan(thin.left.x - 1);
  });
  it("is symmetric about the line", () => {
    const h = arrowHead(0, 0, 100, 100, 4);
    const mid = { x: (h.left.x + h.right.x) / 2, y: (h.left.y + h.right.y) / 2 };
    expect(mid.x - mid.y).toBeCloseTo(0);
  });
  it("is smaller on a very short arrow", () => {
    const h = arrowHead(0, 0, 10, 0, 8);
    expect(h.left.x).toBeGreaterThanOrEqual(3.9);
  });
});
