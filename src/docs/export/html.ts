// The HTML of a guide (no React, no DOM): HTML export, "Copy as rich text", the page view and the pages of the PDF.

import type { GuideStep } from "../../ipc";
import type { Block, GuideDoc, Part, PmDoc, StepBlock } from "../model";
import { ART_KEY, BACKGROUND_KEY, artCss, backgroundCss, hasArt, onCover, onPages } from "../template/background";
import { documentCss } from "../template/css";
import { coverPlace, type CoverField, type Template } from "../template/model";

/** A picture as it goes into an export: already cropped, redactions burned in, marker and annotations drawn. */
export interface ExportImage {
  src: string;
  width: number;
  height: number;
  /** A step picture whose callouts or magnifiers reach beyond it: them alone, transparent, on a canvas that is wider by
   * `side` on both sides and higher by `top` and `bottom` (all as shares of the picture's width). */
  over?: { src: string; width: number; height: number; side: number; top: number; bottom: number };
  /** The same step as one picture of everything (for formats that cannot lay one picture over another). */
  whole?: { src: string; width: number; height: number };
}

/** The HTML of a step's picture: with what reaches beyond it laid over it, in room of its own. */
export function stepPictureHtml(pic: ExportImage, alt: string): string {
  const img = `<img class="step__pic" src="${pic.src}" width="${pic.width}" height="${pic.height}" alt="${esc(alt)}">`;
  const o = pic.over;
  if (!o) return img;
  const vars = `--out-side:${+o.side.toFixed(5)};--out-top:${+o.top.toFixed(5)};--out-bottom:${+o.bottom.toFixed(5)}`;
  return `<div class="step__fig" style="${vars}"><div class="step__shot">${img}<img class="step__over" src="${o.src}" width="${o.width}" height="${o.height}" alt=""></div></div>`;
}

export interface ExportOptions {
  cover: boolean;
  toc: boolean;
  numbers: boolean;
  descriptions: boolean;
}

