import { describe, expect, it } from "vitest";
import { drawAnnotation, FONT_STACK, isRtlText, labelColor, measureTextBox, prepareWork, renderDoc, textLines, workKey, type Ctx, type WorkCanvas } from "./render";
import { emptyDoc, type Annotation } from "./schema";

// --- fakes ----------------------------------------------------------------------------------------------------------------

interface FakeCanvas extends WorkCanvas {
  data: Uint8ClampedArray;
  ctx: FakeCtx;
}
interface FakeCtx {
  drawImage(img: FakeCanvas, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { width: number; height: number; data: Uint8ClampedArray };
  putImageData(d: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): void;
}

function fakeCanvas(width: number, height: number): FakeCanvas {
  const data = new Uint8ClampedArray(width * height * 4);
  const canvas = { width, height, data } as FakeCanvas;
  canvas.ctx = {
    drawImage(img, x, y) {
      for (let r = 0; r < img.height; r++) {
        for (let c = 0; c < img.width; c++) {
          const s = (r * img.width + c) * 4;
          const d = ((r + y) * width + c + x) * 4;
          for (let k = 0; k < 4; k++) data[d + k] = img.data[s + k];
        }
      }
    },
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) for (let k = 0; k < 4; k++) out[(r * w + c) * 4 + k] = data[((r + y) * width + c + x) * 4 + k];
      return { width: w, height: h, data: out };
    },
    putImageData(d, x, y) {
      for (let r = 0; r < d.height; r++) for (let c = 0; c < d.width; c++) for (let k = 0; k < 4; k++) data[((r + y) * width + c + x) * 4 + k] = d.data[(r * d.width + c) * 4 + k];
    },
  };
  canvas.getContext = () => canvas.ctx;
  return canvas;
}

function noiseCanvas(w: number, h: number): FakeCanvas {
  const c = fakeCanvas(w, h);
  let s = 7;
  for (let i = 0; i < c.data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    c.data[i] = i % 4 === 3 ? 255 : s >>> 24;
  }
  return c;
}

/** A context that records every call and every property that is set. */
function recorder() {
  const calls: [string, unknown[]][] = [];
  const props: Record<string, unknown> = {};
  const alphaAtCall: Record<string, unknown[]> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => (props[k] !== undefined && typeof props[k] !== "function" ? props[k] : (...args: unknown[]) => {
        calls.push([k, args]);
        (alphaAtCall[k] ??= []).push(props.globalAlpha);
      }),
      set: (_t, k: string, v) => {
        props[k] = v;
        return true;
      },
    },
  ) as unknown as Ctx;
  return { ctx, calls, props, alphaAtCall, names: () => calls.map((c) => c[0]) };
}

// --- redaction in the rendered picture -----------------------------------------------------------------------------------

