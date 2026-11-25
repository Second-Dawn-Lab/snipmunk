// 7.5-C4: the paged canvas, the pages it shares with print and PDF, and the designs of the cover and the contents.
import { strFromU8, unzipSync } from "fflate";
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import type { GuideStep } from "../ipc";
import { anchorsOf, columnHeight, gapHeights, SHEET_GAP, sheetCount, sheetOf, textTop } from "./canvas";
import { exportDocx } from "./export/docx";
import { solidPng } from "./export/docxCover";
import { coverHtml, pmToHtml, tableWidth, tocEntries, tocHtml, type ExportData, type PmNode } from "./export/html";
import { assemble, bodyHtml, fillPages, pageBox, pageRoom, rowGroups, type Layout, type Measured } from "./export/paginate";
import { createDocument, type ContentBlock, type GuideDoc } from "./model";
import { markPosition } from "./pageGaps";
import { ART_KEY, BACKGROUND_KEY } from "./template/background";
import { canvasCss, documentCss } from "./template/css";
import { BASIC, COVER_DESIGNS, TOC_STYLES, coverPlace, normalizeTemplate, type Template } from "./template/model";
import { pageScale, PAGE_ROOM } from "./view";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const defaults = { marker: BASIC.marker, badge: "circle" as const, picture: "screen" as const, keepFull: false, zoomDefault: false };
const step = (n: number): GuideStep => ({ n, kind: "click", t: 0, image: `s${n}.png`, imageSize: [800, 600], click: [1, 1], text: [{ t: `Step ${n}` }] }) as unknown as GuideStep;
const steps = new Map([1, 2].map((n) => [n, step(n)]));
const look = (change: (t: Template) => void): Template => {
  const t = JSON.parse(JSON.stringify(BASIC)) as Template;
  change(t);
  return normalizeTemplate(t);
};
const data = (template: Template, doc: GuideDoc = createDocument("Printer", 1, [step(1), step(2)], defaults), more: Partial<ExportData> = {}): ExportData => ({
  doc: { ...doc, template },
  steps,
  template,
  pictures: new Map(),
  options: { cover: template.cover.on, toc: template.contents, numbers: true, descriptions: true },
  lang: "en",
  rtl: false,
  words: { contents: "Contents", page: (n, of) => `Page ${n} of ${of}` },
  date: "today",
  ...more,
});
const piece = (id: string, block: string, html: string, more: Partial<Measured & { scale: number }> = {}): Measured & { scale: number } => ({ id, block, child: 0, row: 0, html, height: 100, scale: 1, ...more });

describe("the pages of the canvas", () => {
  it("puts every page's first element at the head of its sheet, whatever stands there now", () => {
    const s = sheetOf(pageBox({ template: look((t) => (t.header.left = "title")) }));
    expect(s.width).toBeCloseTo((210 * 96) / 25.4);
    expect(textTop(s, 0)).toBeCloseTo(s.margin + s.head);
    expect(textTop(s, 2) - textTop(s, 1)).toBeCloseTo(s.height + SHEET_GAP);
    expect(columnHeight(s, 3)).toBeCloseTo(3 * s.height + 2 * SHEET_GAP);
    // Three page starts: one gap too small, one right, one too large. Changing a gap moves what follows it.
    const items = [
      { target: 100, top: 40, old: 0 },
      { target: 1000, top: 940, old: 20 },
      { target: 2000, top: 2040, old: 150 },
    ];
    const gaps = gapHeights(items);
    expect(gaps).toEqual([60, 20, 50]);
    let moved = 0;
    items.forEach((it, i) => {
      moved += gaps[i] - it.old;
      expect(it.top + moved).toBe(it.target);
    });
    // What already reaches past its page start is not pulled up over what stands before it.
    expect(gapHeights([{ target: 100, top: 180, old: 0 }])).toEqual([0]);
  });
  it("names what begins each page after the cover, and counts the sheets", () => {
    const layout: Layout = {
      box: pageBox({ template: BASIC }),
      cover: 1,
      pages: [{ units: [piece("toc", "toc", "")] }, { units: [piece("b-x.r4", "x", "<tr></tr>", { child: 2, row: 4, lead: 7 })] }],
      where: new Map(),
    };
    expect(anchorsOf(layout)).toEqual([
      { block: "toc", child: 0, row: 0, sheet: 1, lead: 0 },
      { block: "x", child: 2, row: 4, sheet: 2, lead: 7 },
    ]);
    expect(sheetCount(layout)).toBe(3);
    expect(sheetCount({ ...layout, cover: 0, pages: [] })).toBe(1);
  });
  it("sizes the page as chosen: as it is, to the width, whole, or by the percentage", () => {
    const sheet = { w: 800, h: 1100 };
    const room = { w: 700, h: 600 };
    expect(pageScale("auto", 150, room, sheet)).toBeCloseTo((700 - PAGE_ROOM) / 800);
    expect(pageScale("auto", 150, { w: 2000, h: 600 }, sheet)).toBe(1);
    expect(pageScale("width", 100, { w: 1200, h: 600 }, sheet)).toBeCloseTo((1200 - PAGE_ROOM) / 800);
    expect(pageScale("page", 100, room, sheet)).toBeCloseTo((600 - PAGE_ROOM) / 1100);
    expect(pageScale("none", 150, room, sheet)).toBe(1.5);
    expect(pageScale("none", 500, room, sheet)).toBe(2);
  });
  it("finds the paragraph or table row a page begins before", () => {
    const schema = new Schema({ nodes: { doc: { content: "block+" }, text: {}, paragraph: { group: "block", content: "text*" }, table: { group: "block", content: "tableRow+" }, tableRow: { content: "paragraph+" } } });
    const p = (text: string) => schema.node("paragraph", null, [schema.text(text)]);
    const doc = schema.node("doc", null, [p("ab"), schema.node("table", null, [schema.node("tableRow", null, [p("c")]), schema.node("tableRow", null, [p("d")])])]);
    expect(markPosition(doc, 0, 0)).toBe(0);
    expect(markPosition(doc, 1, 0)).toBe(4);
    expect(markPosition(doc, 1, 1)).toBe(4 + 1 + doc.child(1).child(0).nodeSize);
    expect(markPosition(doc, 2, 0)).toBeNull();
    expect(markPosition(doc, 0, 1)).toBeNull();
    expect(markPosition(doc, 1, 5)).toBeNull();
  });
});

