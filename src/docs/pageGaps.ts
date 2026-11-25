// Page breaks inside a text block while it is edited: room before the paragraph, list or table row that begins a new page (and,
// in a table, its header row once more), added as decorations, so the text itself is not touched.

import { Extension, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** A new page begins before top-level part `child` (and, in a table, before its row `row`). */
export interface Gap {
  child: number;
  row: number;
}
/** A top-level part that is higher than a page is shown smaller, as it is printed. */
export interface Shrink {
  child: number;
  /** The styles that shrink it (the same as in print). */
  style: string;
}
export interface PageMarks {
  gaps: Gap[];
  shrink: Shrink[];
}

const key = new PluginKey<{ marks: string; set: DecorationSet }>("pageGaps");

export const gapId = (g: Gap): string => `${g.child}:${g.row}`;

/** The position of a top-level part of a document, or of a row of a table that is one; `null` when there is none. */
export function markPosition(doc: PmNode, child: number, row: number): number | null {
  if (child >= doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < child; i++) pos += doc.child(i).nodeSize;
  if (row === 0) return pos;
  const table = doc.child(child);
  if (table.type.name !== "table" || row >= table.childCount) return null;
  pos += 1;
  for (let i = 0; i < row; i++) pos += table.child(i).nodeSize;
  return pos;
}

/** The first row of a table when every cell of it is a header cell (it is repeated where the table goes on). */
const headerOf = (table: PmNode): boolean => {
  const first = table.firstChild;
  if (!first) return false;
  let all = true;
  first.forEach((cell) => (all &&= cell.type.name === "tableHeader"));
  return all;
};

const box = (g: Gap): HTMLDivElement => {
  const d = document.createElement("div");
  d.className = "pm-gap";
  d.dataset.gap = gapId(g);
  d.contentEditable = "false";
  return d;
};

function build(doc: PmNode, marks: PageMarks): DecorationSet {
  const out: Decoration[] = [];
  for (const g of marks.gaps) {
    const pos = markPosition(doc, g.child, g.row);
    if (pos === null) continue;
    if (g.row === 0) {
      out.push(Decoration.widget(pos, () => box(g), { key: `gap-${gapId(g)}`, side: -1 }));
      continue;
    }
    const table = doc.child(g.child);
    const columns = Array.from({ length: table.firstChild?.childCount ?? 1 }, (_, i) => Number(table.firstChild?.child(i).attrs.colspan) || 1).reduce((a, b) => a + b, 0);
    out.push(
      Decoration.widget(
        pos,
        () => {
          const tr = document.createElement("tr");
          tr.className = "pm-gap-row";
          const td = document.createElement("td");
          td.colSpan = columns;
          td.appendChild(box(g));
          tr.contentEditable = "false";
          tr.appendChild(td);
          return tr;
        },
        { key: `gap-${gapId(g)}`, side: -2 },
      ),
    );
    if (headerOf(table)) {
      const first = markPosition(doc, g.child, 0)! + 1;
      out.push(
        Decoration.widget(
          pos,
          (view) => {
            const tr = document.createElement("tr");
            tr.className = "pm-gap-head";
            tr.dataset.head = gapId(g);
            tr.contentEditable = "false";
            const dom = view.nodeDOM(first) as HTMLElement | null;
            tr.innerHTML = dom?.innerHTML ?? "";
            return tr;
          },
          // (the key holds the text of the header, so a changed header is drawn again)
          { key: `head-${gapId(g)}-${table.firstChild?.textContent ?? ""}`, side: -1 },
        ),
      );
    }
  }
  for (const s of marks.shrink) {
    const pos = markPosition(doc, s.child, 0);
    if (pos !== null) out.push(Decoration.node(pos, pos + doc.child(s.child).nodeSize, { style: s.style }));
  }
  return DecorationSet.create(doc, out);
}

export const PageGaps = Extension.create({
  name: "pageGaps",
  addProseMirrorPlugins() {
    return [
      new Plugin<{ marks: string; set: DecorationSet }>({
        key,
        state: {
          init: () => ({ marks: "", set: DecorationSet.empty }),
          apply(tr, was) {
            const marks = tr.getMeta(key) as PageMarks | undefined;
            if (marks) return { marks: JSON.stringify(marks), set: build(tr.doc, marks) };
            // While the text changes the breaks stay with their paragraphs; the next layout sets them anew.
            return tr.docChanged ? { marks: was.marks && "?", set: was.set.map(tr.mapping, tr.doc) } : was;
          },
        },
        props: { decorations: (state) => key.getState(state)?.set },
      }),
    ];
  },
});

/** Show the page breaks of a new layout in an editor (nothing is done when it shows them already). */
export function setPageMarks(editor: Editor, marks: PageMarks): void {
  const now = key.getState(editor.state);
  if (!now || editor.isDestroyed) return;
  const none = marks.gaps.length === 0 && marks.shrink.length === 0;
  if (now.marks === JSON.stringify(marks) || (none && now.marks === "")) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, marks).setMeta("addToHistory", false));
}
