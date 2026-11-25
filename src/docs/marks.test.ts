// 7.5-D: callouts, magnifiers and spotlights (model and geometry), their drawing, and the tools that act on them.
import { describe, expect, it } from "vitest";
import { stepPictureHtml } from "./export/html";
import { markLayer, overLayer } from "./export/pictures";
import {
  CALLOUT_DEFAULT,
  CALLOUT_SHAPES,
  FRAME_W,
  MAX_SIDE,
  SPOT_DEFAULT,
  approxMeasure,
  bubbleBox,
  calloutPath,
  calloutStyle,
  clampBox,
  connector,
  coveredBox,
  legacyCallout,
  magnifyStyle,
  newCallout,
  newMagnify,
  outerPadding,
  restyleCallout,
  sourcePicture,
  sourceSquare,
  spotStyle,
  textHeight,
  toPicture,
  upgradeCallout,
  withBox,
} from "./marks";
import type { Annotation, Rect, StepBlock } from "./model";
import { readChoices, rememberChoice } from "./panel/choices";
import { TOOL_GROUPS, TOOL_LETTERS, toolForKey } from "./panel/ToolGrid";
import { draggedMark } from "./StepPicture";

const view: Rect = [100, 50, 1400, 700]; // frame units are half the picture pixels: 700 wide, 350 high
const size: [number, number] = [1920, 1080];
const make = (tip: [number, number], end: [number, number] | null = null) => newCallout("c1", tip, end, view, CALLOUT_DEFAULT, approxMeasure);
const old: Annotation = { id: "o1", kind: "callout", x: 300, y: 200, x2: 500, y2: 400, color: "#FF0000", width: 3, text: "Save here" };