describe("the picture that is rendered holds no original pixels in a redacted area", () => {
  const redactItem = (mode: "pixelate" | "blur" | "box"): Annotation => ({ type: "redact", id: "x", x: 20, y: 10, w: 80, h: 50, mode });

  for (const mode of ["pixelate", "blur", "box"] as const) {
    it(`${mode}`, () => {
      const source = noiseCanvas(160, 100);
      const original = new Uint8ClampedArray(source.data);
      const work = prepareWork(fakeCanvas as never, source as unknown as CanvasImageSource, 160, 100, [redactItem(mode)]) as FakeCanvas;
      // The source itself is untouched.
      expect(source.data).toEqual(original);
      let same = 0;
      for (let y = 10; y < 60; y++) {
        for (let x = 20; x < 100; x++) {
          const i = (y * 160 + x) * 4;
          if (work.data[i] === original[i] && work.data[i + 1] === original[i + 1] && work.data[i + 2] === original[i + 2]) same++;
        }
      }
      expect(same / (80 * 50)).toBeLessThan(0.03);
      // Outside the area the picture is as it was.
      for (const [x, y] of [[0, 0], [19, 10], [100, 59], [159, 99], [50, 9], [50, 60]]) {
        const i = (y * 160 + x) * 4;
        expect([work.data[i], work.data[i + 1], work.data[i + 2]]).toEqual([original[i], original[i + 1], original[i + 2]]);
      }
    });
  }

  it("renderDoc draws the prepared picture, never the original", () => {
    const source = noiseCanvas(160, 100);
    const work = prepareWork(fakeCanvas as never, source as unknown as CanvasImageSource, 160, 100, [redactItem("pixelate")]);
    const { ctx, calls } = recorder();
    renderDoc(ctx, work as unknown as CanvasImageSource, 160, 100, { ...emptyDoc(), items: [redactItem("pixelate")] });
    const draws = calls.filter((c) => c[0] === "drawImage");
    expect(draws).toHaveLength(1);
    expect(draws[0][1][0]).toBe(work);
    expect(draws[0][1][0]).not.toBe(source);
  });

  it("redactions overlapping each other and the edge are all applied", () => {
    const source = noiseCanvas(60, 40);
    const items: Annotation[] = [
      { type: "redact", id: "a", x: -10, y: -10, w: 30, h: 30, mode: "box" },
      { type: "redact", id: "b", x: 50, y: 30, w: 50, h: 50, mode: "box" },
    ];
    const work = prepareWork(fakeCanvas as never, source as unknown as CanvasImageSource, 60, 40, items) as FakeCanvas;
    expect([...work.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    const last = (39 * 60 + 59) * 4;
    expect([...work.data.slice(last, last + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("the cache key changes with the redactions and with nothing else", () => {
    const base: Annotation[] = [{ type: "redact", id: "a", x: 1, y: 2, w: 3, h: 4, mode: "blur" }];
    expect(workKey(base)).toBe(workKey([...base, { type: "line", id: "l", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#000000", strokeOpacity: 100, strokeWidth: 1 }]));
    expect(workKey(base)).not.toBe(workKey([{ ...base[0], mode: "box" } as Annotation]));
    expect(workKey([])).toBe("");
  });
});

// --- drawing -----------------------------------------------------------------------------------------------------------

describe("drawing the marks", () => {
  it("draws the highlighter as one stroke with one alpha, so a crossing does not darken", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "highlighter", id: "h", points: [0, 0, 0.5, 50, 0, 0.5, 50, 40, 0.5, 0, 40, 0.5, 0, 2, 0.5], color: "#FFEB3B", size: 16 });
    expect(r.names().filter((n) => n === "stroke")).toHaveLength(1);
    expect(r.alphaAtCall.stroke).toEqual([0.4]);
    expect(r.props.lineWidth).toBe(16);
  });

  it("draws an arrow as a line and a filled head", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "arrow", id: "a", x1: 0, y1: 0, x2: 100, y2: 0, stroke: "#ff0000", strokeOpacity: 100, strokeWidth: 6 });
    expect(r.names().filter((n) => n === "stroke")).toHaveLength(1);
    expect(r.names().filter((n) => n === "fill")).toHaveLength(1);
  });

  it("draws a rectangle with a fill opacity and no outline when the outline is none", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "rect", id: "r", x: 0, y: 0, w: 50, h: 30, rotation: 0, fill: "#00ff00", fillOpacity: 40, stroke: "none", strokeOpacity: 100, strokeWidth: 3 });
    expect(r.names()).toContain("fill");
    expect(r.names()).not.toContain("stroke");
    expect(r.alphaAtCall.fill).toEqual([0.4]);
  });

  it("draws a pen stroke as a filled outline", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "pen", id: "p", points: [0, 0, 0.5, 10, 5, 0.5, 20, 0, 0.5], color: "#112233", size: 6 });
    expect(r.names()).toContain("fill");
    expect(r.props.fillStyle).toBe("#112233");
  });

  it("does not draw a redaction (it is in the pixels already)", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "redact", id: "x", x: 0, y: 0, w: 5, h: 5, mode: "box" });
    expect(r.calls).toHaveLength(0);
  });

  it("draws every line of a text and a label behind it", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "text", id: "t", x: 0, y: 0, w: 120, h: 80, text: "one\ntwo\nthree", fontSize: 20, color: "#000000", background: true, rotation: 0, fixedWidth: false });
    expect(r.calls.filter((c) => c[0] === "fillText").map((c) => c[1][0])).toEqual(["one", "two", "three"]);
    expect(r.names()).toContain("fillRect");
    expect(String(r.props.font)).toContain("20px");
    expect(r.props.direction).toBe("ltr");
  });

  it("draws Arabic text right to left, from the right edge", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "text", id: "t", x: 0, y: 0, w: 100, h: 30, text: "مرحبا بالعالم", fontSize: 20, color: "#000000", background: false, rotation: 0, fixedWidth: false });
    expect(r.props.direction).toBe("rtl");
    expect(r.props.textAlign).toBe("right");
    const x = r.calls.find((c) => c[0] === "fillText")?.[1][1] as number;
    expect(x).toBe(50);
  });

  it("draws an emoji with an emoji-capable font", () => {
    const r = recorder();
    drawAnnotation(r.ctx, { type: "emoji", id: "e", x: 0, y: 0, size: 60, char: "🔥", rotation: 0 });
    expect(String(r.props.font)).toContain("Segoe UI Emoji");
    expect(r.calls.find((c) => c[0] === "fillText")?.[1][0]).toBe("🔥");
  });
});

