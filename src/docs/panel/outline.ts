// The words of an outline entry (no React).

import type { PmDoc } from "../model";

type Node = { text?: string; content?: unknown[] };

const walk = (n: Node): string => (n.text ?? "") + ((n.content ?? []) as Node[]).map(walk).join(" ");

/** The beginning of a text or of a rich text, on one line. */
export function firstWords(from: string | PmDoc, most = 60): string {
  const text = (typeof from === "string" ? from : walk(from as Node)).replace(/\s+/g, " ").trim();
  const letters = [...text];
  return letters.length > most ? `${letters.slice(0, most - 1).join("").trimEnd()}…` : text;
}