describe("callouts", () => {
  it("completes and limits the options", () => {
    expect(calloutStyle({})).toEqual(CALLOUT_DEFAULT);
    expect(calloutStyle({ shape: "cloud", fill: "#000000", width: 99, size: 2, bold: true, textColor: "url(x)" })).toEqual({ ...CALLOUT_DEFAULT, shape: "cloud", fill: "#000000", width: 12, size: 10, bold: true });
    expect(calloutStyle({ shape: "star" }).shape).toBe("rounded");
  });

  it("has six shapes, each with an outline and a pointer to a tip outside the box", () => {
    expect(CALLOUT_SHAPES).toHaveLength(6);
    const box = { x: 100, y: 100, w: 160, h: 60 };
    for (const shape of CALLOUT_SHAPES) {
      const p = calloutPath(shape, box, [400, 300], 3);
      expect(p.body.startsWith("M"), shape).toBe(true);
      expect(p.body).not.toContain("NaN");
      // (a speech bubble and an oval run out into the tip, the others point at it)
      if (shape === "speech" || shape === "oval") expect(p.body).toContain("L400 300");
      else if (shape === "cloud") expect(p.dots).toHaveLength(3);
      else if (shape === "label") expect(p.head).toContain("M400 300");
      else expect(p.leader?.[1]).toEqual([400, 300]);
      // With the tip inside the box nothing points anywhere.
      const inside = calloutPath(shape, box, [120, 120], 3);
      expect([inside.leader, inside.head, inside.dots?.length ?? 0]).toEqual([undefined, undefined, 0]);
    }
  });

  it("is placed beside its tip in frame units, or where the drag ended, also outside the picture", () => {
    const a = make([300, 400]);
    expect([a.x2, a.y2]).toEqual([300, 400]);
    expect(a.box!.w).toBe(190);
    expect(a.box!.x).toBe(150); // the tip is at 100 in the frame: the box stands 50 further on
    const outside = make([300, 400], [40, 400]);
    expect(outside.box!.x).toBeLessThan(0);
    // x and y say where the box is in picture pixels (for a version that knows no box).
    expect([outside.x, outside.y]).toEqual(toPicture(outside.box!.x, outside.box!.y, view).map(Math.round));
    expect(clampBox({ x: -5000, y: 5000, w: 100, h: 40 }, view)).toEqual({ x: -MAX_SIDE, y: 350 + 300 - 40, w: 100, h: 40 });
  });

  it("keeps its place and size when the picture is zoomed, and its tip stays on the screen content", () => {
    const a = make([700, 400], [40, 100]);
    const zoomed: Rect = [600, 300, 350, 175];
    const same = restyleCallout(a, { bold: true }, zoomed, approxMeasure);
    expect([same.box!.x, same.box!.y, same.box!.w]).toEqual([a.box!.x, a.box!.y, a.box!.w]);
    expect([same.x2, same.y2]).toEqual([700, 400]);
  });

  it("grows and shrinks with its text, and keeps a height that was chosen", () => {
    const a = make([300, 400]);
    const long = restyleCallout(a, { text: "A rather long explanation that wraps onto several lines of the box" }, view, approxMeasure);
    expect(long.box!.h).toBeGreaterThan(a.box!.h * 2);
    expect(long.box!.h).toBe(textHeight(long.text!, long.box!, calloutStyle(long), approxMeasure));
    expect(restyleCallout(long, { text: "Short" }, view, approxMeasure).box!.h).toBe(a.box!.h);
    const lines = restyleCallout(a, { text: "one\ntwo\nthree" }, view, approxMeasure);
    expect(lines.box!.h).toBeGreaterThan(a.box!.h);
    const tall = withBox(a, { ...a.box!, h: 200 }, view);
    expect(restyleCallout(tall, { text: "Short" }, view, approxMeasure).box!.h).toBe(200);
  });

  it("leaves a callout of an older guide as it is drawn, until it is edited", () => {
    const was = legacyCallout(old, view);
    expect(was.box).toEqual([300, 200, 9 * 30 * 0.6 + 32, 58]);
    expect(coveredBox(old, view)).toBeNull();
    expect(outerPadding([old], view)).toEqual({ side: 0, top: 0, bottom: 0 });
    const next = upgradeCallout(old, view);
    // The same box on the page, in frame units; the tip where it was.
    const [x, y] = toPicture(next.box!.x, next.box!.y, view);
    expect([Math.round(x), Math.round(y), next.box!.w * 2, next.box!.h * 2]).toEqual([300, 200, was.box[2], was.box[3]]);
    expect([next.x2, next.y2, next.size, next.width, next.fill, next.text]).toEqual([500, 400, 15, 3, "#FFFFFF", "Save here"]);
    expect(upgradeCallout(next, view)).toBe(next);
    expect(old.box).toBeUndefined();
  });

  it("makes room around the picture for what reaches beyond it: the same on both sides", () => {
    const left = { ...make([300, 400]), box: { x: -100, y: -30, w: 150, h: 40 }, width: 2 };
    expect(outerPadding([left], view)).toEqual({ side: 101, top: 31, bottom: 0 });
    const right = { ...left, box: { x: 650, y: 340, w: 150, h: 40 } };
    expect(outerPadding([right], view)).toEqual({ side: 101, top: 0, bottom: 31 });
    expect(outerPadding([{ ...left, box: { x: 10, y: 10, w: 100, h: 40 } }], view)).toEqual({ side: 0, top: 0, bottom: 0 });
  });

  it("survives being written and read as JSON, with every option", () => {
    const a = restyleCallout(make([300, 400]), { shape: "speech", fill: "#101010", color: "#202020", textColor: "#F0F0F0", size: 22, bold: true, width: 5, text: "x" }, view, approxMeasure);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(calloutStyle(a)).toEqual({ shape: "speech", fill: "#101010", color: "#202020", textColor: "#F0F0F0", size: 22, bold: true, width: 5 });
  });

  it("is moved, resized and re-pointed by its handles", () => {
    const a = make([300, 400]);
    const moved = draggedMark(a, "move", 20, -40, view, size, approxMeasure);
    expect([moved.box!.x, moved.box!.y]).toEqual([a.box!.x + 10, a.box!.y - 20]);
    const wider = draggedMark(a, "e", 100, 0, view, size, approxMeasure);
    expect(wider.box!.w).toBe(a.box!.w + 50);
    const low = draggedMark(a, "n", 0, 400, view, size, approxMeasure);
    expect(low.box!.y + low.box!.h).toBeCloseTo(a.box!.y + a.box!.h, 0);
    const tip = draggedMark(a, "tip", 9000, 9000, view, size, approxMeasure);
    expect([tip.x2, tip.y2]).toEqual([1500, 750]);
    // An old one becomes editable as soon as it is dragged.
    expect(draggedMark(old, "move", 2, 2, view, size, approxMeasure).box).toBeDefined();
  });
});

