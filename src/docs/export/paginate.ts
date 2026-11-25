// The pages of a guide: the editor's canvas, the print preview, printing and the PDF are all laid out here. The blocks are
// measured and filled into pages of the template's size, so a step (picture and text) is never split, a text block breaks between
// its paragraphs and table rows (a table's header row is repeated), and header, footer, page numbers and the page numbers of the
// contents are known. The cover has a page of its own, and so have the contents.

import { SIDES, pageSize, type Side, type Slots } from "../template/model";
import { backgroundLayer, chunks, coverHtml, coverTitle, esc, htmlDocument, tocEntries, type Chunk, type ExportData } from "./html";
import { createMeasurer, type Measurer, type Request } from "./measure";

export const PX_PER_MM = 96 / 25.4;
/** The room a header or a footer takes. */
export const SLOT_MM = 10;
/** A page is a hair shorter than its paper, so a printer never starts an empty one. */
export const PAGE_TRIM_MM = 0.3;

export interface PageBox {
  w: number;
  h: number;
  margin: number;
  header: boolean;
  footer: boolean;
}

export const pageBox = (d: Pick<ExportData, "template">): PageBox => {
  const t = d.template;
  // A "screen" template printed to PDF uses A4.
  const size = pageSize(t) ?? { w: 210, h: 297 };
  const used = (s: Slots) => s.left !== "none" || s.center !== "none" || s.right !== "none";
  return { ...size, margin: t.page.margin, header: used(t.header), footer: used(t.footer) };
};

/** The width of the text on a page, and the height a page has for blocks, in pixels. */
export const pageRoom = (box: PageBox): { width: number; room: number } => ({
  width: Math.floor((box.w - 2 * box.margin) * PX_PER_MM),
  room: Math.floor((box.h - 2 * box.margin - (box.header ? SLOT_MM : 0) - (box.footer ? SLOT_MM : 0)) * PX_PER_MM) - 2,
});

export interface Unit {
  id: string;
  html: string;
  height: number;
  breakBefore?: boolean;
  /** A heading stays with what follows it. */
  keepNext?: boolean;
  /** What a unit adds at the head of a page when it begins one (the repeated header row of a table). */
  cont?: number;
  /** For a table that goes on: the room between the head of the page and its first row. */
  lead?: number;
}

/**
 * Fill units into pages of `room` pixels, in order. A unit is never split: one that is taller than a page gets a page of its own and
 * is scaled down to fit it. A heading is moved to the next page when what follows it does not fit under it.
 */
export function fillPages<U extends Unit>(units: readonly U[], room: number): { units: (U & { scale: number })[] }[] {
  const pages: { units: (U & { scale: number })[]; used: number }[] = [];
  let page: (typeof pages)[number] | null = null;
  units.forEach((u, i) => {
    const scale = u.height > room ? room / u.height : 1;
    const h = u.height * scale;
    const need = u.keepNext && units[i + 1] ? h + Math.min(units[i + 1].height, room - h) : h;
    if (!page || (u.breakBefore && page.units.length > 0) || (page.used + need > room + 0.5 && page.units.length > 0)) {
      page = { units: [], used: u.cont ?? 0 };
      pages.push(page);
    }
    page.units.push({ ...u, scale });
    page.used += h;
  });
  return pages.map((p) => ({ units: p.units }));
}

/** A piece that may go to a page of its own, and what it belongs to: a block of the guide (and which of its parts), the
 * contents or the title. */
export interface Piece {
  id: string;
  html: string;
  keepNext?: boolean;
  breakBefore?: boolean;
  block: string;
  child: number;
  /** The first row of the piece inside its table (0 otherwise). */
  row: number;
  /** A piece that is a group of rows of a table: the table it belongs to. */
  table?: { open: string; head: string; rows: number };
}

const CLOSE = "</tbody></table>";

/** The rows of a table in groups that a page break may not part (cells that span rows hold theirs together). */
export function rowGroups(rows: readonly Element[]): Element[][] {
  const out: Element[][] = [];
  let until = 0;
  rows.forEach((row, i) => {
    if (i >= until) out.push([]);
    out[out.length - 1].push(row);
    const span = Math.max(1, ...Array.from(row.children, (c) => Number(c.getAttribute("rowspan")) || 1));
    until = Math.max(until, i + span);
  });
  return out;
}

