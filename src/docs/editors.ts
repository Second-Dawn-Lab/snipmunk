import type { Editor } from "@tiptap/core";

/** The text editors that are on the page, by their element: Ctrl+Z asks the one that has the focus first, then the document
 * history; the page layout asks them where a paragraph stands. */
export const editors = new Map<HTMLElement, Editor>();