export interface ExportData {
  doc: GuideDoc;
  steps: ReadonlyMap<number, GuideStep>;
  template: Template;
  /** Step pictures by block id; inserted images by file name (with the crop of the node already applied: `imageKey`). */
  pictures: ReadonlyMap<string, ExportImage>;
  options: ExportOptions;
  /** The language of the words an export adds ("Contents"), and the direction. */
  lang: string;
  rtl: boolean;
  words: { contents: string; page: (n: number, of: number) => string };
  /** The date of the export, already formatted. */
  date: string;
}

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only web and mail addresses (never script or file addresses). */
export const safeHref = (href: unknown): string | null => (typeof href === "string" && /^(https?:\/\/|mailto:|#)/i.test(href.trim()) ? href.trim() : null);

const safeCss = (v: unknown): string => (typeof v === "string" ? v.replace(/[;{}<>"\\]|url\s*\(/gi, "") : "");

/** The key of an inserted image in `pictures`: the file, and its crop when it has one. */
export const imageKey = (attrs: { file?: unknown; crop?: unknown }): string => `${String(attrs.file ?? "")}${Array.isArray(attrs.crop) ? `@${(attrs.crop as number[]).join(",")}` : ""}`;

type Node = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Node[] };

export function textToHtml(node: Node): string {
  let out = esc(node.text ?? "");
  for (const m of node.marks ?? []) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "underline") out = `<u>${out}</u>`;
    else if (m.type === "strike") out = `<s>${out}</s>`;
    else if (m.type === "code") out = `<code>${out}</code>`;
    else if (m.type === "link") {
      const href = safeHref(m.attrs?.href);
      if (href) out = `<a href="${esc(href)}">${out}</a>`;
    } else if (m.type === "highlight") {
      out = `<mark style="background:${safeCss(m.attrs?.color) || "#fff59d"}">${out}</mark>`;
    } else if (m.type === "textStyle") {
      const css = [
        m.attrs?.color ? `color:${safeCss(m.attrs.color)}` : "",
        m.attrs?.fontFamily ? `font-family:${safeCss(String(m.attrs.fontFamily).replace(/"/g, "'"))}` : "",
        m.attrs?.fontSize ? `font-size:${safeCss(m.attrs.fontSize)}` : "",
      ]
        .filter(Boolean)
        .join(";");
      if (css) out = `<span style="${css}">${out}</span>`;
    }
  }
  return out;
}

const align = (n: Node): string => {
  const a = n.attrs?.textAlign;
  return a === "center" || a === "end" || a === "start" ? ` style="text-align:${a}"` : "";
};

/** The width of every column of a table in pixels; 0 where none was set. */
export function columnWidths(table: Node): number[] {
  const first = table.content?.[0]?.content ?? [];
  const out = first.flatMap((c) => Array.from({ length: Number(c.attrs?.colspan) || 1 }, (_, i) => Number((c.attrs?.colwidth as number[] | undefined)?.[i]) || 0));
  return out.length ? out : [0];
}

/** How wide a column without a width of its own is in a table that is centred or at the end (such a table is not stretched). */
export const AUTO_COLUMN = 160;

/**
 * The CSS width of a table: its columns' widths added up when all are set; else the whole line, but a table that was centred or
 * moved to the end takes only the room its columns need, so that its place shows.
 */
export function tableWidth(widths: readonly number[], align: unknown): string {
  if (widths.length && widths.every((w) => w > 0)) return `${widths.reduce((a, b) => a + b, 0)}px`;
  if (align !== "center" && align !== "end") return "100%";
  return `min(100%,${widths.reduce((a, w) => a + (w || AUTO_COLUMN), 0)}px)`;
}

const plain = (n: Node): string => (n.text ?? "") + (n.content ?? []).map(plain).join("");

/** Rich text (ProseMirror JSON) as HTML; a node the exporter does not know shows its text. */
export function pmToHtml(node: Node, pictures: ReadonlyMap<string, ExportImage>): string {
  const kids = () => (node.content ?? []).map((c) => pmToHtml(c, pictures)).join("");
  switch (node.type) {
    case "doc":
      return kids();
    case "text":
      return textToHtml(node);
    case "hardBreak":
      return "<br>";
    case "paragraph":
      return `<p dir="auto"${align(node)}>${kids() || "<br>"}</p>`;
    case "heading": {
      const l = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
      return `<h${l} dir="auto"${align(node)}>${kids()}</h${l}>`;
    }
    case "bulletList":
      return `<ul>${kids()}</ul>`;
    case "orderedList":
      return `<ol start="${Number(node.attrs?.start) || 1}">${kids()}</ol>`;
    case "listItem":
      return `<li dir="auto">${kids()}</li>`;
    case "blockquote":
      return `<blockquote>${kids()}</blockquote>`;
    case "horizontalRule":
      return "<hr>";
    case "codeBlock":
      return `<pre dir="auto"><code>${esc(plain(node))}</code></pre>`;
    case "table": {
      const a = node.attrs?.align;
      const place = a === "center" ? "margin-inline:auto;" : a === "end" ? "margin-inline-start:auto;" : "";
      const widths = columnWidths(node);
      const cols = `<colgroup>${widths.map((w) => `<col${w > 0 ? ` style="width:${w}px"` : ""}>`).join("")}</colgroup>`;
      // Every other row is marked here: a table split over pages keeps its stripes.
      const rows = (node.content ?? []).map((r, i) => pmToHtml(r, pictures).replace(/^<tr/, i % 2 === 1 ? '<tr class="z"' : "<tr")).join("");
      return `<table style="width:${tableWidth(widths, a)};${place}">${cols}<tbody>${rows}</tbody></table>`;
    }
    case "tableRow":
      return `<tr>${kids()}</tr>`;
    case "tableCell":
    case "tableHeader": {
      const tag = node.type === "tableHeader" ? "th" : "td";
      const span = (k: string) => (Number(node.attrs?.[k]) > 1 ? ` ${k}="${Number(node.attrs?.[k])}"` : "");
      return `<${tag} dir="auto"${span("colspan")}${span("rowspan")}>${kids()}</${tag}>`;
    }
    case "image": {
      const img = pictures.get(imageKey(node.attrs ?? {}));
      if (!img) return "";
      const a = node.attrs ?? {};
      const full = a.align === "full";
      const width = full ? "100%" : a.width ? `${Number(a.width)}px` : `${img.width}px`;
      const side = a.align === "center" ? "center" : a.align === "end" ? "end" : "start";
      const height = a.height && !a.crop ? `height:${Number(a.height)}px;` : "height:auto;";
      const wide = full ? img.width : Number(a.width) || img.width;
      // (the two numbers give the browser the shape before the picture is read: a layout never waits for it)
      const high = a.height && !a.crop ? Number(a.height) : Math.max(1, Math.round((img.height * wide) / Math.max(1, img.width)));
      return `<p style="text-align:${side}"><img src="${img.src}" alt="${esc(String(a.alt ?? ""))}" width="${wide}" height="${high}" style="width:${width};max-width:100%;${height}"></p>`;
    }
    default:
      return kids();
  }
}

export const partsToHtml = (parts: readonly Part[]): string => parts.map((p) => (p.b ? `<strong>${esc(p.t)}</strong>` : esc(p.t))).join("");

/** One block of the document, as the pages are made of them. */
export interface Chunk {
  id: string;
  kind: "title" | "toc" | "step" | "content";
  html: string;
  /** The heading text of a table-of-contents entry. */
  entry?: string;
  /** A step that starts a new page (one step per page). */
  breakBefore?: boolean;
}

/** The headings and steps that the table of contents lists (as the template chooses them). */
export function tocEntries(d: Pick<ExportData, "doc" | "steps" | "options"> & { template?: Pick<Template, "toc"> }): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  const which = d.template?.toc ?? { steps: true, headings: true };
  let n = 0;
  for (const b of d.doc.blocks) {
    if (b.type === "step") {
      if (!b.numberHidden) n++;
      if (!which.steps) continue;
      const parts = b.text ?? d.steps.get(b.n)?.text ?? [];
      out.push({ id: `b-${b.id}`, text: `${d.options.numbers && !b.numberHidden ? `${n}. ` : ""}${parts.map((p) => p.t).join("")}`, level: 2 });
    } else if (which.headings) {
      ((b.doc as unknown as Node).content ?? []).forEach((c, i) => {
        if (c.type === "heading" && Number(c.attrs?.level) <= 2 && plain(c).trim()) out.push({ id: `b-${b.id}-${i}`, text: plain(c), level: Number(c.attrs?.level) || 1 });
      });
    }
  }
  return out;
}

/** The title of the table of contents: the template's own, else "Contents". */
export const tocTitle = (d: Pick<ExportData, "template" | "words">): string => d.template.toc.title.trim() || d.words.contents;

/** The table of contents; `numbers` are the pages of the entries (a document without pages has none). */
export function tocHtml(d: ExportData, numbers?: ReadonlyMap<string, number>): string {
  const look = d.template.toc;
  const items = tocEntries(d)
    .map((e) => {
      const page = look.numbers && numbers?.has(e.id) ? `<i class="toc__lead"></i><span class="toc__num">${numbers.get(e.id)}</span>` : "";
      return `<li class="toc__l${e.level}"><a href="#${e.id}" dir="auto">${esc(e.text)}</a>${page}</li>`;
    })
    .join("");
  if (!items) return "";
  return `<nav class="toc toc--${look.style} toc--lead-${look.leader}${look.right ? "" : " toc--follow"}"><h2 dir="auto">${esc(tocTitle(d))}</h2><ol>${items}</ol></nav>`;
}

export function stepChunk(d: ExportData, b: StepBlock, n: number): Chunk {
  const parts = b.text ?? d.steps.get(b.n)?.text ?? [];
  const pic = d.pictures.get(b.id);
  const badge = d.options.numbers && !b.numberHidden && d.template.steps.badge !== "none" && d.doc.badge !== "none" ? `<span class="badge badge--${d.doc.badge}">${n}</span>` : "";
  const desc = d.options.descriptions && b.desc ? pmToHtml(b.desc as unknown as Node, d.pictures) : "";
  const hasDesc = desc.replace(/<p[^>]*><br><\/p>/g, "").trim() !== "";
  const html =
    `<section class="step${pic ? " step--pic" : ""}" id="b-${b.id}">` +
    `<div class="step__head">${badge}<p dir="auto">${partsToHtml(parts)}</p></div>` +
    (pic ? stepPictureHtml(pic, parts.map((p) => p.t).join("")) : "") +
    (hasDesc ? `<div class="step__desc">${desc}</div>` : "") +
    `</section>`;
  return { id: `b-${b.id}`, kind: "step", html, breakBefore: d.template.steps.onePerPage };
}

/** The body of the document in blocks: title (without a cover), contents, then every block of the guide. */
export function chunks(d: ExportData, pageNumbers?: ReadonlyMap<string, number>): Chunk[] {
  const out: Chunk[] = [];
  if (!d.options.cover) out.push({ id: "title", kind: "title", html: `<h1 class="doc-title" dir="auto">${esc(d.doc.title)}</h1>` });
  if (d.options.toc) {
    const html = tocHtml(d, pageNumbers);
    if (html) out.push({ id: "toc", kind: "toc", html });
  }
  let n = 0;
  // The contents have their own pages: what follows them starts on a new one.
  let afterContents = out.some((c) => c.kind === "toc");
  for (const b of d.doc.blocks as Block[]) {
    if (b.type === "step") out.push(stepChunk(d, b, b.numberHidden ? n : ++n));
    else {
      const nodes = (b.doc as unknown as Node).content ?? [];
      const body = nodes
        .map((c, i) => {
          const html = pmToHtml(c, d.pictures);
          return c.type === "heading" ? html.replace(/^<h(\d)/, `<h$1 id="b-${b.id}-${i}"`) : html;
        })
        .join("");
      out.push({ id: `b-${b.id}`, kind: "content", html: `<div class="content" id="b-${b.id}">${body}</div>` });
    }
    if (afterContents) {
      out[out.length - 1].breakBefore = true;
      afterContents = false;
    }
  }
  return out;
}

/** The words of the cover title: its own, else the guide's. */
export const coverTitle = (d: Pick<ExportData, "template" | "doc">): string => d.template.cover.title || d.doc.title;

/** The layer with the background picture, on the cover or on a page (nothing when there is none for it). */
export const backgroundLayer = (d: ExportData, where: "cover" | "page"): string =>
  d.pictures.has(BACKGROUND_KEY) && (where === "cover" ? onCover(d.template.background) : onPages(d.template.background)) ? `<div class="${where === "cover" ? "cover__bg" : "page__bg"} bgimg"></div>` : "";

/** The classes of a text of the cover (the date may have a place of its own). */
export const coverTextClass = (c: Template["cover"], field: CoverField): string =>
  field === "title" ? "cover__title" : field === "dateText" && c.dateAlign !== "auto" ? `cover__text cover__date--${c.dateAlign}` : "cover__text";

/** One text of the cover: as it was formatted in place, else its plain words. */
function coverText(d: ExportData, field: CoverField, plainText: string): string {
  const c = d.template.cover;
  const rich = c.rich[field] as unknown as Node | undefined;
  const own = field === "dateText" && c.dateAlign !== "auto";
  // (a place chosen for the date wins over the alignment of its paragraph)
  const free = (n: Node): Node => (own ? { ...n, attrs: { ...n.attrs, textAlign: null }, content: n.content } : n);
  const cls = coverTextClass(c, field);
  if (rich && plain(rich).trim()) return `<div class="${cls}">${pmToHtml({ ...rich, content: rich.content?.map(free) }, d.pictures)}</div>`;
  if (!plainText) return "";
  const side = rich?.content?.[0] && !own ? align(rich.content[0]) : "";
  return `<div class="${cls}"><p dir="auto"${side}>${esc(plainText)}</p></div>`;
}

/** The classes of the cover: its design and where its group of texts stands. */
export function coverClass(c: Template["cover"]): string {
  const at = coverPlace(c);
  return `cover cover--${c.design} cover--across-${at.across} cover--down-${at.down}`;
}

/** The classes of the logo on the cover: where it stands and how it is aligned. */
export function coverLogoClass(c: Template["cover"]): string {
  const align2 = c.logoAlign !== "auto" ? c.logoAlign : c.logoPlace === "title" ? coverPlace(c).across : "end";
  return `cover__logo cover__logo--${align2} cover__logo--${c.logoPlace}`;
}

export function coverHtml(d: ExportData): string {
  const c = d.template.cover;
  const picture = c.logo && d.template.logo ? d.pictures.get(d.template.logo) : undefined;
  const logo = picture ? `<img class="${coverLogoClass(c)}" style="height:${c.logoSize}px" src="${picture.src}" alt="">` : "";
  // "image" and "split" show the picture as a part of the cover; the others may have it behind them.
  const art = hasArt(c.design) ? (d.pictures.has(ART_KEY) ? `<div class="cover__art artimg"></div>` : c.design === "split" ? `<div class="cover__art"></div>` : "") : backgroundLayer(d, "cover");
  return (
    `<header class="${coverClass(c)}">` +
    art +
    (c.logoPlace === "title" ? "" : logo) +
    `<div class="cover__group">` +
    (c.logoPlace === "title" ? logo : "") +
    coverText(d, "title", coverTitle(d)) +
    coverText(d, "subtitle", c.subtitle) +
    coverText(d, "author", c.author) +
    (c.date ? coverText(d, "dateText", c.dateText || d.date) : "") +
    `</div></header>`
  );
}

/** The rules of the background picture and of the cover's picture (their data stands once, however many pages show them). */
const backgroundRule = (d: ExportData): string => {
  const image = d.pictures.get(BACKGROUND_KEY);
  const art = d.pictures.get(ART_KEY);
  return `${image ? `.bgimg{${backgroundCss(d.template.background, image.src)}}` : ""}${art ? `.artimg{${artCss(art.src)}}` : ""}`;
};

export const htmlDocument = (d: ExportData, body: string, extraCss = ""): string =>
  `<!doctype html><html lang="${esc(d.lang)}" dir="${d.rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
  `<title>${esc(d.doc.title)}</title><style>${documentCss(d.template)}${backgroundRule(d)}${extraCss}</style></head><body>${body}</body></html>`;

/** One self-contained HTML file: pictures as data addresses, the template's CSS inline, no scripts, nothing from outside. */
export function exportHtml(d: ExportData): string {
  // (a layer that stays where it is while the page scrolls, as a page background would; the cover covers it)
  const behind = backgroundLayer(d, "page").replace('class="page__bg ', 'class="page__bg page__bg--fixed ');
  const body = `<main class="doc screen-doc">${behind}${d.options.cover ? coverHtml(d) : ""}${chunks(d)
    .map((c) => c.html)
    .join("")}</main>`;
  // Printed, the cover and the contents have pages of their own, as in the PDF.
  const page = `html,body{background:var(--tpl-bg)}body{background:${d.template.colors.background}}@media print{.screen-doc{padding:0;max-width:none}.screen-doc>.cover{break-after:page;min-height:96vh}.screen-doc>.toc{break-after:page}}`;
  return htmlDocument(d, body, page);
}

/** The fragment "Copy as rich text" puts on the clipboard: simple elements with inline styles that Word and Outlook keep. */
export function clipboardHtml(d: ExportData): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  let n = 0;
  for (const b of d.doc.blocks) {
    if (b.type === "step") {
      if (!b.numberHidden) n++;
      const parts = b.text ?? d.steps.get(b.n)?.text ?? [];
      const number = d.options.numbers && !b.numberHidden ? `${n}. ` : "";
      html.push(`<p dir="auto"><b>${number}</b>${partsToHtml(parts)}</p>`);
      text.push(`${number}${parts.map((p) => p.t).join("")}`);
      const found = d.pictures.get(b.id);
      const pic = found?.whole ?? found;
      if (pic) html.push(`<p><img src="${pic.src}" width="${Math.min(600, pic.width)}" height="${Math.round((pic.height * Math.min(600, pic.width)) / pic.width)}"></p>`);
      if (d.options.descriptions && b.desc) {
        html.push(pmToHtml(b.desc as unknown as Node, d.pictures));
        const t = plain(b.desc as unknown as Node).trim();
        if (t) text.push(t);
      }
    } else {
      html.push(pmToHtml(b.doc as unknown as Node, d.pictures));
      for (const c of (b.doc as unknown as Node).content ?? []) {
        const t = plain(c).trim();
        if (t) text.push(t);
      }
    }
  }
  return { html: `<div dir="${d.rtl ? "rtl" : "ltr"}">${html.join("")}</div>`, text: text.join("\n") };
}

export const pmDoc = (d: PmDoc): Node => d as unknown as Node;
export type { Node as PmNode };
