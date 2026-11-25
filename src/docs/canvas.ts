// The editor's pages: where the sheets stand, and how much room goes in front of the block, paragraph or table row that begins a
// page, so that it stands at the head of its sheet. Which block begins which page is decided by the layout of the print preview
// and the PDF (export/paginate.ts); this only places the editable blocks accordingly.

import { PAGE_TRIM_MM, PX_PER_MM, SLOT_MM, pageRoom, shrunk, type Layout, type PageBox } from "./export/paginate";
import { gapId, setPageMarks, type PageMarks } from "./pageGaps";
import { editors } from "./editors";

/** The grey between two sheets. */
export const SHEET_GAP = 18;

export interface Sheet {
  width: number;
  height: number;
  margin: number;
  /** The room of the header (and of the footer). */
  head: number;
  foot: number;
  /** The width of the text. */
  text: number;
}

export function sheetOf(box: PageBox): Sheet {
  return {
    width: box.w * PX_PER_MM,
    height: (box.h - PAGE_TRIM_MM) * PX_PER_MM,
    margin: box.margin * PX_PER_MM,
    head: box.header ? SLOT_MM * PX_PER_MM : 0,
    foot: box.footer ? SLOT_MM * PX_PER_MM : 0,
    text: pageRoom(box).width,
  };
}

/** The top of sheet `i`, and of the text on it. */
export const sheetTop = (s: Sheet, i: number): number => i * (s.height + SHEET_GAP);
export const textTop = (s: Sheet, i: number): number => sheetTop(s, i) + s.margin + s.head;
/** The height of the whole column of `count` sheets. */
export const columnHeight = (s: Sheet, count: number): number => sheetTop(s, count) - SHEET_GAP;

/** What begins a page after the cover. */
export interface Anchor {
  block: string;
  child: number;
  row: number;
  /** The sheet (the cover, when there is one, is sheet 0). */
  sheet: number;
  /** The room between the head of the page and what begins it (a table that goes on keeps its distance). */
  lead: number;
}

export const anchorsOf = (layout: Layout): Anchor[] =>
  layout.pages.map((p, i) => {
    const u = p.units[0];
    return { block: u.block, child: u.child, row: u.row, sheet: i + layout.cover, lead: u.lead ?? 0 };
  });

export const sheetCount = (layout: Layout): number => Math.max(1, layout.cover + layout.pages.length);

/**
 * The new heights of the gaps, given for each (in order) where its element should stand, where it stands now and how high its
 * gap is now. Changing a gap moves everything after it.
 */
export function gapHeights(items: readonly { target: number; top: number; old: number }[]): number[] {
  let moved = 0;
  return items.map((it) => {
    const next = Math.max(0, it.old + it.target - it.top - moved);
    moved += next - it.old;
    return next;
  });
}

/** Where an element stands in the column, whatever the zoom of the page. */
export function topIn(el: HTMLElement, column: HTMLElement): number {
  let y = 0;
  let e: HTMLElement | null = el;
  while (e && e !== column) {
    y += e.offsetTop;
    const parent: HTMLElement | null = e.offsetParent as HTMLElement | null;
    if (!parent || !column.contains(parent)) break;
    if (parent !== column) y += parent.clientTop;
    e = parent;
  }
  return y;
}

/** The text editor inside a block. */
const editorIn = (block: Element) => {
  const dom = block.querySelector<HTMLElement>(".content .ProseMirror");
  return dom ? editors.get(dom) : undefined;
};

const insideText = (a: Anchor): boolean => a.block !== "toc" && a.block !== "title" && (a.child > 0 || a.row > 0);

/**
 * The gaps of the column by what they stand in front of (found in one pass: a long guide has many). What follows a gap stands
 * right at its end (in a table: the row after the gap's row, the repeated header first), also while paragraphs are being added
 * before it, until the next layout sets the gaps anew.
 */
function gapsOf(all: readonly HTMLElement[]): (a: Anchor) => HTMLElement | undefined {
  const blocks = new Map<string, HTMLElement>();
  const inner = new Map<string, HTMLElement>();
  for (const gap of all) {
    if (gap.classList.contains("pgap")) blocks.set(gap.dataset.gap!, gap);
    else inner.set(`${gap.closest<HTMLElement>("article[data-block]")?.dataset.block}|${gap.dataset.gap}`, gap);
  }
  return (a) => (insideText(a) ? inner.get(`${a.block}|${gapId(a)}`) : blocks.get(a.block === "toc" ? `toc:${a.child}` : a.block));
}

/** Hand the text blocks their page breaks (once for every new layout). */
export function markText(column: HTMLElement, layout: Layout | null): void {
  const marks = new Map<string, PageMarks>();
  const of = (block: string) => {
    let m = marks.get(block);
    if (!m) marks.set(block, (m = { gaps: [], shrink: [] }));
    return m;
  };
  for (const a of layout ? anchorsOf(layout) : []) if (insideText(a)) of(a.block).gaps.push({ child: a.child, row: a.row });
  for (const p of layout?.pages ?? []) for (const u of p.units) if (u.scale < 1 && u.html.startsWith('<div class="content">')) of(u.block).shrink.push({ child: u.child, style: shrunk(u.scale, pageRoom(layout!.box).width) });
  column.querySelectorAll<HTMLElement>("article.gcontent[data-block]").forEach((article) => {
    const editor = editorIn(article);
    if (editor) setPageMarks(editor, marks.get(article.dataset.block!) ?? { gaps: [], shrink: [] });
  });
}

/** Put every page's first element at the head of its sheet. Returns whether every element of the layout was found. */
export function placePages(column: HTMLElement, layout: Layout | null): boolean {
  const all = Array.from(column.querySelectorAll<HTMLElement>(".pgap, .pm-gap"));
  const used = new Set<HTMLElement>();
  let complete = true;
  // A step that is higher than a page is shown smaller, as it is printed.
  const small = new Map<string, string>();
  for (const p of layout?.pages ?? []) for (const u of p.units) if (u.scale < 1 && u.row === 0 && u.child === 0) small.set(u.block, shrunk(u.scale, pageRoom(layout!.box).width));
  column.querySelectorAll<HTMLElement>("article.gstep[data-block]").forEach((a) => {
    const next = small.get(a.dataset.block!) ?? "";
    if ((a.dataset.shrunk ?? "") === next) return;
    a.dataset.shrunk = next;
    a.style.cssText = next;
  });
  if (layout) {
    const sheet = sheetOf(layout.box);
    // Twice: room added between two paragraphs also parts their margins.
    for (let pass = 0; pass < 2; pass++) {
      const gapOf = gapsOf(all);
      const found = anchorsOf(layout).flatMap((a) => {
        const gap = gapOf(a);
        if (!gap) complete = false;
        return gap ? [{ gap, target: textTop(sheet, a.sheet) + a.lead }] : [];
      });
      const items = found.map((f) => {
        const old = parseFloat(f.gap.style.height) || 0;
        return { target: f.target, top: topIn(f.gap, column) + old, old };
      });
      let changed = false;
      gapHeights(items).forEach((h, i) => {
        used.add(found[i].gap);
        if (Math.abs(h - items[i].old) < 0.5) return;
        found[i].gap.style.height = `${h}px`;
        changed = true;
      });
      for (const gap of all) {
        if (used.has(gap) || !gap.style.height) continue;
        gap.style.height = "";
        changed = true;
      }
      if (!changed) break;
    }
  } else for (const gap of all) gap.style.height = "";
  return complete;
}