function tablePieces(el: Element, base: { id: string; block: string; child: number; breakBefore?: boolean }): Piece[] {
  const rows = Array.from(el.querySelector(":scope>tbody")?.children ?? []);
  const empty = el.cloneNode(true) as Element;
  empty.querySelector(":scope>tbody")?.replaceChildren();
  const open = empty.outerHTML.replace(/<\/tbody><\/table>$/, "");
  const groups = rowGroups(rows);
  // A first row of header cells only is repeated where the table goes on.
  const head = groups.length > 1 && groups[0].length === 1 && Array.from(groups[0][0].children).every((c) => c.tagName === "TH") ? groups[0][0].outerHTML : "";
  let row = 0;
  return groups.map((g, i) => {
    const piece: Piece = {
      id: i === 0 ? base.id : `${base.id}.r${row}`,
      html: g.map((r) => r.outerHTML).join(""),
      block: base.block,
      child: base.child,
      row,
      keepNext: i === 0 && !!head,
      breakBefore: i === 0 && base.breakBefore,
      table: { open, head: i === 0 ? "" : head, rows: g.length },
    };
    row += g.length;
    return piece;
  });
}

/** The pieces of a chunk: the top-level parts of a content block (a table by its rows), and the heading and every entry of the
 * contents. */
export function split(c: Chunk): Piece[] {
  const block = c.id.replace(/^b-/, "");
  if (c.kind === "step" || c.kind === "title") return [{ id: c.id, html: c.html, keepNext: c.kind === "title", breakBefore: c.breakBefore, block, child: 0, row: 0 }];
  const host = document.createElement("div");
  host.innerHTML = c.html;
  if (c.kind === "toc") {
    const look = host.firstElementChild?.className ?? "toc";
    const part = (inner: string) => `<nav class="${look} toc--part">${inner}</nav>`;
    const heading = host.querySelector("h2");
    return [
      { id: c.id, html: part(heading?.outerHTML ?? ""), keepNext: true, breakBefore: c.breakBefore, block, child: 0, row: 0 },
      ...Array.from(host.querySelectorAll("li")).map((li, i) => ({ id: `${c.id}-${i}`, html: part(`<ol>${li.outerHTML}</ol>`), block, child: i + 1, row: 0 })),
    ];
  }
  return Array.from(host.firstElementChild?.children ?? []).flatMap((el, i): Piece[] => {
    const id = el.id || (i === 0 ? c.id : `${c.id}+${i}`);
    const base = { id, block, child: i, breakBefore: i === 0 && c.breakBefore };
    if (el.tagName === "TABLE" && el.querySelector(":scope>tbody>tr")) return tablePieces(el, base);
    return [{ ...base, html: `<div class="content">${el.outerHTML}</div>`, keepNext: /^H[1-3]$/.test(el.tagName), row: 0 }];
  });
}

export type Measured = Piece & Unit;

/** The height of every piece; the rows of a table are measured within their whole table. */
async function measure(d: ExportData, pieces: readonly Piece[], width: number, measurer: Measurer): Promise<Measured[]> {
  const requests: Request[] = [];
  // For every piece: which request measures it, and which group of rows of it.
  const at: [number, number][] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!p.table) {
      at.push([requests.push({ html: p.html }) - 1, -1]);
      continue;
    }
    let end = i;
    while (end + 1 < pieces.length && pieces[end + 1].table && pieces[end + 1].block === p.block && pieces[end + 1].child === p.child) end++;
    const all = pieces.slice(i, end + 1);
    const request = requests.push({ html: `<div class="content">${p.table.open}${all.map((x) => x.html).join("")}${CLOSE}</div>`, groups: all.map((x) => x.table!.rows) }) - 1;
    all.forEach((_, group) => at.push([request, group]));
    i = end;
  }
  const sizes = await measurer.measure(d, requests, width);
  return pieces.map((p, i) => {
    const [r, group] = at[i];
    const size = sizes[r];
    if (group < 0 || !size.rows) return { ...p, height: size.height };
    const lead = size.lead ?? 0;
    const last = group === size.rows.length - 1;
    const height = size.rows[group] + (group === 0 ? lead : 0) + (last ? lead : 0);
    return group === 0 ? { ...p, height } : { ...p, height, lead, cont: lead + (p.table!.head ? size.rows[0] : 0) };
  });
}

export function slotHtml(d: ExportData, slots: Slots, side: Side, n: number, of: number): string {
  const slot = slots[side];
  const words = (text: string) => `<span dir="auto">${esc(text)}</span>`;
  if (slot === "title") return words(coverTitle(d));
  if (slot === "text") return words(slots.texts[side]);
  if (slot === "author") return words(d.template.cover.author);
  if (slot === "date") return words(d.date);
  if (slot === "page") return `<span>${esc(d.words.page(n, of))}</span>`;
  const logo = slot === "logo" && d.template.logo ? d.pictures.get(d.template.logo) : undefined;
  return logo ? `<span><img src="${logo.src}" alt=""></span>` : "<span></span>";
}

/** The header or footer of page `n` of `of` (empty when the template has none). */
export const barHtml = (d: ExportData, box: PageBox, where: "header" | "footer", n: number, of: number): string =>
  box[where] ? `<div class="page__slot" style="height:${SLOT_MM}mm">${SIDES.map((side) => slotHtml(d, d.template[where], side, n, of)).join("")}</div>` : "";