describe("a flipped picture keeps its text readable", () => {
  const text: Annotation = { type: "text", id: "t", x: 0, y: 0, w: 100, h: 30, text: "abc", fontSize: 20, color: "#000000", background: false, rotation: 0, fixedWidth: false };
  it("draws text and emoji mirrored once more when the picture is flipped", () => {
    const flipped = recorder();
    drawAnnotation(flipped.ctx, text, { h: true, v: false });
    expect(flipped.calls.filter((c) => c[0] === "scale")).toEqual([["scale", [-1, 1]]]);
    const vertical = recorder();
    drawAnnotation(vertical.ctx, text, { h: false, v: true });
    expect(vertical.calls.filter((c) => c[0] === "scale")).toEqual([["scale", [1, -1]]]);
  });
  it("does not when the picture is not flipped, or flipped both ways (a half turn)", () => {
    for (const flip of [undefined, { h: false, v: false }, { h: true, v: true }]) {
      const r = recorder();
      drawAnnotation(r.ctx, text, flip);
      expect(r.calls.filter((c) => c[0] === "scale")).toHaveLength(0);
    }
  });
  it("renderDoc passes the flips of the document on", () => {
    const r = recorder();
    renderDoc(r.ctx, {} as CanvasImageSource, 400, 300, { ...emptyDoc(), flipH: true, items: [text] });
    expect(r.calls.filter((c) => c[0] === "scale")).toEqual([["scale", [-1, 1]]]);
  });
});

describe("rendering a document", () => {
  it("applies crop, flip and rotation as one transform, clips to the crop and returns the size", () => {
    const r = recorder();
    const work = {} as CanvasImageSource;
    const size = renderDoc(r.ctx, work, 400, 300, { ...emptyDoc(), crop: { x: 100, y: 50, w: 200, h: 100 }, rotation: 90 });
    expect(size).toEqual({ width: 100, height: 200 });
    const order = r.names();
    expect(order.indexOf("transform")).toBeLessThan(order.indexOf("clip"));
    expect(order.indexOf("clip")).toBeLessThan(order.indexOf("drawImage"));
    expect(order[0]).toBe("save");
    expect(order[order.length - 1]).toBe("restore");
    expect(r.calls.find((c) => c[0] === "rect")?.[1]).toEqual([100, 50, 200, 100]);
  });

  it("scales for a thumbnail", () => {
    const r = recorder();
    const size = renderDoc(r.ctx, {} as CanvasImageSource, 1000, 500, emptyDoc(), 0.25);
    expect(size).toEqual({ width: 250, height: 125 });
    expect(r.calls.find((c) => c[0] === "scale")?.[1]).toEqual([0.25, 0.25]);
  });
});

describe("text helpers", () => {
  it("know right to left text by its first letter", () => {
    expect(isRtlText("مرحبا")).toBe(true);
    expect(isRtlText("שלום")).toBe(true);
    expect(isRtlText("  123 مرحبا")).toBe(true);
    expect(isRtlText("Hello مرحبا")).toBe(false);
    expect(isRtlText("你好")).toBe(false);
    expect(isRtlText("")).toBe(false);
    expect(isRtlText("123")).toBe(false);
  });
  it("split lines on any line break", () => {
    expect(textLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });
  it("measure the box of a text: the widest line, the lines, the label padding", () => {
    const m = (s: string) => s.length * 10;
    expect(measureTextBox(m, "ab\nabcd", 20, false)).toEqual({ w: 40, h: 50 });
    const label = measureTextBox(m, "ab\nabcd", 20, true);
    expect(label.w).toBe(40 + 12);
    expect(label.h).toBe(50 + 12);
    expect(measureTextBox(m, "", 20, false).w).toBeGreaterThan(0);
  });
  it("put a white label behind dark text and a black one behind light text", () => {
    expect(labelColor("#000000")).toBe("#ffffff");
    expect(labelColor("#FFEB3B")).toBe("#000000");
  });
  it("use fonts for emoji, Chinese and Arabic after the system font", () => {
    expect(FONT_STACK.startsWith('"Segoe UI Variable Text"')).toBe(true);
    for (const f of ["Segoe UI Emoji", "Microsoft YaHei UI", "Noto Sans"]) expect(FONT_STACK).toContain(f);
  });
});
