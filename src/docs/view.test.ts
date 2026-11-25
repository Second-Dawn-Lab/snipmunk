import { describe, expect, it } from "vitest";
import { createDocument, moveBlocksTo } from "./model";
import { EDGE_SPEED, clampZoom, edgeSpeed, stepZoom } from "./view";

describe("drag auto-scroll", () => {
  it("scrolls only near the edges, faster the closer the pointer is, and not far outside", () => {
    const [top, bottom] = [100, 700];
    expect(edgeSpeed(400, top, bottom)).toBe(0);
    expect(edgeSpeed(195, top, bottom)).toBe(0);
    const near = edgeSpeed(180, top, bottom);
    const nearer = edgeSpeed(110, top, bottom);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
    expect(edgeSpeed(100, top, bottom)).toBe(-EDGE_SPEED);
    expect(edgeSpeed(60, top, bottom)).toBe(-EDGE_SPEED);
    expect(edgeSpeed(0, top, bottom)).toBe(0);
    expect(edgeSpeed(690, top, bottom)).toBeGreaterThan(edgeSpeed(620, top, bottom));
    expect(edgeSpeed(720, top, bottom)).toBe(EDGE_SPEED);
    expect(edgeSpeed(900, top, bottom)).toBe(0);
  });
  it("works in a very small list (the zones never overlap)", () => {
    expect(edgeSpeed(50, 0, 100)).toBe(0);
    expect(edgeSpeed(10, 0, 100)).toBeLessThan(0);
  });
});

describe("zoom", () => {
  it("stays between 50 and 200 percent and steps by ten", () => {
    expect(clampZoom(10)).toBe(50);
    expect(clampZoom(900)).toBe(200);
    expect(clampZoom(NaN)).toBe(100);
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(105, -1)).toBe(100);
    expect(stepZoom(200, 1)).toBe(200);
    expect(stepZoom(50, -1)).toBe(50);
  });
});

describe("moving a selection by drag", () => {
  const step = (n: number) => ({ n, kind: "click" as const, t: 0, image: "", imageSize: [10, 10] as [number, number], click: null, window: null, zoom: null, text: [], deleted: false });
  const doc = createDocument("T", 1, [1, 2, 3, 4, 5, 6].map(step), { marker: { left: "#000", right: "#000", shape: "circle", size: "small" }, badge: "circle", picture: "window", keepFull: false, zoomDefault: false });
  const numbers = (d: typeof doc) => d.blocks.map((b) => (b.type === "step" ? b.n : 0)).join("");
  const ids = (...n: number[]) => new Set(n.map((i) => doc.blocks[i - 1].id));
  it("moves the selected blocks together, in their order, to the place of the drop", () => {
    expect(numbers(moveBlocksTo(doc, ids(2, 4), 6))).toBe("135624");
    expect(numbers(moveBlocksTo(doc, ids(5, 6), 0))).toBe("561234");
    expect(numbers(moveBlocksTo(doc, ids(1, 2), 4))).toBe("341256");
    expect(numbers(moveBlocksTo(doc, ids(3), 3))).toBe("123456");
  });
});
