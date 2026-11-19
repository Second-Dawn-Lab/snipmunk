import { describe, expect, it } from "vitest";
import { recognize, simplify, starPoints, strokePoints } from "./shapeRecognizer";

// A small deterministic generator, so "sloppy" strokes are the same on every run.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

type P = [number, number];
/** A stroke along corner points, `step` pixels apart, with noise (in pixels). */
function along(corners: P[], step = 4, noise = 0, seed = 1): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [x0, y0] = corners[i];
    const [x1, y1] = corners[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) out.push(x0 + ((x1 - x0) * k) / n + r() * noise, y0 + ((y1 - y0) * k) / n + r() * noise, 0.5);
  }
  const [lx, ly] = corners[corners.length - 1];
  out.push(lx, ly, 0.5);
  return out;
}
function circle(cx: number, cy: number, rx: number, ry: number, noise = 0, seed = 2, gap = 0.02): number[] {
  const r = rng(seed);
  const out: number[] = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const a = ((1 - gap) * 2 * Math.PI * i) / n - Math.PI / 2;
    out.push(cx + rx * Math.cos(a) + r() * noise, cy + ry * Math.sin(a) + r() * noise, 0.5);
  }
  return out;
}

describe("hold to shape: what snaps", () => {
  it("a straight line, also a sloppy one", () => {
    expect(recognize(along([[10, 10], [210, 60]]))).toMatchObject({ kind: "line" });
    const s = recognize(along([[10, 10], [310, 40]], 4, 5, 7));
    expect(s).toMatchObject({ kind: "line", a: expect.any(Object) });
  });
  it("an arrow: a shaft and two barbs", () => {
    const stroke = along([[20, 100], [220, 100], [190, 80], [220, 100], [190, 120]], 4, 1.5, 3);
    const s = recognize(stroke);
    expect(s?.kind).toBe("arrow");
    if (s?.kind === "arrow") {
      expect(s.a.x).toBeLessThan(40);
      expect(s.b.x).toBeGreaterThan(200);
    }
  });
  it("a circle and an ellipse, closed with a small gap and some noise", () => {
    expect(recognize(circle(100, 100, 60, 60, 3))).toMatchObject({ kind: "ellipse" });
    const e = recognize(circle(200, 100, 120, 50, 3, 5, 0.04));
    expect(e).toMatchObject({ kind: "ellipse" });
    if (e?.kind === "ellipse") {
      expect(e.w).toBeGreaterThan(220);
      expect(e.h).toBeLessThan(110);
    }
  });
  it("a rectangle and a square (sloppy corners)", () => {
    const r = recognize(along([[20, 20], [220, 22], [218, 120], [22, 118], [20, 24]], 4, 3, 4));
    expect(r).toMatchObject({ kind: "rect" });
    expect(recognize(along([[20, 20], [120, 20], [120, 120], [20, 120], [20, 20]], 4, 2, 9))).toMatchObject({ kind: "rect" });
  });
  it("a turned rectangle becomes a polygon", () => {
    const s = recognize(along([[100, 20], [180, 100], [100, 180], [20, 100], [100, 20]], 4, 2, 6));
    expect(s).toMatchObject({ kind: "polygon", name: "quad" });
  });
  it("a triangle", () => {
    const s = recognize(along([[100, 20], [190, 170], [10, 170], [100, 20]], 4, 3, 8));
    expect(s).toMatchObject({ kind: "polygon", name: "triangle" });
    if (s?.kind === "polygon") expect(s.points).toHaveLength(3);
  });
  it("a star: the outline, and the five lines drawn in one stroke", () => {
    const outline = starPoints(120, 120, 100).map((p): P => [p.x, p.y]);
    expect(recognize(along([...outline, outline[0]], 4, 2, 10))).toMatchObject({ kind: "polygon", name: "star" });
    const outer = starPoints(120, 120, 100).filter((_, i) => i % 2 === 0).map((p): P => [p.x, p.y]);
    const order = [0, 2, 4, 1, 3, 0].map((i) => outer[i]);
    const s = recognize(along(order, 4, 2, 11));
    expect(s).toMatchObject({ kind: "polygon", name: "star" });
    if (s?.kind === "polygon") expect(s.points).toHaveLength(10);
  });
});

describe("hold to shape: what must stay freehand", () => {
  it("a tiny stroke or a dot", () => {
    expect(recognize(along([[10, 10], [14, 12]]))).toBeNull();
    expect(recognize([5, 5, 0.5, 5, 5, 0.5, 6, 5, 0.5])).toBeNull();
  });
  it("a scribble and a zigzag", () => {
    const zig: P[] = [];
    for (let i = 0; i < 12; i++) zig.push([10 + i * 20, i % 2 ? 10 : 70]);
    expect(recognize(along(zig, 4, 1, 12))).toBeNull();
    const r = rng(21);
    const scribble: number[] = [];
    let x = 100;
    let y = 100;
    for (let i = 0; i < 160; i++) {
      x += r() * 40;
      y += r() * 40;
      scribble.push(x, y, 0.5);
    }
    expect(recognize(scribble)).toBeNull();
  });
  it("an open arc (a C), a wave and the letter S", () => {
    expect(recognize(circle(100, 100, 60, 60, 1, 3, 0.45))).toBeNull();
    const wave: P[] = [];
    for (let i = 0; i <= 40; i++) wave.push([10 + i * 6, 60 + 30 * Math.sin(i / 4)]);
    expect(recognize(along(wave, 3, 0, 4))).toBeNull();
    const s: P[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * 2 * Math.PI;
      s.push([100 + 40 * Math.sin(t) * (t < Math.PI ? 1 : -1) * 0 + 40 * Math.cos(t * 1), 100 + 50 * Math.sin(t / 2) * Math.sign(Math.cos(t))]);
    }
    expect(recognize(along(s.slice(0, 20), 3, 0, 5))).toBeNull();
  });
  it("a shape smaller than the minimum size does not snap", () => {
    expect(recognize(circle(20, 20, 6, 6, 0), 40)).toBeNull();
    expect(recognize(circle(20, 20, 40, 40, 0), 40)).toMatchObject({ kind: "ellipse" });
  });
  it("a closed blob that is neither round nor a polygon", () => {
    const blob: P[] = [[0, 0], [60, 10], [70, 50], [40, 30], [30, 80], [0, 60], [-10, 30], [0, 0]];
    expect(recognize(along(blob, 3, 0, 6))).toBeNull();
  });
});

describe("helpers", () => {
  it("drops duplicate points and simplifies to the corners", () => {
    expect(strokePoints([0, 0, 1, 0, 0, 1, 10, 0, 1])).toHaveLength(2);
    const l = simplify(strokePoints(along([[0, 0], [100, 0], [100, 100]], 5)), 3);
    expect(l).toHaveLength(3);
  });
});