export interface Layout {
  box: PageBox;
  /** 1 when the guide begins with a cover page (which the page numbers do not count). */
  cover: number;
  /** The pages after the cover, with their pieces. */
  pages: { units: (Measured & { scale: number })[] }[];
  /** The page of every unit by its id (also the pages the contents name), as the footer prints it. */
  where: Map<string, number>;
}

/** Which block goes to which page. */
export async function layoutPages(d: ExportData, measurer: Measurer): Promise<Layout> {
  const box = pageBox(d);
  const { width, room } = pageRoom(box);
  // First with placeholders in the contents (the numbers take no height of their own); the numbers are put in afterwards.
  const entries = tocEntries(d);
  const units = await measure(d, chunks(d, new Map(entries.map((e) => [e.id, 99]))).flatMap(split), width, measurer);
  const pages = fillPages(units, room);
  const where = new Map<string, number>();
  pages.forEach((p, i) => p.units.forEach((u) => where.set(u.id, i + 1)));
  return { box, cover: d.options.cover ? 1 : 0, pages, where };
}

/** How a block that is higher than a page is shown smaller: laid out as before, at the width of the text, then shrunk. (A zoom
 * alone would lay it out wider again, and a picture as wide as the page would stay as high as it was.) */
export const shrunk = (scale: number, width: number): string => `zoom:${scale.toFixed(4)};width:${width}px;margin-inline:auto`;

/** The units of one page as HTML: the rows of one table come back together under their table, with its header row again. */
export function bodyHtml(units: readonly (Piece & { scale: number })[], width: number): string {
  const out: string[] = [];
  const wrap = (html: string, scale: number) => `<div style="display:flow-root${scale < 1 ? `;${shrunk(scale, width)}` : ""}">${html}</div>`;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.table) {
      out.push(wrap(u.html, u.scale));
      continue;
    }
    let rows = u.table.head + u.html;
    let scale = u.scale;
    while (units[i + 1]?.table && units[i + 1].block === u.block && units[i + 1].child === u.child) {
      rows += units[++i].html;
      scale = Math.min(scale, units[i].scale);
    }
    out.push(wrap(`<div class="content">${u.table.open}${rows}${CLOSE}</div>`, scale));
  }
  return out.join("");
}

export interface Paged {
  box: PageBox;
  /** The `.page` sections, one string each. */
  pages: string[];
  /** The ids of the units on every page (the cover has none). */
  contents: string[][];
  /** The page of every unit by its id (also the pages the contents name). */
  where: Map<string, number>;
}

/** The pages of a guide in the template's page size, with header, footer and the page numbers of the contents. */
export async function paginate(d: ExportData): Promise<Paged> {
  const measurer = createMeasurer();
  let layout: Layout;
  try {
    layout = await layoutPages(d, measurer);
  } finally {
    measurer.dispose();
  }
  return assemble(d, layout);
}

/** The sheets of a layout. */
export function assemble(d: ExportData, layout: Layout): Paged {
  const { box, where } = layout;
  const toc = chunks(d, where).find((c) => c.kind === "toc");
  const numbered = new Map((toc ? split(toc) : []).map((p) => [p.id, p.html]));
  const size = `width:${box.w}mm;height:calc(${box.h}mm - ${PAGE_TRIM_MM}mm)`;
  const pages: string[] = [];
  const contents: string[][] = [];
  if (layout.cover) {
    pages.push(`<section class="page page--cover" style="${size}">${coverHtml(d)}</section>`);
    contents.push([]);
  }
  const of = layout.pages.length;
  layout.pages.forEach((p, i) => {
    const body = bodyHtml(p.units.map((u) => ({ ...u, html: numbered.get(u.id) ?? u.html })), pageRoom(box).width);
    pages.push(`<section class="page" style="${size};padding:${box.margin}mm">${backgroundLayer(d, "page")}${barHtml(d, box, "header", i + 1, of)}<div class="page__body">${body}</div>${barHtml(d, box, "footer", i + 1, of)}</section>`);
    contents.push(p.units.map((u) => u.id));
  });
  return { box, pages, contents, where };
}

/** The document that is printed (to paper or to PDF): one sheet per page. */
export const printHtml = (d: ExportData, p: Paged): string =>
  htmlDocument(d, `<div class="doc pages">${p.pages.join("")}</div>`, `@page{size:${p.box.w}mm ${p.box.h}mm;margin:0}`);

/** The print preview of the editor: the same pages as sheets on a grey background. */
export const previewHtml = (d: ExportData, p: Paged): string =>
  htmlDocument(
    d,
    `<div class="doc pages">${p.pages.join("")}</div>`,
    `body{background:#6b7075!important;padding:16px}.doc.pages{background:transparent}.pages .page{margin:0 auto 16px;box-shadow:0 3px 14px rgba(0,0,0,.35)}`,
  );
