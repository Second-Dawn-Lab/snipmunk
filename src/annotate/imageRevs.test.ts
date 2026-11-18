import { describe, expect, it } from "vitest";
import { hasRedactions, ImageRevisions, planImageSync, withoutRedactions, type EditState } from "./imageRevs";
import { History } from "./history";
import { emptyDoc, type Annotation, type AnnotationDoc } from "./schema";
import { redact, type PixelBuffer } from "./redact";

const cut: Annotation = { type: "redact", id: "r1", x: 2, y: 2, w: 6, h: 6, mode: "box" };
const line: Annotation = { type: "line", id: "l1", x1: 0, y1: 0, x2: 5, y2: 5, stroke: "#000000", strokeOpacity: 100, strokeWidth: 2 };

describe("the versions of the stored picture", () => {
  it("version 0 is on disk at the start and nothing else is kept", () => {
    const r = new ImageRevisions();
    expect(r.disk).toBe(0);
    expect(r.has(0)).toBe(true);
    expect(r.has(1)).toBe(false);
    expect(r.size).toBe(0);
  });

  it("burning in keeps the old and the new picture in memory only", () => {
    const r = new ImageRevisions();
    const original = new Uint8Array([1, 2, 3, 4]);
    const baked = new Uint8Array([9, 9]);
    r.remember(r.disk, original); // before the file is replaced
    const rev = r.allocate();
    r.remember(rev, baked);
    r.setDisk(rev);
    expect(rev).toBe(1);
    expect(r.disk).toBe(1);
    expect(r.get(0)).toBe(original);
    expect(r.size).toBe(6);
  });

  it("plans what undo and redo have to do to the file", () => {
    const r = new ImageRevisions();
    r.remember(0, new Uint8Array([1]));
    const rev = r.allocate();
    r.remember(rev, new Uint8Array([2]));
    r.setDisk(rev);
    expect(planImageSync(r, 1)).toEqual({ kind: "none" });
    expect(planImageSync(r, 0)).toEqual({ kind: "restore", rev: 0 });
    r.setDisk(0);
    expect(planImageSync(r, 1)).toEqual({ kind: "restore", rev: 1 });
    expect(planImageSync(r, 7)).toEqual({ kind: "missing", rev: 7 });
  });

  it("every burn-in gets its own version", () => {
    const r = new ImageRevisions();
    expect([r.allocate(), r.allocate(), r.allocate()]).toEqual([1, 2, 3]);
  });

  it("forgets everything when asked", () => {
    const r = new ImageRevisions();
    r.remember(0, new Uint8Array(100));
    r.clear();
    expect(r.size).toBe(0);
  });
});

describe("the document after a permanent redaction", () => {
  it("has no redactions and keeps every other mark, the crop and the rotation", () => {
    const doc = { ...emptyDoc(), crop: { x: 1, y: 1, w: 5, h: 5 }, rotation: 90 as const, flipH: true, items: [line, cut, { ...cut, id: "r2" }] };
    const baked = withoutRedactions(doc);
    expect(baked.items).toEqual([line]);
    expect(baked.crop).toEqual(doc.crop);
    expect(baked.rotation).toBe(90);
    expect(baked.flipH).toBe(true);
    expect(doc.items).toHaveLength(3);
  });
  it("knows whether there is something to burn in", () => {
    expect(hasRedactions({ items: [line] })).toBe(false);
    expect(hasRedactions({ items: [line, cut] })).toBe(true);
    expect(hasRedactions({ items: [] })).toBe(false);
  });
});

describe("burning in, undo and redo with the history", () => {
  /** The pixels the file holds, for each version. */
  const picture = (fill: number): PixelBuffer => ({ width: 10, height: 10, data: new Uint8ClampedArray(400).fill(fill) });

  it("the file has no original pixels in the area after the burn-in, undo brings them back, redo burns again", () => {
    const revs = new ImageRevisions();
    const history = new History<EditState<AnnotationDoc>>({ doc: { ...emptyDoc(), items: [line, cut] }, rev: 0 });
    // The file on "disk":
    let file = picture(77);
    const original = new Uint8Array(file.data);

    // Burn in: remember the old file, make the new one (the redaction applied to the pixels), replace the file.
    revs.remember(0, original);
    const baked = { ...file, data: new Uint8ClampedArray(file.data) };
    redact(baked, { x: cut.type === "redact" ? cut.x : 0, y: 2, w: 6, h: 6 }, "box");
    const rev = revs.allocate();
    revs.remember(rev, new Uint8Array(baked.data));
    file = baked;
    revs.setDisk(rev);
    history.push({ doc: withoutRedactions(history.current.doc), rev });

    const inArea = (f: PixelBuffer) => f.data[(4 * 10 + 4) * 4];
    expect(inArea(file)).toBe(0);
    expect(history.current.doc.items).toEqual([line]);
    // No version of the picture was written anywhere but memory: the only copies are the ones in `revs`.
    expect(revs.get(0)).toEqual(original);

    // Undo: the history goes back to rev 0, so the file gets the old bytes and the redaction comes back.
    const before = history.undo()!;
    const plan = planImageSync(revs, before.rev);
    expect(plan).toEqual({ kind: "restore", rev: 0 });
    file = { ...file, data: new Uint8ClampedArray(revs.get(0)!) };
    revs.setDisk(0);
    expect(inArea(file)).toBe(77);
    expect(before.doc.items).toHaveLength(2);

    // Redo: the baked picture is written again, without rendering it a second time.
    const again = history.redo()!;
    expect(planImageSync(revs, again.rev)).toEqual({ kind: "restore", rev: 1 });
    file = { ...file, data: new Uint8ClampedArray(revs.get(1)!) };
    revs.setDisk(1);
    expect(inArea(file)).toBe(0);
    expect(again.doc.items).toEqual([line]);
  });

  it("a new edit after an undo of a burn-in drops the redo, but the memory still has what undo needs", () => {
    const revs = new ImageRevisions();
    revs.remember(0, new Uint8Array([5]));
    const history = new History<EditState<AnnotationDoc>>({ doc: { ...emptyDoc(), items: [cut] }, rev: 0 });
    history.push({ doc: emptyDoc(), rev: revs.allocate() });
    history.undo();
    history.push({ doc: { ...emptyDoc(), items: [line] }, rev: 0 });
    expect(history.canRedo).toBe(false);
    expect(revs.get(0)).toBeDefined();
  });
});
