// The text layer laid over the picture (no React): how each word's (invisible) text is scaled to fill the word's box, and
// the text of a selection. The words are in the pixels of the recognized picture, which is the document's final picture
// (crop, rotation and flip applied), so the layer follows the picture's own view: stage = offset + zoom * box.
import { textOfWords } from "./layout";
import type { OcrDoc, Word } from "./types";

/** The font size that makes the text of a word as high as its box (the layer is scaled with the picture). */
export function fontSizeFor(word: Pick<Word, "h">): number {
  return Math.max(4, word.h * 0.86);
}

/** The horizontal stretch that makes the text of a word as wide as its box. */
export function fitScale(textWidth: number, boxWidth: number): number {
  if (textWidth <= 0 || boxWidth <= 0) return 1;
  return Math.min(6, Math.max(0.15, boxWidth / textWidth));
}

/** The word numbers of the elements a selection touches (`touched` are the `data-n` of the selected word elements). */
export function selectedNumbers(touched: readonly (number | null | undefined)[]): number[] {
  return touched.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
}

/** The text of a selection: from the first to the last word it touches, in reading order. */
export function selectionText(doc: OcrDoc, touched: readonly (number | null | undefined)[]): string {
  const n = selectedNumbers(touched);
  return n.length === 0 ? "" : textOfWords(doc, n[0], n[n.length - 1]);
}
