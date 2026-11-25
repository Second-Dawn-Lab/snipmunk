// 7.5-C3: the Blank template, hidden step numbers, zoom without a frame, the sidebar, page flow and the view that stays still.
import { describe, expect, it } from "vitest";
import type { GuideStep } from "../ipc";
import { exportMarkdown } from "./export/markdown";
import { chunks, tocEntries, type ExportData } from "./export/html";
import { fillPages } from "./export/paginate";
import { createDocument, stepNumbers, type ContentBlock, type GuideDoc, type StepBlock } from "./model";
import { draggedWidth, PANEL_MAX, PANEL_MIN } from "./panel/SidePanel";
import { firstWords } from "./panel/outline";
import { stepOptions } from "./panel/stepOptions";
import { placeAfterChange } from "./place";
import { applyTemplate, changeTemplate, framing, materializeFrames, shownRect, templateOf } from "./template/apply";
import { areaSource, sliderOf, widthAt, zoomFrame, zoomPercent } from "./template/frame";
import { BASIC, BLANK, BUILT_INS, normalizeTemplate } from "./template/model";

const step = (n: number, more: Partial<GuideStep> = {}): GuideStep =>
  ({ n, kind: "click", t: 0, monitor: [0, 0, 1000, 800], scale: 1, image: `step-${n}.png`, imageSize: [1000, 800], click: [500, 400], text: [{ t: `Step ${n}` }], ...more }) as GuideStep;
const defaults = { marker: BASIC.marker, badge: "circle" as const, picture: "screen" as const, keepFull: false, zoomDefault: false };
const guide = (count: number): GuideDoc => createDocument("Printer", 1, Array.from({ length: count }, (_, i) => step(i + 1)), defaults);
const steps = new Map([1, 2, 3].map((n) => [n, step(n)]));
const first = (d: GuideDoc) => d.blocks[0] as StepBlock;

describe("the Blank template", () => {
  it("is the first one and has no look", () => {
    expect(BUILT_INS[0]).toBe(BLANK);
    expect(BLANK.cover.on).toBe(false);
    expect(BLANK.contents).toBe(false);
    expect(BLANK.cover.image).toBeNull();
    expect(BLANK.frame.ratio).toBe("original");
    expect(Object.values({ ...BLANK.header, texts: "" }).filter((v) => v !== "none" && v !== "")).toEqual([]);
    expect(Object.values({ ...BLANK.footer, texts: "" }).filter((v) => v !== "none" && v !== "")).toEqual([]);
    expect(BLANK.picture).toMatchObject({ borderWidth: 0, radius: 0, shadow: false });
    expect(normalizeTemplate(BLANK)).toEqual(BLANK);
  });
  it("takes a look away and keeps what was written, the blocks included", () => {
    let doc = applyTemplate(guide(2), BUILT_INS.find((x) => x.id === "corporate")!);
    doc = changeTemplate(doc, (t) => {
      t.cover.title = "Our printers";
      t.cover.author = "Support";
      t.cover.rich = { title: { type: "doc", content: [] } };
      t.logo = "m-logo.png";
      t.cover.image = "m-bg.png";
    });
    const blank = applyTemplate(doc, BLANK);
    expect(blank.blocks).toBe(doc.blocks);
    const t = templateOf(blank);
    expect(t.id).toBe("blank");
    expect(t.cover).toMatchObject({ on: false, title: "Our printers", author: "Support", image: null });
    expect(t.cover.rich.title).toBeDefined();
    expect(t.logo).toBe("m-logo.png");
    // A template with words of its own brings them.
    const own = { ...BASIC, cover: { ...BASIC.cover, title: "Its own title" } };
    expect(templateOf(applyTemplate(blank, own)).cover.title).toBe("Its own title");
    expect(templateOf(applyTemplate(blank, own)).cover.author).toBe("Support");
  });
});

describe("a step without a number", () => {
  const doc = guide(3);
  doc.blocks[1] = { ...(doc.blocks[1] as StepBlock), numberHidden: true };
  const data: ExportData = { doc, steps, template: BASIC, pictures: new Map(), options: { cover: false, toc: true, numbers: true, descriptions: true }, lang: "en", rtl: false, words: { contents: "Contents", page: (n, of) => `${n}/${of}` }, date: "today" };
  it("is not counted: the next step takes the number", () => {
    expect([...stepNumbers(doc).values()]).toEqual([1, 2]);
    expect(tocEntries(data).map((e) => e.text)).toEqual(["1. Step 1", "Step 2", "2. Step 3"]);
    const html = chunks(data).filter((c) => c.kind === "step").map((c) => c.html);
    expect(html[1]).not.toContain("badge");
    expect(html[2]).toContain(">2</span>");
    const md = exportMarkdown(data, { steps: "list", frontMatter: false, image: () => null, stepWord: (n: number) => `Step ${n}` } as unknown as Parameters<typeof exportMarkdown>[1]);
    expect(md).toContain("1. Step 1\n\nStep 2\n\n2. Step 3");
  });
});

