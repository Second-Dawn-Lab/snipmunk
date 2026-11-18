// Table detection from the geometry of recognized words (no React): rows and columns, also when the columns are only
// aligned and there are no grid lines. Best effort: anything that does not look like a table gives `null`.
import type { OcrDoc, Word } from "./types";
import { joinWords } from "./layout";

export interface Table {
  /** Rows of cells; every row has as many cells as there are columns (empty strings for missing cells). */
  rows: string[][];
  columns: number;
  rtl: boolean;
}

interface Cell {
  words: Word[];
  left: number;
  right: number;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Rows of words: words whose vertical middle is within half a line of the row's first word. */
function wordRows(words: readonly Word[]): Word[][] {
  const sorted = [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: Word[][] = [];
  for (const w of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const mid = row.reduce((s, r) => s + r.y + r.h / 2, 0) / row.length;
      const h = median(row.map((r) => r.h));
      if (Math.abs(w.y + w.h / 2 - mid) < Math.max(h, w.h) * 0.5) {
        row.push(w);
        continue;
      }
    }
    rows.push([w]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

/** Split a row into cells at gaps wider than a couple of spaces. */
function cellsOf(row: readonly Word[], gap: number): Cell[] {
  const cells: Cell[] = [];
  for (const w of row) {
    const last = cells[cells.length - 1];
    if (last && w.x - last.right <= gap) {
      last.words.push(w);
      last.right = Math.max(last.right, w.x + w.w);
    } else cells.push({ words: [w], left: w.x, right: w.x + w.w });
  }
  return cells;
}

interface Column {
  left: number;
  right: number;
  support: number;
}

/** Columns: horizontal spans that cells of several rows overlap. */
function columnsOf(rows: Cell[][]): Column[] {
  const spans = rows.flat().map((c) => ({ left: c.left, right: c.right })).sort((a, b) => a.left - b.left);
  const columns: Column[] = [];
  for (const s of spans) {
    const last = columns[columns.length - 1];
    if (last && s.left <= last.right) {
      last.right = Math.max(last.right, s.right);
      last.support++;
    } else columns.push({ left: s.left, right: s.right, support: 1 });
  }
  return columns;
}

function overlap(a: { left: number; right: number }, b: { left: number; right: number }): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

/**
 * Find a table in recognized words. A table has at least two rows and two columns, most rows have several cells, and
 * most cells line up in columns. A paragraph (one cell per row) or a single line is not a table.
 */
export function detectTable(doc: OcrDoc): Table | null {
  if (doc.words.length < 4) return null;
  const rowsOfWords = wordRows(doc.words);
  if (rowsOfWords.length < 2) return null;
  const h = median(doc.words.map((w) => w.h));
  // Words of one sentence are about a third of a line apart; cells are at least a line apart.
  const gap = Math.max(h * 0.9, 6);
  const allRows = rowsOfWords.map((r) => cellsOf(r, gap));
  const mids = rowsOfWords.map((r) => r.reduce((sum, w) => sum + w.y + w.h / 2, 0) / r.length);

  // A table is a stretch of rows that follow each other closely; text above and below it (a screenshot of a page) is not part of it.
  const run = tableRun(allRows, mids);
  if (!run) return null;
  const first = run[0];
  let rows = allRows.slice(first, run[1] + 1);

  // Cells that were split by a gap inside a sentence are the main danger: look at how the cells line up.
  const multi = rows.filter((r) => r.length >= 2);
  if (multi.length < 2 || multi.length < rows.length * 0.5) return null;

  // Columns come from the rows with several cells; a row with one cell (a title) is not a table row, but is kept.
  let columns = columnsOf(multi).filter((c) => c.support >= 2);
  // Too many columns with a single supporter are noise: need two or more real columns.
  if (columns.length < 2) return null;
  // A column must be used by at least half of the multi-cell rows, or it is noise (a sentence broken in the middle).
  columns = columns.filter((c) => c.support >= Math.max(2, multi.length * 0.5));
  if (columns.length < 2) return null;

  // Right-aligned numbers do not share a left edge but they overlap: assign each cell to the column it overlaps most.
  const grid: string[][] = [];
  const titleRows = new Set<number>();
  rows.forEach((cells, ri) => {
    if (cells.length < 2) {
      titleRows.add(ri);
      return;
    }
    const row: string[] = columns.map(() => "");
    for (const cell of cells) {
      let best = -1;
      let bestOverlap = 0;
      columns.forEach((c, ci) => {
        const o = overlap(cell, c);
        if (o > bestOverlap) {
          bestOverlap = o;
          best = ci;
        }
      });
      if (best < 0) best = nearest(columns, cell);
      const text = joinWords(cell.words).text;
      row[best] = row[best] ? `${row[best]} ${text}` : text;
    }
    grid.push(row);
  });
  rows = [];
  if (grid.length < 2) return null;
  // Most cells must be filled: a table of mostly empty cells is two unrelated lists.
  const filled = grid.flat().filter(Boolean).length;
  if (filled < grid.length * columns.length * 0.5) return null;
  const rtl = doc.lines.filter((l) => l.rtl).length > doc.lines.length / 2;
  // A right-to-left table starts at the right: the first column is the rightmost.
  const ordered = rtl ? grid.map((r) => [...r].reverse()) : grid;
  return { rows: ordered, columns: columns.length, rtl };
}

/**
 * The longest stretch of rows [first, last] that could be a table: it starts and ends with a row of several cells, its rows
 * are about one line apart (a big gap ends it), and it does not have two rows of one cell in a row.
 */
function tableRun(rows: readonly Cell[][], mids: readonly number[]): [number, number] | null {
  const gaps = mids.slice(1).map((y, i) => y - mids[i]);
  const usual = median(gaps);
  let best: [number, number] | null = null;
  let bestMulti = 0;
  let start = 0;
  const close = (end: number) => {
    let a = start;
    let b = end;
    while (a <= b && rows[a].length < 2) a++;
    while (b >= a && rows[b].length < 2) b--;
    const multi = rows.slice(a, b + 1).filter((r) => r.length >= 2).length;
    if (multi >= 2 && multi > bestMulti) {
      best = [a, b];
      bestMulti = multi;
    }
  };
  for (let i = 1; i < rows.length; i++) {
    const apart = usual > 0 && gaps[i - 1] > usual * 2.2;
    if (apart || (rows[i].length < 2 && rows[i - 1].length < 2)) {
      close(i - 1);
      start = i;
    }
  }
  close(rows.length - 1);
  return best;
}

function nearest(columns: Column[], cell: Cell): number {
  let best = 0;
  let bestD = Infinity;
  columns.forEach((c, i) => {
    const d = Math.min(Math.abs(cell.left - c.right), Math.abs(cell.right - c.left));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Tab separated text: tabs and line breaks inside a cell become spaces. */
export function toTsv(table: Table): string {
  return table.rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

/** An HTML table that pastes as a table into Excel, Word and Google Sheets. */
export function toHtml(table: Table): string {
  const dir = table.rtl ? ' dir="rtl"' : "";
  const rows = table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table${dir}><tbody>${rows}</tbody></table>`;
}
