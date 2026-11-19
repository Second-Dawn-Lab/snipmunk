import { describe, expect, it } from "vitest";
import { newId } from "./schema";
import { snappedAnnotation } from "./snapShape";

const pen = { type: "pen" as const, id: newId(), points: [], color: "#E53935", size: 4 };
const marker = { type: "highlighter" as const, id: newId(), points: [], color: "#FFEB3B", size: 18 };

describe("the mark a snapped stroke becomes", () => {
  it("a line and an arrow keep the pen's colour and size", () => {
    const l = snappedAnnotation({ kind: "line", a: { x: 1, y: 2 }, b: { x: 30, y: 40 } }, pen);
    expect(l).toMatchObject({ type: "line", x1: 1, y1: 2, x2: 30, y2: 40, stroke: "#E53935", strokeWidth: 4, strokeOpacity: 100 });
    expect(snappedAnnotation({ kind: "arrow", a: { x: 0, y: 0 }, b: { x: 9, y: 9 } }, pen).type).toBe("arrow");
  });
  it("an ellipse and a rectangle are outlines without fill", () => {
    expect(snappedAnnotation({ kind: "ellipse", x: 0, y: 0, w: 10, h: 20 }, pen)).toMatchObject({ type: "ellipse", fill: "none", rotation: 0, w: 10, h: 20 });
    expect(snappedAnnotation({ kind: "rect", x: 5, y: 5, w: 10, h: 10 }, pen)).toMatchObject({ type: "rect", stroke: "#E53935" });
  });
  it("a highlighter shape stays see-through", () => {
    expect(snappedAnnotation({ kind: "rect", x: 0, y: 0, w: 10, h: 10 }, marker)).toMatchObject({ strokeOpacity: 45, stroke: "#FFEB3B", strokeWidth: 18 });
  });
  it("a polygon is a closed pen stroke with a new id", () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }];
    const a = snappedAnnotation({ kind: "polygon", name: "triangle", points: tri }, pen);
    expect(a.type).toBe("pen");
    expect(a.id).not.toBe(pen.id);
    if (a.type === "pen") {
      expect(a.points).toHaveLength(12);
      expect(a.points.slice(0, 2)).toEqual(a.points.slice(-3, -1));
    }
  });
});