describe("magnifiers", () => {
  const a = newMagnify("m1", [300, 400, 100, 100], view, magnifyStyle({ zoom: 3 }));

  it("shows its area 2 to 4 times larger, beside it", () => {
    expect(magnifyStyle({ zoom: 9 }).zoom).toBe(4);
    expect(magnifyStyle({ zoom: 1 }).zoom).toBe(2);
    const b = bubbleBox(a, view);
    expect(b.w).toBe((100 / 2) * 3);
    // the area is at 100..150 in the frame: the bubble stands clear of it
    expect(b.x).toBeGreaterThan(150);
    expect(connector({ x: 100, y: 175, w: 50, h: 50 }, b, "circle")).not.toBeNull();
    expect(connector({ x: b.x + 40, y: b.y + 40, w: 50, h: 50 }, b, "circle")).toBeNull();
    // Another view (a zoom into the click): the same centre, the same magnification of what is shown.
    const zoomed = bubbleBox(a, [200, 300, 700, 350]);
    expect([zoomed.x + zoomed.w / 2, zoomed.w]).toEqual([a.at!.x, 300]);
  });

  it("keeps its area square and inside the picture", () => {
    expect(sourceSquare(5, 5, 100, size)).toEqual([0, 0, 100, 100]);
    expect(sourceSquare(1915, 500, 100, size)).toEqual([1820, 450, 100, 100]);
    const moved = draggedMark(a, "source", -9000, 0, view, size, approxMeasure);
    expect([moved.x, moved.x2, moved.at]).toEqual([0, 100, a.at]);
    const larger = draggedMark(a, "sourceSize", 50, 10, view, size, approxMeasure);
    expect([larger.x, larger.y, larger.x2, larger.y2]).toEqual([300, 400, 450, 550]);
    // A larger bubble shows a larger area at the same magnification, around the same middle.
    const bigger = draggedMark(a, "bubbleSize", 30, 0, view, size, approxMeasure);
    expect(bubbleBox(bigger, view).w).toBeCloseTo(bubbleBox(a, view).w + 30, 0);
    expect(bigger.x! + (bigger.x2! - bigger.x!) / 2).toBe(350);
    const away = draggedMark(a, "bubble", 9000, 0, view, size, approxMeasure);
    expect(away.at!.x + bubbleBox(a, view).w / 2).toBe(FRAME_W + MAX_SIDE);
  });

  it("takes its pixels from the step picture, or from its own piece when the area lies outside it", () => {
    const patch = { file: "pic-1-mab.png", x: -40, y: -10, x2: -20, y2: 10 };
    const outside: Annotation = { id: "m", kind: "magnify", x: -40, y: -10, x2: -20, y2: 10, color: "#000", width: 2, patch };
    expect(sourcePicture(outside, "s.png", [100, 60])).toEqual({ file: "pic-1-mab.png", x: -40, y: -10, width: 20, height: 20 });
    expect(sourcePicture({ ...outside, x: 10, y: 10, x2: 30, y2: 30 }, "s.png", [100, 60])).toEqual({ file: "s.png", x: 0, y: 0, width: 100, height: 60 });
  });

  it("is drawn with the area's own pixels, enlarged into the bubble", () => {
    const block = { id: "b", type: "step", n: 1, annotations: [a] } as StepBlock;
    const svg = overLayer(block, view, new Map([["m1", { href: "data:x", x: 300, y: 400, width: 100, height: 100 }]]), approxMeasure);
    const b = bubbleBox(a, view);
    expect(svg).toContain(`viewBox="300 400 100 100"`);
    expect(svg).toContain(`href="data:x"`);
    expect(svg).toContain(`width="${b.w * 2}"`);
    // Nothing of it is drawn on the picture's own layer.
    expect(markLayer(block, {}, view)).toBe("");
  });
});