describe("pages shared by the canvas, print and PDF", () => {
  it("keeps rows that a cell spans together", () => {
    const row = (...spans: number[]) => ({ children: spans.map((s) => ({ getAttribute: () => (s > 1 ? String(s) : null) })) }) as unknown as Element;
    const rows = [row(1, 1), row(3, 1), row(1), row(1), row(1, 1)];
    expect(rowGroups(rows).map((g) => g.length)).toEqual([1, 3, 1]);
  });
  it("makes room for a repeated header row on the page a table goes on to", () => {
    const units = [{ id: "head", html: "", height: 30, keepNext: true }, ...Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, html: "", height: 30, cont: 35 }))];
    expect(fillPages(units, 125).map((p) => p.units.map((u) => u.id).join())).toEqual(["head,r0,r1,r2", "r3,r4,r5"]);
    // Without the room for the header the second page would take one row more.
    expect(fillPages(units, 100).map((p) => p.units.length)).toEqual([3, 2, 2]);
  });
  const table = { open: '<table style="width:100%"><colgroup><col></colgroup><tbody>', head: "", rows: 1 };
  it("puts the rows of a page back under their table, with the header row again", () => {
    const head = "<tr><th>H</th></tr>";
    const first = [piece("t", "x", head, { table }), piece("t.r1", "x", "<tr><td>1</td></tr>", { row: 1, table: { ...table, head } })];
    const next = [piece("t.r2", "x", "<tr><td>2</td></tr>", { row: 2, table: { ...table, head } }), piece("p", "x", '<div class="content"><p>after</p></div>', { child: 1 })];
    expect(bodyHtml(first, 600).match(/<th>/g)).toHaveLength(1);
    expect(bodyHtml(first, 600).match(/<table/g)).toHaveLength(1);
    expect(bodyHtml(next, 600)).toContain("<tbody><tr><th>H</th></tr><tr><td>2</td></tr></tbody></table>");
    expect(bodyHtml(next, 600)).toContain("<p>after</p>");
  });
  it("shrinks what is higher than a page without laying it out wider", () => {
    expect(bodyHtml([piece("b-1", "1", "<section></section>", { scale: 0.5 })], 600)).toContain("zoom:0.5000;width:600px;margin-inline:auto");
  });
  it("gives every page after the cover the header, the footer, page numbers and the background, as chosen", () => {
    for (const [apply, onCover, onPages] of [["cover", true, false], ["all", true, true], ["notCover", false, true]] as const) {
      const t = look((x) => {
        x.cover.on = true;
        x.cover.image = "m-bg.png";
        x.background.apply = apply;
        x.header = { left: "title", center: "none", right: "text", texts: { left: "", center: "", right: "Internal" } };
        x.footer = { left: "date", center: "none", right: "page", texts: { left: "", center: "", right: "" } };
      });
      const d = data(t, undefined, { pictures: new Map([[BACKGROUND_KEY, { src: PNG, width: 1, height: 1 }]]) });
      const layout: Layout = { box: pageBox(d), cover: 1, pages: [{ units: [piece("b-a", "a", "<section>a</section>")] }, { units: [piece("b-b", "b", "<section>b</section>")] }], where: new Map() };
      const out = assemble(d, layout);
      expect(out.pages).toHaveLength(3);
      expect(out.contents).toEqual([[], ["b-a"], ["b-b"]]);
      expect(out.pages[0].includes("cover__bg bgimg")).toBe(onCover);
      expect(out.pages[0]).not.toContain("page__slot");
      out.pages.slice(1).forEach((p, i) => {
        expect(p.includes("page__bg bgimg")).toBe(onPages);
        expect(p.match(/page__slot/g)).toHaveLength(2);
        expect(p).toContain("Internal");
        expect(p).toContain(`Page ${i + 1} of 2`);
      });
    }
    expect(pageRoom(pageBox({ template: BASIC })).width).toBe(Math.floor(((210 - 32) * 96) / 25.4));
  });
  it("styles the canvas and the document by the same rules", () => {
    const t = look((x) => (x.steps.textScale = 1.5));
    for (const css of [canvasCss(t), documentCss(t)]) {
      expect(css).toContain("--tpl-step-size:16.5pt");
      expect(css).toContain(".step__head{display:flex;gap:10px;align-items:flex-start;font-size:var(--tpl-step-size)}");
    }
  });
});

