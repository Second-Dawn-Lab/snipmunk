import { describe, expect, it } from "vitest";
import { cursorAt } from "./cursorTrack";
import { parseCursorFile } from "./cursorFile";

const FILE = [
  '{"type":"header","version":1,"width":640,"height":360,"fps":30}',
  '{"t":0,"shape":"arrow","hx":1,"hy":2,"w":24,"h":24,"file":"cursors/arrow.png"}',
  '{"t":0,"x":10,"y":20,"v":1,"s":"arrow"}',
  '{"t":100,"x":30,"y":40,"v":1}',
  '{"t":150,"b":"l","d":1}',
  '{"t":200,"b":"l","d":0}',
  '{"t":300,"x":50,"y":60,"v":0,"s":"ibeam"}',
  '{"t":400,"x":5,',
].join("\n");

describe("the cursor track file", () => {
  const f = parseCursorFile(FILE);

  it("has the size, the pictures and the samples in seconds", () => {
    expect([f.width, f.height]).toEqual([640, 360]);
    expect(f.shapes.arrow).toEqual({ id: "arrow", hx: 1, hy: 2, w: 24, h: 24, file: "cursors/arrow.png" });
    expect(f.samples.map((s) => s.t)).toEqual([0, 0.1, 0.15, 0.2, 0.3]);
  });

  it("carries the shape, the buttons and the visibility forward and skips a line that a crash cut off", () => {
    expect(f.samples[2]).toMatchObject({ x: 30, y: 40, left: true, shape: "arrow", visible: true });
    expect(f.samples[3].left).toBe(false);
    expect(f.samples[4]).toMatchObject({ shape: "ibeam", visible: false });
    expect(f.samples).toHaveLength(5);
  });

  it("plays back through cursorAt: positions are interpolated between samples", () => {
    const mid = cursorAt(f.samples, 0.05);
    expect(mid?.x).toBeCloseTo(20);
    expect(mid?.y).toBeCloseTo(30);
    expect(cursorAt(f.samples, 0.16)?.left).toBe(true);
  });
});
