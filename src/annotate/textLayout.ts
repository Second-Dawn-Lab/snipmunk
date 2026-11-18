// Text boxes (no canvas): wrapping text to a width, the size of the box that fits it, and resizing a text mark with its
// handles. The renderer and the editor use the same functions with a measuring function, so what is drawn is what was
// measured. Corner handles scale the text; the side handles change the width and the text wraps again.
import { boxOf, resizeBox, rotatePoint, type HandleKind, type Pt } from "./geometry";
import type { TextAnnotation } from "./schema";

/** Width of a piece of text in the font of the mark. */
export type Measure = (text: string) => number;

export const LINE_HEIGHT = 1.25;

/** Space around the text when it has a solid label. */
export const labelPadding = (fontSize: number) => Math.round(fontSize * 0.3);

/** Chinese, Japanese and Korean characters: a line may break between any two of them. */
export function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x2e80 && c <= 0x9fff) || // CJK radicals, kana, ideographs
    (c >= 0xac00 && c <= 0xd7af) || // Hangul
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xffef) || // full-width forms
    (c >= 0x20000 && c <= 0x2ffff)
  );
}

/** Closing punctuation that must not start a line. */
const NO_LINE_START = new Set("，。、．：；！？）】」』》〕,.:;!?)]}%”’");

/** Split a paragraph into pieces a line may break between: words with their space, single CJK characters. */
export function pieces(paragraph: string): string[] {
  const out: string[] = [];
  let word = "";
  const flush = () => {
    if (word) out.push(word);
    word = "";
  };
  for (const ch of paragraph) {
    if (isCjk(ch)) {
      flush();
      // Punctuation that must not start a line sticks to the character before it.
      if (NO_LINE_START.has(ch) && out.length > 0) out[out.length - 1] += ch;
      else out.push(ch);
    } else if (ch === " " || ch === "\t") {
      word += ch;
      flush();
    } else {
      word += ch;
    }
  }
  flush();
  return out;
}

/** Break one piece that is wider than the line into parts that fit (a very long word, a URL). */
function breakLong(measure: Measure, piece: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const ch of piece) {
    if (cur && measure(cur + ch) > maxWidth) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * The lines of a text wrapped to `maxWidth` (a line break in the text always breaks). Words wrap at spaces, CJK text
 * between any two characters, and a word longer than the width is broken. Works in logical order, so right-to-left text
 * wraps the same way.
 */
export function wrapLines(measure: Measure, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const piece of pieces(paragraph)) {
      const trimmed = piece.replace(/[ \t]+$/, "");
      if (line === "" || measure((line + piece).replace(/[ \t]+$/, "")) <= maxWidth) {
        line += piece;
        if (measure(line.replace(/[ \t]+$/, "")) > maxWidth && line.length > 1) {
          // A first piece that is too wide on its own.
          const parts = breakLong(measure, line.replace(/[ \t]+$/, ""), maxWidth);
          out.push(...parts.slice(0, -1));
          line = parts[parts.length - 1];
        }
      } else {
        out.push(line.replace(/[ \t]+$/, ""));
        line = piece;
        if (measure(trimmed) > maxWidth) {
          const parts = breakLong(measure, trimmed, maxWidth);
          out.push(...parts.slice(0, -1));
          line = parts[parts.length - 1];
        }
      }
    }
    out.push(line.replace(/[ \t]+$/, ""));
  }
  return out;
}

export interface TextBox {
  w: number;
  h: number;
  lines: string[];
}

/**
 * The lines and the box of a text mark. With a fixed width the text wraps inside it and the height fits the lines; else
 * the box is as wide as the longest line. The height always fits the lines (never clips, never a big empty area).
 */
export function textBox(
  measure: Measure,
  text: string,
  fontSize: number,
  background: boolean,
  fixedWidth: number | null,
): TextBox {
  const pad = background ? labelPadding(fontSize) : 0;
  const minWidth = Math.max(fontSize, 8);
  let lines: string[];
  let w: number;
  if (fixedWidth !== null) {
    w = Math.max(fixedWidth, minWidth + 2 * pad);
    lines = wrapLines(measure, text, w - 2 * pad);
  } else {
    lines = text.split(/\r\n|\r|\n/);
    w = Math.ceil(Math.max(...lines.map((l) => measure(l)), fontSize * 0.5) + 2 * pad);
  }
  return { w, h: Math.ceil(lines.length * fontSize * LINE_HEIGHT + 2 * pad), lines };
}

/** A text mark with its box measured again (after the text, the size or the label changed). */
export function fitted(measure: (fontSize: number) => Measure, a: TextAnnotation): TextAnnotation {
  const box = textBox(measure(a.fontSize), a.text, a.fontSize, a.background, a.fixedWidth ? a.w : null);
  return { ...a, w: box.w, h: box.h };
}

const FRACTIONS: Record<string, [number, number]> = {
  nw: [0, 0],
  ne: [1, 0],
  se: [1, 1],
  sw: [0, 1],
};

/**
 * A text mark after dragging one of its handles to `p`.
 *  - corners: the text scales proportionally (font size and box), the opposite corner stays where it is;
 *  - left and right sides: the box gets another width and the text wraps again; the top edge stays, the height fits.
 */
export function resizeText(
  a: TextAnnotation,
  handle: HandleKind,
  p: Pt,
  measureFor: (fontSize: number) => Measure,
): TextAnnotation {
  const old = boxOf(a);
  const c0 = { x: old.x + old.w / 2, y: old.y + old.h / 2 };
  const rot = old.rotation;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  if (handle === "e" || handle === "w") {
    const pad = a.background ? labelPadding(a.fontSize) : 0;
    const next = resizeBox(old, handle, p, Math.max(a.fontSize, 8) + 2 * pad);
    const base: TextAnnotation = { ...a, fixedWidth: true, w: next.w };
    const box = textBox(measureFor(a.fontSize), a.text, a.fontSize, a.background, next.w);
    // The centre moved sideways with the edge; the top edge stays, so it also moves by half the change of height.
    const c1 = { x: next.x + next.w / 2, y: next.y + next.h / 2 };
    const d = rotatePoint(c1, c0, -rot);
    const lx = d.x - c0.x;
    const ly = (box.h - old.h) / 2;
    const cx = c0.x + lx * cos - ly * sin;
    const cy = c0.y + lx * sin + ly * cos;
    return { ...base, w: box.w, h: box.h, x: cx - box.w / 2, y: cy - box.h / 2 };
  }

  const frac = FRACTIONS[handle];
  if (!frac) return a;
  const [ax, ay] = [1 - frac[0], 1 - frac[1]]; // the anchor is the opposite corner
  const free = resizeBox(old, handle, p, 4);
  const s = Math.max(free.w / old.w, free.h / old.h, 4 / Math.max(a.fontSize, 1));
  const fontSize = Math.max(4, a.fontSize * s);
  const box = textBox(measureFor(fontSize), a.text, fontSize, a.background, a.fixedWidth ? a.w * s : null);
  const anchorGlobal = rotatePoint({ x: old.x + old.w * ax, y: old.y + old.h * ay }, c0, rot);
  const ox = (0.5 - ax) * box.w;
  const oy = (0.5 - ay) * box.h;
  const cx = anchorGlobal.x + ox * cos - oy * sin;
  const cy = anchorGlobal.y + ox * sin + oy * cos;
  return { ...a, fontSize, w: box.w, h: box.h, x: cx - box.w / 2, y: cy - box.h / 2 };
}