describe("tables", () => {
  const table = (align: string, widths?: number[]): PmNode => ({ type: "table", attrs: { align }, content: [0, 1, 2].map(() => ({ type: "tableRow", content: [0, 1].map((i) => ({ type: "tableCell", ...(widths ? { attrs: { colwidth: [widths[i]] } } : {}), content: [{ type: "paragraph" }] })) })) });
  it("shows where it was placed: centred or at the end it is only as wide as its columns need", () => {
    expect(tableWidth([0, 0], "start")).toBe("100%");
    expect(tableWidth([0, 0], "center")).toBe("min(100%,320px)");
    expect(tableWidth([120, 0], "end")).toBe("min(100%,280px)");
    expect(tableWidth([120, 200], "start")).toBe("320px");
    expect(pmToHtml(table("center"), new Map())).toContain('<table style="width:min(100%,320px);margin-inline:auto;">');
    expect(pmToHtml(table("end", [100, 100]), new Map())).toContain('<table style="width:200px;margin-inline-start:auto;">');
    expect(pmToHtml(table("start"), new Map()).match(/<tr class="z">/g)).toHaveLength(1);
  });
});

describe("cover designs", () => {
  it("keep an older cover as it looked, and complete a new one", () => {
    const old = normalizeTemplate({ cover: { on: true, title: "T" } });
    expect(old.cover).toMatchObject({ design: "classic", align: "start", vertical: "auto" });
    expect(coverPlace(old.cover)).toEqual({ across: "start", down: "center" });
    expect(coverPlace(BASIC.cover)).toEqual({ across: "center", down: "center" });
    const odd = normalizeTemplate({ cover: { design: "nope", align: "left", logoSize: 9999, overlay: "x" }, toc: { style: "?", spacing: 9, size: -3 } });
    expect(odd.cover).toMatchObject({ design: "classic", align: "auto", logoSize: 240, overlay: "dark" });
    expect(odd.toc).toMatchObject({ style: "classic", spacing: 2.5, size: 0 });
  });
  it("write their design, their places and their picture into the page", () => {
    for (const design of COVER_DESIGNS) {
      const t = look((x) => Object.assign(x.cover, { on: true, design, image: "m-bg.png", logoPlace: "top", logoAlign: "start", logoSize: 60, dateAlign: "center", vertical: "bottom" }));
      const d = data({ ...t, logo: "m-logo.png" }, undefined, { pictures: new Map([[ART_KEY, { src: PNG, width: 1, height: 1 }], [BACKGROUND_KEY, { src: PNG, width: 1, height: 1 }], ["m-logo.png", { src: PNG, width: 3, height: 1 }]]) });
      const html = coverHtml(d);
      expect(html).toContain(`cover--${design} `);
      expect(html).toContain("cover--down-bottom");
      expect(html).toContain('class="cover__logo cover__logo--start cover__logo--top" style="height:60px"');
      expect(html).toContain("cover__text cover__date--center");
      const art = design === "image" || design === "split";
      expect(html.includes("cover__art artimg")).toBe(art);
      expect(html.includes("cover__bg bgimg")).toBe(!art);
    }
  });
  it("draw their blocks and pictures behind the text of the Word cover", async () => {
    expect(Array.from(solidPng("#FF0000").slice(0, 4))).toEqual([137, 80, 78, 71]);
    const drawings: Record<string, number> = {};
    for (const design of COVER_DESIGNS) {
      const t = look((x) => Object.assign(x.cover, { on: true, design, background: "#1F3A5F" }));
      const zip = unzipSync(Uint8Array.from(atob(await exportDocx(data(t), { pagePattern: "{n}/{of}" })), (c) => c.charCodeAt(0)));
      const header = Object.entries(zip).filter(([k]) => /word\/header\d*\.xml$/.test(k)).map(([, v]) => strFromU8(v)).join("");
      drawings[design] = header.match(/behindDoc="1"/g)?.length ?? 0;
    }
    // The cover colour, and each design's own block or picture area.
    expect(drawings).toEqual({ classic: 1, band: 2, banner: 2, image: 2, minimal: 1, split: 2 });
  });
});

