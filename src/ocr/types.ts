// What the text recognition returns and what the page makes of it (no React, no IPC).

/** A recognized word with its box in the pixels of the picture that was read. */
export interface RawWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawLine {
  text: string;
  words: RawWord[];
}

/** The result of `ocr_recognize` / `ocr_get` (see src-tauri/src/ocr.rs). */
export interface OcrResult {
  key: string;
  engine: string;
  language: string;
  width: number;
  height: number;
  lines: RawLine[];
  tookMs: number;
}

export interface Word extends RawWord {
  /** Position in reading order, over the whole document. */
  n: number;
  /** The line it is in. */
  line: number;
}

export interface Line {
  index: number;
  words: Word[];
  /** The words joined (no space between CJK characters). */
  text: string;
  /** Where each word starts in `text`. */
  offsets: number[];
  rtl: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A gap above this line that is bigger than between lines of a paragraph. */
  paragraphBefore: boolean;
}

/** The recognized text in reading order. */
export interface OcrDoc {
  lines: Line[];
  words: Word[];
  text: string;
  width: number;
  height: number;
  language: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
