// 7.5-C2: header and footer places, the background picture, the cover as formatted in place, number colours and the area of
// steps recorded later.

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { GuideStep } from "../../ipc";
import { setCoverText, richWords } from "../CoverBlock";
import { createDocument, syncSteps, type PmDoc } from "../model";
import { BACKGROUND_KEY, backgroundBox, backgroundCss } from "../template/background";
import { applyTemplate, changeTemplate, templateOf } from "../template/apply";
import { templateVars } from "../template/css";
import { BASIC, normalizeTemplate, type Template } from "../template/model";
import { exportDocx } from "./docx";
import { coverHtml, exportHtml, type ExportData } from "./html";
import { slotHtml } from "./paginate";
import { base64Of } from "./run";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const defaults = { marker: { left: "#f00", right: "#00f", shape: "circle" as const, size: "medium" as const }, badge: "circle" as const, picture: "window" as const, keepFull: false, zoomDefault: false };
const step = (n: number): GuideStep => ({ n, kind: "click", t: 0, image: `s${n}.png`, imageSize: [800, 600], click: [10, 10], window: { rect: [10, 20, 300, 200], title: "", process: "" }, zoom: null, text: [{ t: `Step ${n}` }], deleted: false });
const rich = (text: string): PmDoc => ({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text, marks: [{ type: "textStyle", attrs: { color: "#d62828", fontSize: "32px" } }] }] }] });

function data(change: (t: Template) => void): ExportData {
  const template = normalizeTemplate(JSON.parse(JSON.stringify(BASIC)));
  template.cover.on = true;
  change(template);
  const doc = applyTemplate(createDocument("The guide", 1, [step(1)], defaults), template);
  const t = templateOf(doc);
  const img = { src: PNG, width: 400, height: 200 };
  const pictures = new Map([[doc.blocks[0].id, img]]);
  if (t.cover.image) pictures.set(BACKGROUND_KEY, img);
  return { doc, steps: new Map([[1, step(1)]]), template: t, pictures, options: { cover: true, toc: false, numbers: true, descriptions: true }, lang: "en", rtl: false, words: { contents: "Contents", page: (n, of) => `Page ${n} of ${of}` }, date: "25 November 2026" };
}
const xml = async (d: ExportData) => {
  const b64 = await exportDocx(d, { pagePattern: "Page {n} of {of}" });
  const files = unzipSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, k.endsWith(".xml") || k.endsWith(".rels") ? strFromU8(v) : base64Of(v)]));
};

describe("header and footer places", () => {
  const d = data((t) => {
    t.cover.title = "Cover title";
    t.cover.author = "Ada <A>";
    t.header = { left: "title", center: "text", right: "author", texts: { left: "", center: "Internal & private", right: "" } };
  });
  it("shows the cover title when there is one, own text and the author", () => {
    const h = d.template.header;
    expect(slotHtml(d, h, "left", 1, 2)).toContain("Cover title");
    expect(slotHtml(d, h, "center", 1, 2)).toContain("Internal &amp; private");
    expect(slotHtml(d, h, "right", 1, 2)).toContain("Ada &lt;A&gt;");
    expect(slotHtml(data(() => undefined), { ...h, left: "title" }, "left", 1, 1)).toContain("The guide");
  });
  it("has them in Word too", async () => {
    const files = await xml(d);
    const header = Object.entries(files).find(([k, v]) => /word\/header\d*\.xml$/.test(k) && v.includes("Cover title"))![1];
    expect(header).toContain("Internal &amp; private");
    expect(header).toContain("Ada &lt;A&gt;");
  });
  it("an unknown place of a newer file shows nothing", () => {
    expect(normalizeTemplate({ header: { left: "qr" } }).header.left).toBe("none");
  });
});

