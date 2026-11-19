// The gallery search index (no React): every capture's name, window title and recognized text, folded once, so a search over
// hundreds of captures is a few substring checks each. The index is updated when a name changes or text is recognized.
import type { OcrDoc } from "../ocr/types";
import { matchesAll, normalize, queryTerms } from "./normalize";

export interface SearchEntry {
  /** Folded fields. */
  name: string;
  title: string;
  text: string;
  /** The recognized text is known (an empty text is known too: nothing to find). */
  hasText: boolean;
  /** The one string searched. */
  all: string;
}

export interface Searchable {
  id: string;
  name: string;
  sourceWindowTitle: string | null;
}

export class SearchIndex {
  private entries = new Map<string, SearchEntry>();
  /** Raw fields, to tell when a capture changed. */
  private raw = new Map<string, string>();

  /** Add or update a capture's name and title; its recognized text stays. */
  setMeta(c: Searchable): void {
    const key = `${c.name}|${c.sourceWindowTitle ?? ""}`;
    if (this.raw.get(c.id) === key) return;
    this.raw.set(c.id, key);
    const old = this.entries.get(c.id);
    const name = normalize(c.name);
    const title = normalize(c.sourceWindowTitle ?? "");
    const text = old?.text ?? "";
    this.entries.set(c.id, { name, title, text, hasText: old?.hasText ?? false, all: `${name}
${title}
${text}` });
  }

  /** The recognized text of a capture (its raw text; folded here). */
  setText(id: string, text: string): void {
    const e = this.entries.get(id);
    if (!e) {
      this.entries.set(id, { name: "", title: "", text: normalize(text), hasText: true, all: `\n\n${normalize(text)}` });
      return;
    }
    e.text = normalize(text);
    e.hasText = true;
    e.all = `${e.name}\n${e.title}\n${e.text}`;
  }

  /** The recognized text of a capture is gone (it changed and is read again). */
  clearText(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.text = "";
    e.hasText = false;
    e.all = `${e.name}\n${e.title}\n`;
  }

  remove(id: string): void {
    this.entries.delete(id);
    this.raw.delete(id);
  }

  /** Forget the captures that are not in `ids`. */
  keepOnly(ids: ReadonlySet<string>): void {
    for (const id of [...this.entries.keys()]) if (!ids.has(id)) this.remove(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The ids (of `candidates`, in their order) that match every word of the query. */
  search(query: string, candidates: readonly string[]): string[] {
    const terms = queryTerms(query);
    if (terms.length === 0) return [...candidates];
    return candidates.filter((id) => {
      const e = this.entries.get(id);
      return e !== undefined && matchesAll(e.all, terms);
    });
  }

  /** How many of the candidates have no recognized text yet (the search may miss them). */
  unread(candidates: readonly string[]): number {
    return candidates.filter((id) => this.entries.get(id)?.hasText !== true).length;
  }
}

/** The words of a recognized text that match a query (their `n`), to highlight in the preview. */
export function matchingWords(doc: OcrDoc, query: string): Set<number> {
  const terms = queryTerms(query);
  const out = new Set<number>();
  if (terms.length === 0) return out;
  for (const w of doc.words) {
    const f = normalize(w.text);
    if (f && terms.some((t) => f.includes(t))) out.add(w.n);
  }
  // A term in CJK text may span words: a line that contains it as a whole marks its words.
  for (const line of doc.lines) {
    const f = normalize(line.text);
    for (const t of terms) {
      if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(t) || !f.includes(t)) continue;
      for (const w of line.words) if (t.includes(normalize(w.text)) || normalize(w.text).includes(t)) out.add(w.n);
    }
  }
  return out;
}
