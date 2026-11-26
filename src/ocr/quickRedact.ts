// Quick redact (no React): the boxes of the e-mail addresses and phone numbers found in recognized text, and the redaction
// marks that cover them.
import { newId, type RedactAnnotation } from "../annotate/schema";
import { invert, transformRect, type Matrix } from "../annotate/transform";
import { findMatches, type FindOptions, type Match, type MatchKind } from "./pii";
import type { Settings } from "../settings/defaults";
import type { Line, OcrDoc, Rect, Word } from "./types";

/** The part of a word's box that holds characters `i` to `j` of its text (characters run right to left in an RTL line). */
export function wordSlice(word: Word, i: number, j: number, rtl: boolean): Rect {
  const len = Math.max(1, [...word.text].length);
  const a = Math.max(0, Math.min(len, i)) / len;
  const b = Math.max(0, Math.min(len, j)) / len;
  const x0 = rtl ? word.x + word.w * (1 - b) : word.x + word.w * a;
  const x1 = rtl ? word.x + word.w * (1 - a) : word.x + word.w * b;
  return { x: x0, y: word.y, w: x1 - x0, h: word.h };
}

function union(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The box of a match in a line: the words it touches, cut at the characters where it begins and ends. */
export function matchRect(line: Line, match: Match, pad = 2): Rect | null {
  const parts: Rect[] = [];
  line.words.forEach((w, i) => {
    const wStart = line.offsets[i];
    const wEnd = wStart + w.text.length;
    if (match.end <= wStart || match.start >= wEnd) return;
    parts.push(wordSlice(w, match.start - wStart, match.end - wStart, line.rtl));
  });
  if (parts.length === 0) return null;
  const u = union(parts);
  return { x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad };
}

type RedactSettings = Pick<
  Settings,
  | "quickRedactEmail"
  | "quickRedactPhone"
  | "quickRedactCard"
  | "quickRedactIban"
  | "quickRedactSecret"
  | "quickRedactCustom"
  | "quickRedactWords"
  | "quickRedactWholeWord"
>;

/** What Quick redact covers, from the settings. */
export function optionsFromSettings(s: RedactSettings): FindOptions {
  return {
    email: s.quickRedactEmail,
    phone: s.quickRedactPhone,
    card: s.quickRedactCard,
    iban: s.quickRedactIban,
    secret: s.quickRedactSecret,
    custom: s.quickRedactCustom ? { words: s.quickRedactWords, wholeWord: s.quickRedactWholeWord } : null,
  };
}

/** Is anything to look for? (Custom words count only when the list is not empty.) */
export function anythingChosen(o: FindOptions): boolean {
  return o.email || o.phone || !!o.card || !!o.iban || !!o.secret || (!!o.custom && o.custom.words.some((w) => w.trim() !== ""));
}

export interface QuickResult {
  rects: Rect[];
  emails: number;
  phones: number;
  /** The number of hits per kind. */
  counts: Partial<Record<MatchKind, number>>;
}

/** Everything to cover in a recognized text, in the pixels of the recognized picture. */
export function quickRects(doc: OcrDoc, options: FindOptions): QuickResult {
  const rects: Rect[] = [];
  let emails = 0;
  let phones = 0;
  const counts: Partial<Record<MatchKind, number>> = {};
  for (const line of doc.lines) {
    for (const m of findMatches(line.text, options)) {
      const r = matchRect(line, m);
      if (!r) continue;
      rects.push(r);
      if (m.kind === "email") emails++;
      else if (m.kind === "phone") phones++;
      counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    }
  }
  return { rects, emails, phones, counts };
}

/**
 * Redaction marks for boxes found in the recognized picture. That picture is the document's final picture (crop, rotation
 * and flip applied), so the boxes are taken back to the original pixels with the inverse of the document's matrix.
 */
export function redactionsFor(rects: readonly Rect[], matrix: Matrix, source: { width: number; height: number }): RedactAnnotation[] {
  const inv = invert(matrix);
  const out: RedactAnnotation[] = [];
  for (const r of rects) {
    const s = transformRect(r, inv);
    const x = Math.max(0, Math.floor(s.x));
    const y = Math.max(0, Math.floor(s.y));
    const w = Math.min(source.width, Math.ceil(s.x + s.w)) - x;
    const h = Math.min(source.height, Math.ceil(s.y + s.h)) - y;
    if (w > 0 && h > 0) out.push({ type: "redact", id: newId(), x, y, w, h, mode: "box", origin: "quick" });
  }
  return out;
}