describe("the page flow", () => {
  const doc = guide(2);
  const intro: ContentBlock = { id: "intro", type: "content", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } };
  const data = (cover: boolean, toc: boolean): ExportData => ({ doc: { ...doc, blocks: [intro, ...doc.blocks] }, steps, template: BASIC, pictures: new Map(), options: { cover, toc, numbers: true, descriptions: true }, lang: "en", rtl: false, words: { contents: "Contents", page: (n, of) => `${n}/${of}` }, date: "today" });
  it("starts what follows the contents on a new page", () => {
    expect(chunks(data(true, true)).map((c) => [c.kind, !!c.breakBefore])).toEqual([["toc", false], ["content", true], ["step", false], ["step", false]]);
    expect(chunks(data(false, true)).map((c) => [c.kind, !!c.breakBefore])).toEqual([["title", false], ["toc", false], ["content", true], ["step", false], ["step", false]]);
    expect(chunks(data(true, false)).some((c) => c.breakBefore)).toBe(false);
  });
  it("gives long contents more pages, never a step beside them", () => {
    const units = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `toc-${i}`, html: "", height: 20 })),
      { id: "b-1", html: "", height: 100, breakBefore: true },
    ];
    const pages = fillPages(units, 250);
    expect(pages.map((p) => p.units.length)).toEqual([12, 12, 6, 1]);
    expect(pages[3].units[0].id).toBe("b-1");
  });
});

describe("zoom without a picture frame", () => {
  const doc = guide(1);
  const s = step(1);
  it("shows the area until it is zoomed, in the area's own shape", () => {
    const f = framing(s, first(doc), doc);
    expect(f).toMatchObject({ ratio: null, frame: null, view: [0, 0, 1000, 800] });
    expect(zoomPercent(f.now.w, f.range)).toBe(100);
    const closer = zoomFrame(f.now, 2, f.range);
    const zoomed = { ...first(doc), frame: closer };
    expect(shownRect(s, zoomed, doc).view).toEqual([250, 200, 500, 400]);
    expect(zoomFrame(f.now, 0.1, f.range).w).toBe(1000);
    expect(zoomFrame(f.now, 1000, f.range).w).toBe(125);
  });
  it("never leaves the area when it is dragged", () => {
    expect(areaSource({ cx: 0, cy: 0, w: 200 }, [100, 100, 400, 200])).toEqual([100, 100, 200, 100]);
    expect(areaSource({ cx: 9999, cy: 9999, w: 200 }, [100, 100, 400, 200])).toEqual([300, 200, 200, 100]);
    expect(areaSource({ cx: 0, cy: 0, w: 9999 }, [100, 100, 400, 200])).toEqual([100, 100, 400, 200]);
  });
  it("has a slider whose ends are the whole area and the closest zoom", () => {
    const { range } = framing(s, first(doc), doc);
    expect(sliderOf(range.widest, range)).toBe(0);
    expect(sliderOf(range.narrowest, range)).toBe(100);
    expect(widthAt(0, range)).toBe(1000);
    expect(widthAt(100, range)).toBe(125);
    expect(widthAt(sliderOf(500, range), range)).toBeGreaterThan(480);
  });
  it("keeps zooms of a picture and places in a frame apart, and works in a frame as before", () => {
    const own = { cx: 500, cy: 400, w: 500, own: true };
    const framed = changeTemplate(doc, (t) => (t.frame.ratio = "1:1"));
    // The zoom made without a frame is no place in the frame.
    expect(framing(s, { ...first(doc), frame: own }, framed).frame?.own).toBeUndefined();
    // A place in a frame is no zoom without one.
    expect(shownRect(s, { ...first(doc), frame: { cx: 100, cy: 100, w: 200 } }, doc).view).toEqual([0, 0, 1000, 800]);
    expect(framing(s, first(framed), framed).fit.w).toBe(1000);
    expect(materializeFrames(doc, steps)).toBe(doc);
  });
});

describe("the sidebar", () => {
  it("grows towards the guide when its inner edge is dragged, in both directions of writing", () => {
    expect(draggedWidth(300, 500, 460, false)).toBe(340);
    expect(draggedWidth(300, 500, 540, true)).toBe(340);
    expect(draggedWidth(300, 500, 2000, false)).toBe(PANEL_MIN);
    expect(draggedWidth(300, 500, -2000, false)).toBe(PANEL_MAX);
  });
  it("offers for several steps only what all of them can do", () => {
    const blocks = guide(2).blocks as StepBlock[];
    const map = new Map([[1, step(1)], [2, step(2, { kind: "type", click: null })]]);
    expect(stepOptions(blocks, map)).toEqual({ pictures: true, clicks: false, reset: false });
    expect(stepOptions(blocks.slice(0, 1), map)).toEqual({ pictures: true, clicks: true, reset: false });
    const edited = blocks.map((b) => ({ ...b, text: [{ t: "x" }] }));
    expect(stepOptions(edited, map).reset).toBe(true);
    expect(stepOptions([edited[0], { ...edited[1], masked: true }], map).reset).toBe(false);
    expect(stepOptions([], map)).toEqual({ pictures: false, clicks: false, reset: false });
    expect(stepOptions(blocks, new Map([[1, step(1, { image: "" })], [2, step(2)]])).pictures).toBe(false);
  });
  it("shows the first words of a block in the outline", () => {
    expect(firstWords({ type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "Before\nyou  start" }] }] })).toBe("Before you start");
    expect(firstWords("a".repeat(100))).toHaveLength(60);
  });
});

describe("the view stays where it was", () => {
  it("scrolls back by what moved", () => {
    expect(placeAfterChange(-46, 500, 0)).toEqual({ scroll: 454, spacer: 0 });
    expect(placeAfterChange(46, 500, 0)).toEqual({ scroll: 546, spacer: 0 });
  });
  it("adds room above the very top instead of jumping, and uses it up again", () => {
    expect(placeAfterChange(-46, 0, 0)).toEqual({ scroll: 0, spacer: 46 });
    expect(placeAfterChange(-46, 10, 0)).toEqual({ scroll: 0, spacer: 36 });
    expect(placeAfterChange(46, 0, 46)).toEqual({ scroll: 0, spacer: 0 });
    expect(placeAfterChange(60, 0, 46)).toEqual({ scroll: 14, spacer: 0 });
  });
});
