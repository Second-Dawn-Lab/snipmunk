// Reading order and line grouping of recognized text (no React): left-to-right, right-to-left and CJK lines, paragraph
// gaps, and the text of a range of words.
import { isCjk } from "../annotate/textLayout";
import type { Line, OcrDoc, OcrResult, RawLine, RawWord, Word } from "./types";

const isRtlLetter = (c: number) => (c >= 0x590 && c <= 0x8ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);

/** Right to left when most of the letters are Arabic, Hebrew, Syriac or Thaana. */
export function isRtlLine(text: string): boolean {
  let rtl = 0;
  let ltr = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    if (isRtlLetter(ch.codePointAt(0) as number)) rtl++;
    else ltr++;
  }
  return rtl > ltr;
}

/** Two words are joined without a space when both sides are CJK characters. */
function needsSpace(prev: string, next: string): boolean {
  const a = [...prev].pop() ?? "";
  const b = [...next][0] ?? "";
  return !(isCjk(a) && isCjk(b));
}

/** The words in reading order joined into a text, and where each word starts in it. */
export function joinWords(words: readonly { text: string }[]): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  words.forEach((w, i) => {
    if (i > 0 && needsSpace(words[i - 1].text, w.text)) text += " ";
    offsets.push(text.length);
    text += w.text;
  });
  return { text, offsets };
}

const centreY = (r: { y: number; h: number }) => r.y + r.h / 2;

function bounds(words: readonly RawWord[]) {
  const x0 = Math.min(...words.map((w) => w.x));
  const y0 = Math.min(...words.map((w) => w.y));
  const x1 = Math.max(...words.map((w) => w.x + w.w));
  const y1 = Math.max(...words.map((w) => w.y + w.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

interface Prepared {
  words: RawWord[];
  box: { x: number; y: number; w: number; h: number };
  rtl: boolean;
}

/** One recognized line made ready: its words in reading order (right to left for Arabic and Hebrew). */
function prepare(line: RawLine): Prepared | null {
  const words = line.words.filter((w) => w.text.trim() !== "" && w.w > 0 && w.h > 0);
  if (words.length === 0) return null;
  const rtl = isRtlLine(line.text || words.map((w) => w.text).join(" "));
  const sorted = [...words].sort((a, b) => (rtl ? b.x + b.w - (a.x + a.w) : a.x - b.x));
  return { words: sorted, box: bounds(words), rtl };
}

/**
 * Turn what the engine returned into lines in reading order: lines that sit on the same row (a table, two columns) are
 * read left to right, or right to left when they are right-to-left text; rows are read from the top; a bigger gap starts
 * a new paragraph.
 */
export function buildDocument(result: Pick<OcrResult, "lines" | "width" | "height" | "language">): OcrDoc {
  const prepared = result.lines.map(prepare).filter((p): p is Prepared => p !== null);
  // Rows: lines whose vertical middle falls inside the box of the first line of the row.
  prepared.sort((a, b) => centreY(a.box) - centreY(b.box) || a.box.x - b.box.x);
  const rows: Prepared[][] = [];
  for (const p of prepared) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (first && Math.abs(centreY(p.box) - centreY(first.box)) < Math.min(first.box.h, p.box.h) * 0.5) row.push(p);
    else rows.push([p]);
  }
  const ordered: Prepared[] = [];
  for (const row of rows) {
    const rtl = row.filter((p) => p.rtl).length > row.length / 2;
    row.sort((a, b) => (rtl ? b.box.x - a.box.x : a.box.x - b.box.x));
    ordered.push(...row);
  }
  const heights = ordered.map((p) => p.box.h);
  const typical = median(heights);

  const lines: Line[] = [];
  const words: Word[] = [];
  let prevBottom = -Infinity;
  let prevRowCentre = -Infinity;
  ordered.forEach((p, index) => {
    const { text, offsets } = joinWords(p.words);
    const ws: Word[] = p.words.map((w) => ({ ...w, n: words.length + 0, line: index }));
    ws.forEach((w, i) => (w.n = words.length + i));
    words.push(...ws);
    // A gap between rows (not between two lines of the same row) bigger than a line is a paragraph break.
    const sameRow = Math.abs(centreY(p.box) - prevRowCentre) < p.box.h * 0.5;
    const gap = p.box.y - prevBottom;
    lines.push({
      index,
      words: ws,
      text,
      offsets,
      rtl: p.rtl,
      ...p.box,
      paragraphBefore: index > 0 && !sameRow && gap > typical * 0.9,
    });
    if (!sameRow) {
      prevBottom = p.box.y + p.box.h;
      prevRowCentre = centreY(p.box);
    } else prevBottom = Math.max(prevBottom, p.box.y + p.box.h);
  });
  return { lines, words, text: textOfLines(lines), width: result.width, height: result.height, language: result.language };
}

/** The text of whole lines: a line break after each, an empty line where a paragraph begins. */
export function textOfLines(lines: readonly Line[]): string {
  let out = "";
  lines.forEach((l, i) => {
    if (i > 0) out += l.paragraphBefore ? "\n\n" : "\n";
    out += l.text;
  });
  return out;
}

/** The text from word `from` to word `to` (reading order numbers, either way round), as it reads. */
export function textOfWords(doc: OcrDoc, from: number, to: number): string {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  let out = "";
  let line = -1;
  let current: Word[] = [];
  const flush = () => {
    if (current.length) out += joinWords(current).text;
    current = [];
  };
  for (const w of doc.words) {
    if (w.n < a || w.n > b) continue;
    if (w.line !== line) {
      flush();
      if (line !== -1) out += doc.lines[w.line].paragraphBefore ? "\n\n" : "\n";
      line = w.line;
    }
    current.push(w);
  }
  flush();
  return out;
}

/** Is there anything to copy? */
export function isEmpty(doc: OcrDoc | null): boolean {
  return !doc || doc.text.trim() === "";
}
