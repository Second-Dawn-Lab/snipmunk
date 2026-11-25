import { describe, expect, it } from "vitest";
import type { GuideStep } from "../../ipc";
import { createDocument, type StepBlock } from "../model";
import { applyTemplate, changeTemplate, materializeFrames, shownRect, templateOf } from "./apply";
import { canvasCss, documentCss } from "./css";
import { fillFrame, fitFrame, frameSource, zoomFrame } from "./frame";
import { BASIC, BUILT_INS, colorsOf, contrast, deriveColors, frameRatio, normalizeTemplate, onColor, pageSize } from "./model";

const defaults = { marker: { left: "#f00", right: "#00f", shape: "circle" as const, size: "medium" as const }, badge: "circle" as const, picture: "window" as const, keepFull: false, zoomDefault: false };
const step = (n: number): GuideStep => ({ n, kind: "click", t: 0, image: `s${n}.png`, imageSize: [1920, 1080], click: [500, 300], window: { rect: [100, 100, 800, 600], title: "W", process: "p" }, zoom: null, text: [{ t: "x" }], deleted: false });

describe("colours", () => {
  it("derives text that meets WCAG AA on light and dark pages, for every preset", () => {
    for (const bg of ["#FFFFFF", "#14161A"]) {
      for (const main of ["#A0522D", "#2563EB", "#FFFF00", "#101010", "#FAFAFA", "#7C3AED"]) {
        const c = deriveColors(main, bg);
        expect(contrast(c.text, bg), `${main} text on ${bg}`).toBeGreaterThanOrEqual(7);
        expect(contrast(c.dark, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.accent, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.text, c.light), `${main} text on its light fill`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(onColor(main), main)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("every built-in template is readable and complete", () => {
    expect(BUILT_INS.map((t) => t.id)).toEqual(["blank", "basic", "clean", "corporate", "training", "compact", "dark"]);
    for (const t of BUILT_INS) {
      const c = colorsOf(t);
      expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(4.5);
      expect(normalizeTemplate(t)).toEqual(t);
      expect(canvasCss(t)).toContain(".gpage.doc");
      expect(documentCss(t)).toContain("--tpl-main");
    }
    expect(pageSize(BUILT_INS.find((x) => x.id === "dark")!)).toBeNull();
    expect(pageSize(BASIC)).toEqual({ w: 210, h: 297 });
  });
  it("completes a partial template with the basic values and refuses nonsense", () => {
    const t = normalizeTemplate({ name: "Mine", page: { margin: 999 }, frame: { ratio: "custom", w: -4, h: 3 }, fonts: { size: "big" } });
    expect(t.name).toBe("Mine");
    expect(t.page.margin).toBe(40);
    expect(t.frame.w).toBe(1);
    expect(t.fonts.size).toBe(BASIC.fonts.size);
    expect(t.footer).toEqual(BASIC.footer);
  });
});

describe("picture frame", () => {
  const size: [number, number] = [1920, 1080];
  it("fills the frame with real screen content around the area, and pads only where the screen ends", () => {
    // a 4:3 area (800x600) in a 16:9 frame: widened with context
    expect(frameSource(fillFrame([100, 100, 800, 600], 16 / 9, size), 16 / 9, size)).toEqual([0, 100, 1067, 600]);
    // the whole screen in a 1:1 frame: Fill crops, Fit pads above and below
    expect(frameSource(fillFrame([0, 0, 1920, 1080], 1, size), 1, size)).toEqual([420, 0, 1080, 1080]);
    expect(frameSource(fitFrame([0, 0, 1920, 1080], 1), 1, size)).toEqual([0, -420, 1920, 1920]);
  });
  it("moves and zooms around the centre, staying on the screen while it can", () => {
    expect(frameSource({ cx: 0, cy: 0, w: 400 }, 2, size)).toEqual([0, 0, 400, 200]);
    expect(frameSource({ cx: 5000, cy: 5000, w: 400 }, 2, size)).toEqual([1520, 880, 400, 200]);
    const range = { fit: 400, widest: 800, narrowest: 40 };
    expect(zoomFrame({ cx: 10, cy: 10, w: 400 }, 2, range).w).toBe(200);
    expect(zoomFrame({ cx: 10, cy: 10, w: 50 }, 100, range).w).toBe(40);
  });
  it("keeps each step's centre and zoom when the ratio changes, and writes the places into the saved document", () => {
    const steps = new Map([[1, step(1)]]);
    let doc = createDocument("T", 1, [step(1)], defaults);
    const b = () => doc.blocks[0] as StepBlock;
    expect(shownRect(step(1), b(), doc).ratio).toBeNull();
    expect(materializeFrames(doc, steps)).toBe(doc);
    doc = changeTemplate(doc, (t) => (t.frame.ratio = "16:9"));
    const saved = materializeFrames(doc, steps).blocks[0] as StepBlock;
    expect(saved.frame!.cx).toBe(500);
    expect(saved.frame!.cy).toBe(400);
    doc = { ...doc, blocks: [saved] };
    doc = changeTemplate(doc, (t) => (t.frame.ratio = "1:1"));
    const r = shownRect(step(1), b(), doc).view;
    expect(r[2]).toBe(Math.round(saved.frame!.w));
    expect(r[3]).toBe(r[2]);
    expect(frameRatio(templateOf(doc))).toBe(1);
  });
});

describe("applying a template", () => {
  it("embeds a copy, takes its marker and badge, and a change to it stays in the guide", () => {
    const doc = createDocument("T", 1, [step(1)], defaults);
    const training = BUILT_INS.find((x) => x.id === "training")!;
    const next = applyTemplate(doc, training);
    expect(next.template).toEqual(training);
    expect(next.template).not.toBe(training);
    expect(next.badge).toBe("pill");
    expect(next.marker.shape).toBe("ring");
    const changed = changeTemplate(next, (t) => (t.colors.main = "#123456"));
    expect(templateOf(changed).colors.main).toBe("#123456");
    expect(changed.marker).toBe(next.marker);
    expect(training.colors.main).not.toBe("#123456");
    expect(templateOf(doc)).toBe(BASIC);
  });
});
