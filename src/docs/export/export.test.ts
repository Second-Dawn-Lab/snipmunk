import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { GuideStep } from "../../ipc";
import { createDocument, insertBlock, type ContentBlock, type GuideDoc, type StepBlock } from "../model";
import { BUILT_INS, normalizeTemplate } from "../template/model";
import { exportDocx, isRtlText } from "./docx";
import { chunks, clipboardHtml, exportHtml, imageKey, tocEntries, type ExportData } from "./html";
import { exportMarkdown } from "./markdown";
import { fillPages } from "./paginate";
import { base64Of, markdownFiles, readChoices, type Locale } from "./run";

/** A 1x1 PNG. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const defaults = { marker: { left: "#f00", right: "#00f", shape: "circle" as const, size: "medium" as const }, badge: "circle" as const, picture: "window" as const, keepFull: false, zoomDefault: false };
const step = (n: number, text: string): GuideStep => ({ n, kind: "click", t: 0, image: `s${n}.png`, imageSize: [800, 600], click: [10, 10], window: null, zoom: null, text: [{ t: "Click " }, { t: text, b: true }], deleted: false });
const ARABIC = "انقر فوق حفظ";
const link = "https://example.com/a (b)";

function sample(): ExportData {
  const steps = new Map<number, GuideStep>([
    [1, step(1, "Save")],
    [2, { ...step(2, ""), text: [{ t: ARABIC }] }],
    [3, step(3, "A*B <x>")],
  ]);
  let doc: GuideDoc = createDocument("My <guide>", 1, [...steps.values()], defaults);
  const content: ContentBlock = {
    id: "c1",
    type: "content",
    doc: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Before you start" }] },
        { type: "paragraph", content: [{ type: "text", text: "Read ", marks: [{ type: "bold" }] }, { type: "text", text: "this page", marks: [{ type: "link", attrs: { href: link } }] }, { type: "text", text: " bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
        { type: "image", attrs: { src: "http://snipmunk-img.localhost/x", file: "m-1.png", alt: "A diagram" } },
        {
          type: "table",
          attrs: { align: "center" },
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", attrs: { colwidth: [120] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Key" }] }] }, { type: "tableHeader", attrs: { colwidth: [200] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }] }] },
            { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a|b" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] }] },
          ],
        },
      ],
    },
  };
  doc = insertBlock(doc, 0, content);
  (doc.blocks[1] as StepBlock).desc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The description." }] }] };
  const template = normalizeTemplate({ ...BUILT_INS.find((x) => x.id === "corporate")!, logo: "m-logo.png" });
  doc = { ...doc, template };
  const img = { src: PNG, width: 800, height: 600 };
  const pictures = new Map([
    ...doc.blocks.filter((b) => b.type === "step").map((b) => [b.id, img] as const),
    [imageKey({ file: "m-1.png" }), img] as const,
    ["m-logo.png", { src: PNG, width: 100, height: 40 }] as const,
  ]);
  return { doc, steps, template, pictures, options: { cover: true, toc: true, numbers: true, descriptions: true }, lang: "en", rtl: false, words: { contents: "Contents", page: (n, of) => `Page ${n} of ${of}` }, date: "25 November 2026" };
}
const locale: Locale = { lang: "en", rtl: false, contents: "Contents", pagePattern: "Page {n} of {of}", stepPattern: "Step {n}", date: "25 November 2026" };

describe("HTML export", () => {
  const html = exportHtml(sample());
  it("is self-contained: embedded pictures, no outside address, no script", () => {
    expect(html.match(/<img [^>]*src="data:image\/png/g)).toHaveLength(5); // 3 steps, 1 inserted, the cover's logo
    expect(html).not.toMatch(/src="(?!data:)/);
    expect(html).not.toMatch(/<script|javascript:|@import|url\(\s*["']?https?:/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('href="https://example.com/a (b)"');
  });
  it("escapes the text, keeps bold parts, the table with its widths and the contents", () => {
    expect(html).toContain("<title>My &lt;guide&gt;</title>");
    expect(html).toContain("<strong>A*B &lt;x&gt;</strong>");
    expect(html).toContain('<col style="width:120px"><col style="width:200px">');
    expect(html).toContain('class="toc toc--classic toc--lead-dots"');
    expect(html).toContain('dir="auto"');
    expect(exportHtml({ ...sample(), rtl: true, lang: "ar" })).toContain('<html lang="ar" dir="rtl">');
    expect(tocEntries(sample()).map((e) => e.text)).toEqual(["Before you start", "1. Click Save", `2. ${ARABIC}`, "3. Click A*B <x>"]);
    expect(chunks(sample()).filter((c) => c.kind === "step")).toHaveLength(3);
  });
  it("makes a clipboard fragment with the pictures and a plain text", () => {
    const c = clipboardHtml(sample());
    expect(c.html.match(/<img /g)).toHaveLength(4);
    expect(c.text).toContain("1. Click Save");
    expect(c.text).toContain("The description.");
  });
});

describe("Markdown export", () => {
  it("links only to files that are written, converts tables, lists and links, and numbers the steps", () => {
    const { text, files } = markdownFiles(sample(), { mdSteps: "list", mdFrontMatter: true }, locale, "My guide_images");
    expect(files.map((f) => f.name).sort()).toEqual(["image-01.png", "step-01.png", "step-02.png", "step-03.png"]);
    const links = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => decodeURIComponent(m[1]));
    expect(links).toHaveLength(4);
    for (const l of links) expect(files.some((f) => `My guide_images/${f.name}` === l), l).toBe(true);
    expect(text).toMatch(/^---\ntitle: "My <guide>"/);
    expect(text).toContain("1. Click **Save**");
    expect(text).toContain("| Key | Value |\n| --- | --- |\n| a\\|b | 2 |");
    expect(text).toContain("- one");
    expect(text).toContain("[this page](https://example.com/a%20%28b%29)");
    expect(text).not.toContain("javascript:");
    expect(text).toContain("A\\*B \\<x\\>");
    const headings = exportMarkdown(sample(), { steps: "headings", frontMatter: false, stepWord: (n) => `Step ${n}`, image: () => null });
    expect(headings).toContain("## Step 2");
    expect(headings).not.toContain("![");
  });
});

describe("Word export", () => {
  it("is a real document: styles, numbered steps, pictures, a table, a contents field, header and footer, right-to-left text", async () => {
    const b64 = await exportDocx(sample(), { pagePattern: locale.pagePattern });
    const zip = unzipSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const xml = (name: string) => strFromU8(zip[name]);
    const body = xml("word/document.xml");
    expect(Object.keys(zip).filter((n) => n.startsWith("word/media/")).length).toBeGreaterThanOrEqual(1);
    expect(body.match(/<w:drawing>/g)!.length).toBe(5); // 3 steps, the inserted image, the logo on the cover
    expect(body).toContain('w:val="Heading1"');
    expect(body.match(/<w:pStyle w:val="Step"\/>/g)).toHaveLength(3);
    expect(body).toContain("<w:tbl>");
    expect(body).toContain("<w:tblHeader");
    expect(body).toMatch(/TOC [^<]*\\h/);
    expect(body).toContain("<w:hyperlink");
    expect(body).toContain("<w:bidi/>");
    expect(body).toContain("<w:rtl/>");
    expect(body).toContain(ARABIC);
    expect(body).not.toContain("javascript:");
    const styles = xml("word/styles.xml");
    for (const s of ["Title", "Heading1", "Heading2", "Heading3", "Step", "Description"]) expect(styles).toContain(`w:styleId="${s}"`);
    expect(xml("word/numbering.xml")).toContain("%1.");
    const parts = Object.keys(zip).filter((n) => /word\/(header|footer)\d*\.xml/.test(n)).map(xml).join("");
    expect(parts).toContain("PAGE");
    expect(parts).toContain("NUMPAGES");
    expect(parts).toContain("My &lt;guide&gt;");
    expect(xml("word/_rels/document.xml.rels")).toContain("https://example.com/a%20(b)".slice(0, 19));
  });
  it("tells right-to-left text by its first letter", () => {
    expect(isRtlText("12. " + ARABIC)).toBe(true);
    expect(isRtlText("Click حفظ")).toBe(false);
    expect(isRtlText("123 …")).toBeNull();
  });
});

describe("pages", () => {
  const unit = (id: string, height: number, extra = {}) => ({ id, html: id, height, ...extra });
  const ids = (p: ReturnType<typeof fillPages>) => p.map((x) => x.units.map((u) => u.id).join(","));
  it("never splits a unit, starts a page when the next does not fit, and scales one that is taller than a page", () => {
    expect(ids(fillPages([unit("a", 40), unit("b", 50), unit("c", 30), unit("d", 250), unit("e", 10)], 100))).toEqual(["a,b", "c", "d", "e"]);
    expect(fillPages([unit("d", 250)], 100)[0].units[0].scale).toBeCloseTo(0.4);
  });
  it("keeps a heading with what follows and honours one step per page", () => {
    expect(ids(fillPages([unit("a", 70), unit("h", 20, { keepNext: true }), unit("s", 60)], 100))).toEqual(["a", "h,s"]);
    expect(ids(fillPages([unit("a", 10), unit("b", 10, { breakBefore: true }), unit("c", 10, { breakBefore: true })], 100))).toEqual(["a", "b", "c"]);
  });
});

describe("choices", () => {
  it("are remembered, and anything unreadable falls back to the defaults", () => {
    expect(readChoices('{"format":"docx","toc":true,"jpeg":0.8,"nonsense":1}').format).toBe("docx");
    expect(readChoices('{"format":5}').format).toBe("pdf");
    expect(readChoices("{").format).toBe("pdf");
    expect(base64Of(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });
});