describe("spotlights", () => {
  const spot: Annotation = { id: "s1", kind: "spot", x: 300, y: 200, x2: 500, y2: 320, shape: "ellipse", color: "#000", width: 0 };

  it("takes the style of the step, else of the guide, within 20 to 80 percent", () => {
    expect(spotStyle({}, {})).toEqual(SPOT_DEFAULT);
    expect(spotStyle({ spotlight: { dim: 70, tone: "light" } }, { spotlight: { soft: true } })).toEqual({ dim: 70, tone: "light", soft: true });
    expect(spotStyle({ spotlight: { dim: 70 } }, { spotlight: { dim: 5 } }).dim).toBe(20);
    expect(spotStyle({ spotlight: { dim: 100 } }, {}).dim).toBe(80);
  });

  it("dims everything outside all spotlights, once", () => {
    const block = { id: "b", type: "step", n: 1, annotations: [spot, { ...spot, id: "s2", x: 700, x2: 800, shape: "rect" }], spotlight: { dim: 40 } } as StepBlock;
    const svg = markLayer(block, { spotlight: { ...SPOT_DEFAULT, tone: "light" } }, view);
    expect(svg).toContain("<mask");
    expect(svg).toContain("<ellipse");
    expect(svg).toContain(`fill="#FFFFFF" fill-opacity="0.4"`);
    expect(svg.match(/mask="url\(#spot\)"/g)).toHaveLength(1);
    expect(svg).not.toContain("feGaussianBlur");
    expect(markLayer({ ...block, spotlight: { soft: true } }, {}, view)).toContain("feGaussianBlur");
  });

  it("is resized within the picture", () => {
    expect(draggedMark(spot, "move", 9000, -9000, view, size, approxMeasure)).toMatchObject({ x: 1720, y: 0, x2: 1920, y2: 120 });
    expect(draggedMark(spot, "w", 500, 0, view, size, approxMeasure)).toMatchObject({ x: 492, x2: 500 });
    expect(outerPadding([spot], view)).toEqual({ side: 0, top: 0, bottom: 0 });
  });
});

describe("a step picture with marks around it", () => {
  const picture = { src: "data:p", width: 800, height: 400 };

  it("is laid out in HTML with room for them, and stays the plain picture without", () => {
    expect(stepPictureHtml(picture, "a <b>")).toBe(`<img class="step__pic" src="data:p" width="800" height="400" alt="a &lt;b&gt;">`);
    const html = stepPictureHtml({ ...picture, over: { src: "data:o", width: 1040, height: 480, side: 0.15, top: 0.1, bottom: 0 } }, "x");
    expect(html).toContain(`<div class="step__fig" style="--out-side:0.15;--out-top:0.1;--out-bottom:0">`);
    expect(html).toContain(`class="step__pic" src="data:p"`);
    expect(html).toContain(`class="step__over" src="data:o" width="1040" height="480"`);
  });
});

describe("the tools", () => {
  const limits = { hasClick: true, canExpand: false };
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) => toolForKey({ key, ctrlKey: false, altKey: false, metaKey: false, target: null, ...extra }, limits);

  it("has a letter of its own for every tool", () => {
    const keys = TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect([TOOL_LETTERS.a, TOOL_LETTERS.o, TOOL_LETTERS.s, TOOL_LETTERS.g]).toEqual(["arrow", "callout", "spot", "magnify"]);
  });

  it("chooses a tool by its letter, not while typing and not for what the step cannot do", () => {
    expect(press("a")).toBe("arrow");
    expect(press("R")).toBe("rect");
    expect(press("a", { ctrlKey: true })).toBeNull();
    expect(press("w")).toBeNull();
    const field = { tagName: "TEXTAREA", closest: () => null } as unknown as EventTarget;
    expect(press("a", { target: field })).toBeNull();
  });

  it("remembers the last options, and follows the template's colour until one is chosen", () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readChoices("#123456", store).callout).toEqual({ ...CALLOUT_DEFAULT, color: "#123456" });
    rememberChoice({ callout: { shape: "oval", size: 30 } }, store);
    rememberChoice({ callout: { bold: true }, spotShape: "ellipse" }, store);
    const read = readChoices("#654321", store);
    expect(read.callout).toEqual({ ...CALLOUT_DEFAULT, shape: "oval", size: 30, bold: true, color: "#654321" });
    expect(read.spotShape).toBe("ellipse");
    data.set("snipmunk.guide.marks", "not json");
    expect(readChoices("#000000", store).spotShape).toBe("rect");
  });
});