describe("the background picture", () => {
  it("places it the same way for the web and for Word", () => {
    const b = { ...BASIC.background, size: "fit" as const, x: "right" as const, y: "bottom" as const };
    // "Fit" (the whole picture) and "Fill" (the whole page) are centred, whatever position was chosen before.
    expect(backgroundCss(b, "data:x")).toContain("background-position:center center;background-size:contain");
    expect(backgroundCss({ ...b, size: "fill" }, "data:x")).toContain("background-position:center center;background-size:cover");
    expect(backgroundCss({ ...b, size: "custom", scale: 30 }, "data:x")).toContain("background-position:right bottom;background-size:30% auto");
    expect(backgroundBox(b, { w: 200, h: 300 }, { width: 400, height: 200 })).toEqual({ x: 0, y: 100, w: 200, h: 100 });
    expect(backgroundBox({ ...b, size: "fill" }, { w: 200, h: 300 }, { width: 400, height: 200 })).toEqual({ x: -200, y: 0, w: 600, h: 300 });
    expect(backgroundBox({ ...b, size: "custom", scale: 50, x: "center", y: "top" }, { w: 200, h: 300 }, { width: 400, height: 200 })).toEqual({ x: 50, y: 0, w: 100, h: 50 });
    expect(backgroundBox({ ...b, size: "original", x: "left", y: "top" }, { w: 200, h: 300 }, { width: 96, height: 96 }).w).toBeCloseTo(25.4);
  });
  const make = (apply: "cover" | "all" | "notCover") => data((t) => ((t.cover.image = "m-bg.png"), (t.background.apply = apply)));
  it("is on the cover, on every page or on all but the cover, as chosen", () => {
    expect(coverHtml(make("cover"))).toContain("cover__bg bgimg");
    expect(coverHtml(make("notCover"))).not.toContain("bgimg");
    expect(exportHtml(make("all"))).toContain("page__bg page__bg--fixed bgimg");
    expect(exportHtml(make("cover"))).not.toContain("page__bg--fixed bgimg");
    expect(exportHtml(make("all")).match(/background-image:url\(/g)).toHaveLength(1);
  });
  it("is a picture behind the text in the headers of the Word document", async () => {
    const headers = async (apply: "cover" | "all" | "notCover") => Object.entries(await xml(make(apply))).filter(([k, v]) => /word\/header\d*\.xml$/.test(k) && v.includes('behindDoc="1"')).length;
    expect(await headers("cover")).toBe(1);
    expect(await headers("notCover")).toBe(1);
    expect(await headers("all")).toBe(2);
  });
});

describe("the cover as written in place", () => {
  it("keeps the plain words and the look, in the editor's template, HTML and Word", async () => {
    let doc = applyTemplate(createDocument("G", 1, [], defaults), BASIC);
    doc = changeTemplate(doc, (t) => ((t.cover.on = true), setCoverText(t, "title", rich("Red title"))));
    expect(templateOf(doc).cover.title).toBe("Red title");
    expect(templateOf(doc).cover.rich.title).toEqual(rich("Red title"));
    const d = { ...data(() => undefined), doc, template: templateOf(doc) };
    expect(coverHtml(d)).toContain('<div class="cover__title"><p dir="auto" style="text-align:center"><span style="color:#d62828;font-size:32px">Red title</span></p></div>');
    expect((await xml(d))["word/document.xml"]).toContain('w:color w:val="D62828"');
    // Words without any look are only words.
    const words = (textAlign: string | null) => ({ type: "doc" as const, content: [{ type: "paragraph", attrs: { textAlign }, content: [{ type: "text", text: "Plain" }] }] });
    const plain = changeTemplate(doc, (t) => setCoverText(t, "title", words(null)));
    expect(templateOf(plain).cover.rich.title).toBeUndefined();
    // An alignment that was chosen is a look of its own, also "start" on a cover that centres its texts.
    expect(templateOf(changeTemplate(doc, (t) => setCoverText(t, "title", words("start")))).cover.rich.title).toBeDefined();
    expect(richWords(rich(" a "))).toBe("a");
  });
  it("shows the date of the day, or the date written", () => {
    expect(coverHtml(data(() => undefined))).toContain("25 November 2026");
    expect(coverHtml(data((t) => (t.cover.dateText = "Q4")))).toContain(">Q4<");
  });
});

describe("number colours", () => {
  it("follow the template until own colours are chosen", async () => {
    const plain = templateVars(BASIC);
    expect(plain["--tpl-badge"]).toBe("#A0522D");
    const own = normalizeTemplate({ steps: { badgeBg: "#00FF00", badgeText: "#112233" } });
    expect(templateVars(own)).toMatchObject({ "--tpl-badge": "#00FF00", "--tpl-badge-text": "#112233" });
    expect(normalizeTemplate({ steps: { badgeBg: "url(x)" } }).steps.badgeBg).toBeNull();
    const numbering = (await xml(data((t) => ((t.steps.badgeBg = "#00FF00"), (t.steps.badgeText = "#112233")))))["word/numbering.xml"];
    expect(numbering).toContain('w:fill="00FF00"');
    expect(numbering).toContain('w:val="112233"');
  });
});

describe("steps recorded later with another area", () => {
  it("show that area whatever the guide's pictures show", () => {
    const screen = createDocument("G", 1, [step(1)], { ...defaults, picture: "screen" });
    const added = syncSteps(screen, [step(1), step(2)], undefined, "region");
    expect(added.blocks[1]).toMatchObject({ n: 2, crop: [10, 20, 300, 200] });
    expect(syncSteps(screen, [step(1), step(2)]).blocks[1]).not.toHaveProperty("crop");
    const windows = createDocument("G", 1, [step(1)], defaults);
    expect(syncSteps(windows, [step(1), step(2)], undefined, "screen").blocks[1]).toMatchObject({ crop: [0, 0, 800, 600] });
    expect(syncSteps(windows, [step(1), step(2)], undefined, "active").blocks[1]).not.toHaveProperty("crop");
  });
});