describe("contents designs", () => {
  const intro: ContentBlock = { id: "intro", type: "content", doc: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Before" }] }] } };
  const doc = createDocument("G", 1, [step(1)], defaults);
  const guide = { ...doc, blocks: [intro, ...doc.blocks] };
  const where = new Map([["b-intro-0", 1], [`b-${doc.blocks[0].id}`, 2]]);
  it("writes the style, the leader, the title and the page numbers as chosen", () => {
    for (const style of TOC_STYLES) {
      const t = look((x) => Object.assign(x, { contents: true, toc: { ...x.toc, style, leader: "dashes", title: "Inside" } }));
      const html = tocHtml(data(t, guide), where);
      expect(html).toContain(`class="toc toc--${style} toc--lead-dashes"`);
      expect(html).toContain(">Inside</h2>");
      expect(html).toContain('<i class="toc__lead"></i><span class="toc__num">2</span>');
    }
    const follow = tocHtml(data(look((x) => (x.toc.right = false)), guide), where);
    expect(follow).toContain("toc--follow");
    expect(tocHtml(data(look((x) => (x.toc.numbers = false)), guide), where)).not.toContain("toc__num");
    expect(tocHtml(data(look(() => undefined), guide), where)).toContain(">Contents</h2>");
  });
  it("lists the steps, the headings, or both", () => {
    const list = (steps2: boolean, headings: boolean) => tocEntries(data(look((x) => Object.assign(x.toc, { steps: steps2, headings })), guide)).map((e) => e.text);
    expect(list(true, true)).toEqual(["Before", "1. Step 1"]);
    expect(list(false, true)).toEqual(["Before"]);
    expect(list(true, false)).toEqual(["1. Step 1"]);
    expect(tocHtml(data(look((x) => Object.assign(x.toc, { steps: false, headings: false })), guide), where)).toBe("");
  });
  it("becomes a contents field of Word with its switches and the styles of its entries", async () => {
    const word = async (change: (t: Template) => void) => {
      const t = look((x) => ((x.contents = true), change(x)));
      const zip = unzipSync(Uint8Array.from(atob(await exportDocx(data(t, guide), { pagePattern: "{n}/{of}" })), (c) => c.charCodeAt(0)));
      return { body: strFromU8(zip["word/document.xml"]), styles: strFromU8(zip["word/styles.xml"]) };
    };
    const full = await word((t) => Object.assign(t.toc, { title: "Inside", leader: "line" }));
    expect(full.body).toContain("Inside");
    expect(full.body).toMatch(/TOC [^<]*\\o &quot;1-2&quot;/);
    expect(full.styles).toContain('w:styleId="TOC1"');
    expect(full.styles).toContain('w:leader="underscore"');
    const bare = await word((t) => Object.assign(t.toc, { numbers: false, headings: false }));
    expect(bare.body).toMatch(/TOC [^<]*\\n/);
    expect(bare.body).not.toMatch(/TOC [^<]*\\o/);
    const follow = await word((t) => (t.toc.right = false));
    expect(follow.body).toMatch(/TOC [^<]*\\p &quot; &quot;/);
  });
});
