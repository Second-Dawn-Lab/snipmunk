// A guide as a real, editable Word document (the `docx` library, MIT): Word styles from the template, a numbered list for the
// steps, a table of contents field, header and footer with page numbers, inline pictures, real tables, links, and right-to-left
// paragraphs for right-to-left text.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LeaderType,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  StyleLevel,
  TabStopType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalPositionRelativeFrom,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from "docx";
import { BACKGROUND_KEY, backgroundBox, onPages } from "../template/background";
import { SIDES, badgeColors, colorsOf, onColor, pageSize, roleColor, type Side, type Slots } from "../template/model";
import { wordCover } from "./docxCover";
import { coverTitle, imageKey, safeHref, tocTitle, type ExportData, type ExportImage, type PmNode } from "./html";

/** Twips (1/1440 inch) of millimetres, and of screen pixels. */
const mm = (v: number) => Math.round((v * 1440) / 25.4);
const pxTwips = (px: number) => Math.round(px * 15);
const color = (c: string | undefined): string | undefined => {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? "").trim());
  if (m) return m[1].toUpperCase();
  const r = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c ?? "");
  return r ? [r[1], r[2], r[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
};

/** Does a text start with a right-to-left letter (Hebrew, Arabic and their extensions)? Digits and punctuation do not count. */
export function isRtlText(text: string): boolean | null {
  for (const ch of text) {
    if (/[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(ch)) return true;
    if (/\p{L}/u.test(ch)) return false;
  }
  return null;
}

const bytes = (dataUrl: string): Uint8Array => {
  const s = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const plain = (n: PmNode): string => (n.text ?? "") + (n.content ?? []).map(plain).join("");

export interface DocxWords {
  /** "Page {n} of {of}", with the two placeholders. */
  pagePattern: string;
}

export function docxDocument(d: ExportData, words2: DocxWords): Document {
  const t = d.template;
  const c = colorsOf(t);
  const size = pageSize(t) ?? { w: 210, h: 297 };
  const margin = Math.max(8, t.page.margin);
  /** The width of the text area in screen pixels. */
  const textPx = Math.floor(((size.w - 2 * margin) / 25.4) * 96);
  const rtlOf = (text: string) => isRtlText(text) ?? d.rtl;

  const picture = (img: ExportImage, wanted: number, alt: string) => {
    const w = Math.max(8, Math.min(textPx, Math.round(wanted)));
    const h = Math.max(8, Math.round((img.height * w) / img.width));
    return new ImageRun({
      type: img.src.startsWith("data:image/jpeg") ? "jpg" : "png",
      data: bytes(img.src),
      transformation: { width: w, height: h },
      altText: { title: alt, description: alt, name: alt || "picture" },
    });
  };

  /** What a text of the cover adds: its ink, and the place of its paragraph. */
  type Look = { ink: string; extra: (n: PmNode) => object };
  const run = (node: PmNode, rtl: boolean, bold = false, ink?: string): ParagraphChild => {
    const marks = node.marks ?? [];
    const has = (m: string) => marks.some((x) => x.type === m);
    const style = marks.find((m) => m.type === "textStyle")?.attrs ?? {};
    const mark = marks.find((m) => m.type === "highlight");
    const link = safeHref(marks.find((m) => m.type === "link")?.attrs?.href);
    const px = parseFloat(String(style.fontSize ?? ""));
    const font = String(style.fontFamily ?? "").split(",")[0].replace(/["']/g, "").trim();
    const r = new TextRun({
      text: node.text ?? "",
      bold: bold || has("bold"),
      italics: has("italic"),
      underline: has("underline") ? {} : undefined,
      strike: has("strike"),
      color: color(style.color as string) ?? ink,
      font: font || undefined,
      size: Number.isFinite(px) ? Math.round(px * 1.5) : undefined,
      shading: mark ? { type: ShadingType.CLEAR, fill: color(mark.attrs?.color as string) ?? "FFF59D", color: "auto" } : undefined,
      style: link ? "Hyperlink" : undefined,
      rightToLeft: rtl,
    });
    return link && !link.startsWith("#") ? new ExternalHyperlink({ link, children: [r] }) : r;
  };

  const runs = (node: PmNode, rtl: boolean, bold = false, ink?: string): ParagraphChild[] =>
    (node.content ?? []).map((x) => (x.type === "hardBreak" ? new TextRun({ break: 1 }) : x.type === "text" ? run(x, rtl, bold, ink) : new TextRun({ text: plain(x), rightToLeft: rtl })));

  const align = (n: PmNode) => {
    const a = n.attrs?.textAlign;
    return a === "center" ? AlignmentType.CENTER : a === "end" ? AlignmentType.END : undefined;
  };

  let lists = 0;
  const block = (node: PmNode, style?: string, list?: { reference: string; level: number; instance: number }, look?: Look): FileChild[] => {
    const rtl = rtlOf(plain(node));
    switch (node.type) {
      case "paragraph":
        return [new Paragraph({ children: runs(node, rtl, false, look?.ink), style, bidirectional: rtl, alignment: align(node), numbering: list, ...look?.extra(node) })];
      case "heading": {
        const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(2, Math.max(0, (Number(node.attrs?.level) || 1) - 1))];
        return [new Paragraph({ children: runs(node, rtl), heading: level, bidirectional: rtl, alignment: align(node) })];
      }
      case "bulletList":
      case "orderedList": {
        const reference = node.type === "bulletList" ? "bullets" : "ordered";
        const level = list ? Math.min(3, list.level + 1) : 0;
        const instance = ++lists;
        return (node.content ?? []).flatMap((li) =>
          (li.content ?? []).flatMap((child, i) => block(child, style, child.type === "paragraph" && i > 0 ? undefined : { reference, level, instance })),
        );
      }
      case "table":
        return [table(node), new Paragraph({})];
      case "image": {
        const img = d.pictures.get(imageKey(node.attrs ?? {}));
        if (!img) return [];
        const a = node.attrs ?? {};
        const width = a.align === "full" ? textPx : Number(a.width) || img.width;
        const place = a.align === "center" ? AlignmentType.CENTER : a.align === "end" ? AlignmentType.END : undefined;
        return [new Paragraph({ children: [picture(img, width, String(a.alt ?? ""))], alignment: place, bidirectional: d.rtl })];
      }
      default:
        return (node.content ?? []).flatMap((x) => block(x, style, list));
    }
  };

  const border = t.table.borders ? { style: BorderStyle.SINGLE, size: 4, color: "A0A6AD" } : { style: BorderStyle.NONE, size: 0, color: "auto" };
  const table = (node: PmNode): Table => {
    const rows = node.content ?? [];
    const first = rows[0]?.content ?? [];
    const spans = first.flatMap((cell) => {
      const n = Number(cell.attrs?.colspan) || 1;
      const w = (cell.attrs?.colwidth as number[] | undefined) ?? [];
      return Array.from({ length: n }, (_, i) => w[i] ?? 0);
    });
    const count = Math.max(1, spans.length);
    const given = spans.reduce((a, b) => a + b, 0);
    const free = spans.filter((w) => !w).length;
    const rest = free ? Math.max(40, (textPx - given) / free) : 0;
    let widths = spans.map((w) => w || rest);
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > textPx) widths = widths.map((w) => (w * textPx) / total);
    if (widths.length === 0) widths = [textPx];
    const columnWidths = widths.map(pxTwips);
    const al = node.attrs?.align;
    return new Table({
      columnWidths,
      width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      alignment: al === "center" ? AlignmentType.CENTER : al === "end" ? AlignmentType.END : undefined,
      visuallyRightToLeft: d.rtl,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: rows.map((row, ri) => {
        const header = (row.content ?? []).every((x) => x.type === "tableHeader");
        let col = 0;
        return new TableRow({
          tableHeader: header && ri === 0,
          children: (row.content ?? []).map((cell) => {
            const span = Number(cell.attrs?.colspan) || 1;
            const w = columnWidths.slice(col, col + span).reduce((a, b) => a + b, 0) || columnWidths[count - 1];
            col += span;
            const fill = cell.type === "tableHeader" && t.table.header !== "none" ? color(t.table.header === "main" ? c.main : c.light) : t.table.zebra && ri % 2 === 1 ? color(c.light) : undefined;
            const content = (cell.content ?? []).flatMap((x) => (cell.type === "tableHeader" && t.table.header === "main" ? block(x, "TableHeading") : block(x)));
            return new TableCell({
              columnSpan: span > 1 ? span : undefined,
              rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
              width: { size: w, type: WidthType.DXA },
              shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: content.length ? (content as (Paragraph | Table)[]) : [new Paragraph({})],
            });
          }),
        });
      }),
    });
  };

  // --- the body ---------------------------------------------------------------------------------------------------------------
  const body: FileChild[] = [];
  const logo = t.logo ? d.pictures.get(t.logo) : undefined;
  const line = (text: string, style: string, alignment?: ReturnType<typeof align>) => new Paragraph({ style, alignment, bidirectional: rtlOf(text), children: [new TextRun({ text, rightToLeft: rtlOf(text) })] });
  const cover = d.options.cover ? wordCover(d, size, margin, { rich: (nodes, style, ink, extra) => nodes.flatMap((x) => block(x, style, undefined, { ink, extra })), rtlOf }) : null;
  if (cover) body.push(...cover.body);
  else body.push(line(d.doc.title, "Title"));
  let breakNext = d.options.cover;
  const toc = t.toc;
  const leader = { dots: LeaderType.DOT, dashes: LeaderType.HYPHEN, line: LeaderType.UNDERSCORE, none: LeaderType.NONE }[toc.leader];
  if (d.options.toc) {
    const title = tocTitle(d);
    body.push(new Paragraph({ style: "TocHeading", pageBreakBefore: breakNext, bidirectional: rtlOf(title), children: [new TextRun({ text: title, rightToLeft: rtlOf(title) })] }));
    // A real contents field: Word fills it (and its page numbers) from the headings and the steps.
    body.push(
      new TableOfContents(title, {
        hyperlink: true,
        ...(toc.headings ? { headingStyleRange: "1-2" } : {}),
        ...(toc.steps ? { stylesWithLevels: [new StyleLevel("Step", 2)] } : {}),
        ...(toc.numbers ? {} : { pageNumbersEntryLevelsRange: "1-9" }),
        ...(toc.numbers && !toc.right ? { entryAndPageNumberSeparator: " " } : {}),
        tabLeader: toc.numbers && toc.right ? leader : LeaderType.NONE,
      }),
    );
    breakNext = true;
  }
  if (breakNext) body.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 } }));

  let n = 0;
  for (const b of d.doc.blocks) {
    if (b.type !== "step") {
      body.push(...((b.doc as unknown as PmNode).content ?? []).flatMap((x) => block(x)));
      continue;
    }
    n++;
    const parts = b.text ?? d.steps.get(b.n)?.text ?? [];
    const text = parts.map((p) => p.t).join("");
    const rtl = rtlOf(text);
    const img = d.pictures.get(b.id);
    body.push(
      new Paragraph({
        style: "Step",
        bidirectional: rtl,
        keepNext: !!img,
        keepLines: true,
        pageBreakBefore: t.steps.onePerPage && n > 1,
        numbering: d.options.numbers && !b.numberHidden && d.doc.badge !== "none" && t.steps.badge !== "none" ? { reference: "steps", level: 0 } : undefined,
        children: parts.map((p) => new TextRun({ text: p.t, bold: p.b, rightToLeft: rtl })),
      }),
    );
    const desc = d.options.descriptions && b.desc && plain(b.desc as unknown as PmNode).trim() !== "" ? b.desc : null;
    if (img) {
      body.push(
        new Paragraph({
          style: "Picture",
          alignment: AlignmentType.CENTER,
          keepNext: !!desc,
          // (with callouts around it, one picture of everything: the picture inside keeps its size while there is room)
          children: [picture(img.whole ?? img, (Math.min(img.width, (textPx * t.frame.maxWidth) / 100) * (img.whole?.width ?? img.width)) / img.width, text)],
        }),
      );
    }
    if (desc) body.push(...((desc as unknown as PmNode).content ?? []).flatMap((x) => block(x, "Description")));
  }

  // --- header and footer -------------------------------------------------------------------------------------------------------
  const slot = (slots: Slots, side: Side): ParagraphChild[] => {
    const s = slots[side];
    const words = (text: string) => (text ? [new TextRun({ text, rightToLeft: rtlOf(text) })] : []);
    if (s === "title") return words(coverTitle(d));
    if (s === "text") return words(slots.texts[side]);
    if (s === "author") return words(t.cover.author);
    if (s === "date") return words(d.date);
    if (s === "logo" && logo) return [picture(logo, Math.min(90, (logo.width * 34) / logo.height), "logo")];
    if (s === "page") {
      const pieces = words2.pagePattern.split(/(\{n\}|\{of\})/);
      return pieces.filter(Boolean).map((p) => new TextRun({ children: [p === "{n}" ? PageNumber.CURRENT : p === "{of}" ? PageNumber.TOTAL_PAGES : p], rightToLeft: d.rtl }));
    }
    return [];
  };
  const used = (s: Slots) => s.left !== "none" || s.center !== "none" || s.right !== "none";
  const bar = (s: Slots) =>
    new Paragraph({
      style: "HeaderFooter",
      bidirectional: d.rtl,
      tabStops: [
        { type: TabStopType.CENTER, position: mm((size.w - 2 * margin) / 2) },
        { type: TabStopType.RIGHT, position: mm(size.w - 2 * margin) },
      ],
      children: SIDES.flatMap((side, i) => [...(i ? [new TextRun("\t")] : []), ...slot(s, side)]),
    });
  // The background picture is a picture behind the text, placed on the page from the header.
  const behindImage = d.pictures.get(BACKGROUND_KEY);
  const behind = (): Paragraph => {
    const img = behindImage!;
    const box = backgroundBox(t.background, size, img);
    const px = (v: number) => Math.max(1, Math.round((v / 25.4) * 96));
    const emu = (v: number) => Math.round(v * 36000);
    return new Paragraph({
      spacing: { after: 0 },
      children: [
        new ImageRun({
          type: img.src.startsWith("data:image/jpeg") ? "jpg" : "png",
          data: bytes(img.src),
          transformation: { width: px(box.w), height: px(box.h) },
          altText: { title: "background", description: "background", name: "background" },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(box.x) },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(box.y) },
            behindDocument: true,
            allowOverlap: true,
            lockAnchor: true,
          },
        }),
      ],
    });
  };
  const pagesBehind = !!behindImage && onPages(t.background);
  const coverBehind = cover?.behind.length ? new Paragraph({ spacing: { after: 0 }, children: cover.behind }) : null;
  const headerParts = [...(pagesBehind ? [behind()] : []), ...(used(t.header) ? [bar(t.header)] : [])];

  const half = (pt: number) => Math.round(pt * 2);
  const head = t.fonts.heading;
  const dark = color(c.dark)!;
  const text = color(c.text)!;
  // (Word keeps a white page: on a dark template the headings and the text take their colours for a light page)
  const lightPage = c.background.toUpperCase() === "#FFFFFF";
  const ink = lightPage ? text : "1F2328";
  const headInk = lightPage ? dark : color(roleColor(t, "main"))!;
  const headMain = color(c.main)!;
  const style = (id: string, name: string, extra: object) => ({ id, name, basedOn: "Normal", next: "Normal", quickFormat: true, ...extra });
  const levels = (bullet: boolean) =>
    [0, 1, 2, 3].map((level) => ({
      level,
      format: bullet ? LevelFormat.BULLET : LevelFormat.DECIMAL,
      text: bullet ? ["•", "◦", "▪", "•"][level] : `%${level + 1}.`,
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 540 * (level + 1), hanging: 360 } } },
    }));

  return new Document({
    title: d.doc.title,
    features: { updateFields: d.options.toc },
    styles: {
      default: { document: { run: { font: t.fonts.body, size: half(t.fonts.size), color: ink }, paragraph: { spacing: { after: 100, line: 276, lineRule: "auto" } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: head, size: half(t.fonts.headingSize * 1.4), bold: true, color: headInk } },
        { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: head, size: half(t.fonts.headingSize), bold: true, color: headInk }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0, keepNext: true } },
        { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: head, size: half(t.fonts.headingSize * 0.76), bold: true, color: headInk }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1, keepNext: true } },
        { id: "Heading3", name: "heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: head, size: half(t.fonts.headingSize * 0.6), bold: true, color: headInk }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2, keepNext: true } },
        style("Subtitle", "Subtitle", { run: { size: half(t.fonts.size * 1.3) } }),
        style("TocHeading", "Contents Title", {
          run: {
            font: head,
            size: half(toc.style === "simple" ? t.fonts.size * 1.3 : t.fonts.headingSize * 0.76),
            bold: true,
            color: toc.style === "modern" ? headMain : toc.style === "classic" ? headInk : ink,
            allCaps: toc.style === "formal",
          },
          paragraph: {
            spacing: { after: 160 },
            ...(toc.style === "formal" ? { alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ink, space: 6 } } } : {}),
            ...(toc.style === "modern" ? { border: { start: { style: BorderStyle.SINGLE, size: 36, color: headMain, space: 8 } } } : {}),
          },
        }),
        // Word's own styles of a contents field's entries.
        ...[1, 2].map((level) => ({
          id: `TOC${level}`,
          name: `toc ${level}`,
          basedOn: "Normal",
          next: "Normal",
          run: { size: half(toc.size || t.fonts.size), bold: level === 1 && toc.style !== "simple", allCaps: level === 1 && toc.style === "formal", italics: level === 2 && toc.style === "formal" },
          paragraph: {
            spacing: { after: 0, line: Math.round(toc.spacing * 200), lineRule: "auto" as const },
            indent: { start: level === 1 || toc.style === "simple" ? 0 : mm(toc.style === "formal" ? 7 : 4.5) },
            tabStops: toc.numbers && toc.right ? [{ type: TabStopType.RIGHT, position: mm(size.w - 2 * margin), leader }] : [],
          },
        })),
        style("Step", "Step", { run: { size: half(t.fonts.size * t.steps.textScale) }, paragraph: { spacing: { before: pxTwips(t.steps.spacing), after: 100 }, outlineLevel: 1 } }),
        style("Picture", "Step Picture", { paragraph: { spacing: { after: 100 } } }),
        style("Description", "Step Description", { run: { color: t.steps.description === "muted" ? "5F6670" : ink }, paragraph: t.steps.description === "boxed" ? { shading: { type: ShadingType.CLEAR, fill: color(c.light), color: "auto" } } : {} }),
        style("TableHeading", "Table Heading", { run: { bold: true, color: color(onColor(c.main)) } }),
        style("HeaderFooter", "Header and Footer", { run: { size: 17, color: "5F6670" }, paragraph: { spacing: { after: 0 } } }),
      ],
    },
    numbering: {
      config: [
        {
          reference: "steps",
          // (a number of its own colours stands on a filled box, as the badge does)
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                run:
                  t.steps.badgeBg || t.steps.badgeText
                    ? { bold: true, color: color(badgeColors(t).text), shading: { type: ShadingType.CLEAR, fill: color(badgeColors(t).fill), color: "auto" } }
                    : { bold: true, color: color(roleColor(t, t.steps.badgeColor)) },
                paragraph: { indent: { left: 540, hanging: 540 } },
              },
            },
          ],
        },
        { reference: "bullets", levels: levels(true) },
        { reference: "ordered", levels: levels(false) },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: d.options.cover,
          page: {
            // (the library swaps the sides itself for landscape)
            size: { width: mm(Math.min(size.w, size.h)), height: mm(Math.max(size.w, size.h)), orientation: size.w > size.h ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: mm(margin), bottom: mm(margin), left: mm(margin), right: mm(margin), header: mm(margin / 2), footer: mm(margin / 2) },
          },
        },
        headers: headerParts.length || coverBehind ? { ...(headerParts.length ? { default: new Header({ children: headerParts }) } : {}), ...(coverBehind ? { first: new Header({ children: [coverBehind] }) } : {}) } : undefined,
        footers: used(t.footer) ? { default: new Footer({ children: [bar(t.footer)] }) } : undefined,
        children: body,
      },
    ],
  });
}

export const exportDocx = (d: ExportData, words: DocxWords): Promise<string> => Packer.toBase64String(docxDocument(d, words));
