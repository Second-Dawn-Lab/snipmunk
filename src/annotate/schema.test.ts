import { describe, expect, it } from "vitest";
import { emptyDoc, isEdited, MAX_ITEMS, migrate, newId, sanitizeItem, toStored, type Annotation } from "./schema";

describe("reading stored annotations", () => {
  it("makes an empty document of nothing, of a Phase 2 placeholder and of rubbish", () => {
    for (const raw of [null, undefined, [], [1, 2], "x", 3, true]) expect(migrate(raw)).toEqual(emptyDoc());
  });

  it("keeps a good document as it is", () => {
    const doc = {
      version: 1,
      crop: { x: 10, y: 20, w: 300, h: 200 },
      rotation: 90,
      flipH: true,
      flipV: false,
      items: [
        { type: "rect", id: "r1", x: 1, y: 2, w: 30, h: 40, rotation: 0.5, fill: "#112233", fillOpacity: 50, stroke: "none", strokeOpacity: 100, strokeWidth: 3 },
        { type: "text", id: "t1", x: 5, y: 6, w: 70, h: 30, text: "Hello\nمرحبا", fontSize: 24, color: "#000000", background: true, rotation: 0, fixedWidth: false },
      ],
    };
    expect(migrate(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("is stable: reading what was read changes nothing", () => {
    const once = migrate({ version: 1, items: [{ type: "pen", id: "p", points: [0, 0, 0.5, 5, 5, 0.5], color: "#ff0000", size: 4 }] });
    expect(migrate(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("repairs numbers and colours and drops items it cannot use", () => {
    const doc = migrate({
      version: 1,
      rotation: 45,
      crop: { x: 0, y: 0, w: 0, h: 10 },
      items: [
        { type: "rect", x: "no", y: NaN, w: -30, h: 20, stroke: "red", strokeWidth: 9999, fillOpacity: 500 },
        { type: "emoji", x: 1, y: 1 },
        { type: "pen", points: [1, 2] },
        { type: "wat" },
        null,
        "x",
      ],
    });
    expect(doc.rotation).toBe(0);
    expect(doc.crop).toBeNull();
    expect(doc.items).toHaveLength(1);
    const r = doc.items[0];
    expect(r.type).toBe("rect");
    if (r.type === "rect") {
      expect([r.x, r.y, r.w]).toEqual([0, 0, 30]);
      expect(r.stroke).toBe("#E53935");
      expect(r.strokeWidth).toBe(200);
      expect(r.fillOpacity).toBe(100);
      expect(r.id.length).toBeGreaterThan(0);
    }
  });

  it("limits what a runaway file can make", () => {
    const items = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ type: "redact", id: `r${i}`, x: 0, y: 0, w: 5, h: 5 }));
    expect(migrate({ version: 1, items }).items).toHaveLength(MAX_ITEMS);
  });

  it("reads a newer version as far as it is understood", () => {
    const doc = migrate({ version: 9, rotation: 180, items: [{ type: "line", id: "l", x1: 0, y1: 0, x2: 5, y2: 5 }], future: { a: 1 } });
    expect(doc.version).toBe(1);
    expect(doc.rotation).toBe(180);
    expect(doc.items).toHaveLength(1);
  });

  it("checks pen points: three numbers per sample, pressure between 0 and 1", () => {
    expect(sanitizeItem({ type: "pen", points: [0, 0, 5, 1, 1, -3] })).toMatchObject({ points: [0, 0, 1, 1, 1, 0] });
    expect(sanitizeItem({ type: "pen", points: [0, 0, 0.5, "x", 1, 0.5] })).toBeNull();
  });
});

describe("what is stored", () => {
  it("is null when the document changes nothing", () => {
    expect(isEdited(emptyDoc())).toBe(false);
    expect(toStored(emptyDoc())).toBeNull();
  });

  it("is the document once there is a mark, a crop, a rotation or a flip", () => {
    const base = emptyDoc();
    const mark: Annotation = { type: "redact", id: "x", x: 0, y: 0, w: 5, h: 5, mode: "box" };
    for (const doc of [
      { ...base, items: [mark] },
      { ...base, crop: { x: 0, y: 0, w: 5, h: 5 } },
      { ...base, rotation: 90 as const },
      { ...base, flipH: true },
    ]) {
      expect(isEdited(doc)).toBe(true);
      expect(toStored(doc)).toBe(doc);
    }
  });

  it("gives every mark its own id", () => {
    expect(new Set(Array.from({ length: 500 }, () => newId())).size).toBe(500);
  });
});
