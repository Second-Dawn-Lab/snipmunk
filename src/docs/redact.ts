// Quick redact of a guide (no React): the same finding rules as in screenshot mode, on the text read from the step pictures AND
// on everything written in the guide (step sentences, typed text, descriptions, content blocks, the cover). A picture finding
// becomes a redaction mark; a text finding is replaced by dots, and the original does not go into a saved or exported file.

import { buildDocument, isRtlLine } from "../ocr/layout";
import { findEmailLabels, findMatches, type FindOptions, type Match, type MatchKind } from "../ocr/pii";
import { matchRect } from "../ocr/quickRedact";
import { findGarbledIbans, findValueLabels, isSecretLabel } from "../ocr/sensitive";
import type { Line, OcrResult } from "../ocr/types";
import type { GuideStep } from "../ipc";
import { cropRect, type ContentBlock, type GuideDoc, type Part, type PmDoc, type Rect, type Redaction, type StepBlock } from "./model";
import { changeTemplate, shownRect, templateOf } from "./template/apply";
import { COVER_FIELDS, type CoverField } from "./template/model";

export type Where = "picture" | "text" | "typed" | "desc" | "content" | "cover";

export interface Finding {
  /** The block it was found in ("cover" for the cover page). */
  block: string;
  kind: MatchKind;
  /** What was found (shown in the list of the whole-guide scan). */
  text: string;
  where: Where;
  /** A place in a picture, in picture pixels. */
  rect?: Rect;
  /** A place in a text: the paragraph (indices into the rich text) and the characters of it. */
  path?: number[];
  start?: number;
  end?: number;
  field?: CoverField;
  /** Only the address of a link holds it: the link is removed, its words stay. */
  link?: boolean;
}

export const MASK = "••••••";

// --- pictures ---------------------------------------------------------------------------------------------------------------

/** The part of a step picture whose text is read: what the step shows and what a saved file can hold of it, with a margin;
 * `null`: the whole picture. */
export function scanArea(step: GuideStep, block: StepBlock, doc: Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault" | "template">): Rect | null {
  if (doc.keepFull) return null;
  const [iw, ih] = step.imageSize;
  const rects = [cropRect(step, block, doc), shownRect(step, block, doc).view];
  const margin = 48;
  const x0 = Math.max(0, Math.floor(Math.min(...rects.map((r) => r[0])) - margin));
  const y0 = Math.max(0, Math.floor(Math.min(...rects.map((r) => r[1])) - margin));
  const x1 = Math.min(iw, Math.ceil(Math.max(...rects.map((r) => r[0] + r[2])) + margin));
  const y1 = Math.min(ih, Math.ceil(Math.max(...rects.map((r) => r[1] + r[3])) + margin));
  return x0 === 0 && y0 === 0 && x1 === iw && y1 === ih ? null : [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
}

const right = (l: Line) => l.x + l.w;
const sameRow = (a: Line, b: Line) => Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.min(a.h, b.h) * 0.6;

/** Lines that stand next to each other on one row, joined: recognition often splits "IBAN:" from its number. */
export function rowChains(lines: readonly Line[]): Line[] {
  const used = new Set<Line>();
  const sorted = [...lines].sort((a, b) => a.x - b.x);
  const out: Line[] = [];
  for (const first of sorted) {
    if (used.has(first) || isRtlLine(first.text)) continue;
    const chain = [first];
    let end = first;
    for (const next of sorted) {
      if (used.has(next) || next === first || !sameRow(end, next)) continue;
      const gap = next.x - right(end);
      // A line that begins inside the chain is another reading of the same words, not its continuation.
      if (gap < -0.3 * end.h || gap > 6 * end.h) continue;
      chain.push(next);
      end = next;
    }
    if (chain.length < 2) continue;
    chain.forEach((l) => used.add(l));
    let text = "";
    const offsets: number[] = [];
    for (const l of chain) {
      if (text) text += " ";
      offsets.push(...l.offsets.map((o) => o + text.length));
      text += l.text;
    }
    out.push({ ...first, text, offsets, words: chain.flatMap((l) => l.words), w: right(end) - first.x });
  }
  return out;
}

const RANK: Record<MatchKind, number> = { secret: 0, iban: 1, card: 2, email: 3, custom: 4, phone: 5 };
const areaOfRect = (r: Rect) => r[2] * r[3];
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

/** Two readings of the same place are one finding: the box that holds both. */
function unite(found: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const f of [...found].sort((a, b) => areaOfRect(b.rect!) - areaOfRect(a.rect!))) {
    const same = out.find((o) => overlap(o.rect!, f.rect!) > 0.5 * Math.min(areaOfRect(o.rect!), areaOfRect(f.rect!)));
    if (!same) {
      out.push({ ...f });
      continue;
    }
    const [a, b] = [same.rect!, f.rect!];
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    same.rect = [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
    if (RANK[f.kind] < RANK[same.kind]) {
      same.kind = f.kind;
      same.text = f.text;
    }
  }
  return out.sort((a, b) => a.rect![1] - b.rect![1] || a.rect![0] - b.rect![0]);
}

/** Everything to cover in the recognized text of a step picture, in picture pixels. The result may hold several readings of a
 * line; each is searched, alone and joined with its neighbours on the row. */
export function findInPicture(block: string, result: Pick<OcrResult, "lines" | "width" | "height" | "language">, options: FindOptions): Finding[] {
  const lines = buildDocument(result).lines;
  const out: Finding[] = [];
  for (const line of [...lines, ...rowChains(lines)]) {
    for (const m of [...findMatches(line.text, options), ...(options.iban ? findGarbledIbans(line.text) : [])]) {
      const r = matchRect(line, m);
      if (!r) continue;
      const rect = inside([r.x, r.y, r.w, r.h], result);
      if (rect) out.push({ block, kind: m.kind, text: line.text.slice(m.start, m.end), where: "picture", rect });
    }
  }
  return unite(out);
}

/** A rectangle in whole pixels, cut to the picture; `null` when nothing is left. */
function inside([rx, ry, rw, rh]: Rect, size: { width: number; height: number }): Rect | null {
  const x = Math.max(0, Math.floor(rx));
  const y = Math.max(0, Math.floor(ry));
  const w = Math.min(size.width, Math.ceil(rx + rw)) - x;
  const h = Math.min(size.height, Math.ceil(ry + rh)) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
}

// --- what follows a label, also when it cannot be read ---------------------------------------------------------------------

export interface PictureLabel {
  kind: MatchKind;
  /** The box of the label (picture pixels, whole numbers). */
  box: Rect;
}

type Reading = Pick<OcrResult, "lines" | "width" | "height" | "language">;

/** The labels ("IBAN:", "email:", "password:") in the recognized text of a picture whose kinds are looked for. */
export function labelsIn(result: Reading, options: FindOptions): PictureLabel[] {
  const wanted: Partial<Record<MatchKind, boolean>> = { email: options.email, iban: options.iban, secret: options.secret };
  const out: PictureLabel[] = [];
  const lines = buildDocument(result).lines;
  for (const line of [...lines, ...rowChains(lines)]) {
    for (const l of [...findValueLabels(line.text), ...findEmailLabels(line.text)]) {
      if (!wanted[l.kind]) continue;
      const r = matchRect(line, { kind: l.kind, start: l.start, end: l.start + line.text.slice(l.start, l.end).trimEnd().length, text: "" }, 0);
      const box = r && inside([r.x, r.y, r.w, r.h], result);
      if (box && !out.some((o) => o.kind === l.kind && overlap(o.box, box) > 0.5 * Math.min(areaOfRect(o.box), areaOfRect(box)))) out.push({ kind: l.kind, box });
    }
  }
  return out;
}

/** How much of the width of `ink` the findings of a kind on its row cover. */
function coveredWidth(found: readonly Finding[], kind: MatchKind, ink: Rect): number {
  const parts = found
    .filter((f) => f.kind === kind && f.rect && Math.min(f.rect[1] + f.rect[3], ink[1] + ink[3]) - Math.max(f.rect[1], ink[1]) > 0.4 * ink[3])
    .map((f): Range => [Math.max(ink[0], f.rect![0]), Math.min(ink[0] + ink[2], f.rect![0] + f.rect![2])])
    .filter(([a, b]) => b > a);
  return merged(parts).reduce((sum, [a, b]) => sum + (b - a), 0) / Math.max(1, ink[2]);
}

/**
 * Add what follows the labels: `ink[i]` is the marked part of the picture after label `i` (from the backend). Where the
 * findings of the label's kind do not cover it and it reads like a value (or not at all), the whole of it is covered.
 */
export function addAfterLabels(block: string, result: Reading, found: readonly Finding[], labels: readonly PictureLabel[], inks: readonly (Rect | null)[]): Finding[] {
  const words = result.lines.flatMap((l) => l.words);
  const added: Finding[] = [];
  labels.forEach((label, i) => {
    const ink = inks[i];
    if (!ink || coveredWidth(found, label.kind, ink) >= 0.95) return;
    // (a very long stretch after a label is a sentence or a rule of the window, not a value)
    if (ink[2] > 45 * label.box[3]) return;
    const read = words.filter((w) => {
      const x = w.x + w.w / 2;
      const y = w.y + w.h / 2;
      return x >= ink[0] - 2 && x <= ink[0] + ink[2] + 2 && y >= ink[1] - 3 && y <= ink[1] + ink[3] + 3;
    });
    const text = [...new Set(read.sort((a, b) => a.x - b.x).map((w) => w.text))].join(" ");
    const plain = read.filter((w) => /^\p{L}{3,}$/u.test(w.text)).length;
    const value = plain <= 1 || /[\d@©®]/.test(text) || /\.\s?(?:com|de|org|net|eu|io|uk)(?![A-Za-z])/i.test(text);
    // (what is hidden already shows a row of dots; a single one is a colon that was read as a dot)
    if (!value || /•{3}/.test(text)) return;
    const rect = inside([ink[0] - 2, ink[1] - 2, ink[2] + 4, ink[3] + 4], result);
    if (rect) added.push({ block, kind: label.kind, text, where: "picture", rect });
  });
  return added.length ? unite([...found, ...added]) : [...found];
}

// --- texts ------------------------------------------------------------------------------------------------------------------

type Node = { type?: string; text?: string; content?: Node[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; [k: string]: unknown };

/** The text of a paragraph as it is searched: a line break is a line break, anything else one placeholder character. */
const piece = (n: Node): string => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : "￼");

/** Every paragraph (a node that holds text) of a rich text, with its place. */
function paragraphs(node: Node, path: number[] = [], out: { path: number[]; node: Node }[] = []) {
  if (node.content?.some((c) => c.type === "text")) out.push({ path, node });
  else node.content?.forEach((c, i) => paragraphs(c, [...path, i], out));
  return out;
}

/** A value that was found somewhere (on a picture): wherever else it is written, it is hidden too. */
export interface Known {
  kind: MatchKind;
  text: string;
}

/** What of the findings on pictures is looked for in the texts as well: values long and particular enough not to be an
 * ordinary word ("Password: required" teaches nothing). */
export function knownValues(found: readonly Finding[]): Known[] {
  const out = new Map<string, Known>();
  for (const f of found) {
    const text = f.text.trim();
    if (f.where !== "picture" || text.length < 5 || /\s{2}/.test(text)) continue;
    if (f.kind === "secret" ? !/[\p{L}]/u.test(text) || !/[^\p{L}\s]/u.test(text) : !["email", "iban", "card"].includes(f.kind)) continue;
    out.set(text.toLowerCase(), { kind: f.kind, text });
  }
  return [...out.values()];
}

/** The matches in a text: what the finders see, and the values known from elsewhere. */
function matchesIn(text: string, options: FindOptions, known: readonly Known[]): Match[] {
  const out = findMatches(text, options);
  const low = text.toLowerCase();
  for (const k of known) {
    const needle = k.text.toLowerCase();
    for (let at = low.indexOf(needle); at >= 0; at = low.indexOf(needle, at + needle.length)) {
      const end = at + needle.length;
      if (!out.some((m) => at < m.end && m.start < end)) out.push({ kind: k.kind, start: at, end, text: text.slice(at, end) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function findInRich(block: string, where: Where, rich: unknown, options: FindOptions, known: readonly Known[], field?: CoverField): Finding[] {
  if (!rich) return [];
  const out: Finding[] = [];
  for (const p of paragraphs(rich as Node)) {
    const kids = p.node.content ?? [];
    const text = kids.map(piece).join("");
    const matches = matchesIn(text, options, known);
    for (const m of matches) out.push({ block, kind: m.kind, text: m.text, where, path: p.path, start: m.start, end: m.end, field });
    // The address of a link ("mailto:…") that the words do not show.
    let at = 0;
    for (const k of kids) {
      const length = piece(k).length;
      const href = String(k.marks?.find((x) => x.type === "link")?.attrs?.href ?? "");
      for (const m of href ? findMatches(href.replace(/^mailto:/i, ""), options) : []) {
        if (!matches.some((x) => x.start < at + length && at < x.end)) out.push({ block, kind: m.kind, text: m.text, where, path: p.path, start: at, end: at + length, field, link: true });
      }
      at += length;
    }
  }
  return out;
}

const joined = (parts: readonly Part[]) => parts.map((p) => p.t).join("");

/** The typed text of a typing step, when it has one. */
export const typedOf = (step: GuideStep | undefined): string => (step?.kind === "type" ? (step.typed ?? "") : "");

/** Was the text typed into a field whose name says it holds a secret? */
const secretField = (step: GuideStep): boolean => [step.element?.name ?? "", ...(step.element?.parents ?? [])].some(isSecretLabel);

/** Typing that begins with the rest of a password label: its beginning went into the step before ("pas" | "ssword: …"). */
const LABEL_TAIL = /^\s*(?:p?a?s{1,3}word|a?s{1,2}wort|e?nnwort)\s*[:=]\s*\S/i;

function findInStep(block: StepBlock, step: GuideStep | undefined, options: FindOptions, known: readonly Known[]): Finding[] {
  const parts = block.text ?? step?.text ?? [];
  const sentence = joined(parts);
  let found: Match[] = matchesIn(sentence, options, known);
  const out: Finding[] = [];
  const typed = block.maskTyped ? "" : typedOf(step);
  if (typed) {
    const inTyped = matchesIn(typed, options, known)[0];
    const kind: MatchKind | null = inTyped?.kind ?? (options.secret && (secretField(step!) || LABEL_TAIL.test(typed)) ? "secret" : null);
    const at = sentence.indexOf(typed);
    // The whole of what was typed is masked, as one item.
    if (kind || (at >= 0 && found.some((m) => m.start < at + typed.length && at < m.end))) {
      out.push({ block: block.id, kind: kind ?? found.find((m) => m.start < at + typed.length && at < m.end)!.kind, text: typed, where: "typed", ...(at >= 0 ? { start: at, end: at + typed.length } : {}) });
      if (at >= 0) found = found.filter((m) => m.end <= at || m.start >= at + typed.length);
    }
  }
  return [...found.map((m): Finding => ({ block: block.id, kind: m.kind, text: m.text, where: "text", start: m.start, end: m.end })), ...out];
}

/** A text of the cover as rich text (what was written in place), else its plain words as one paragraph. */
const coverRich = (doc: GuideDoc, field: CoverField): PmDoc | null => {
  const c = templateOf(doc).cover;
  if (c.rich?.[field]) return c.rich[field] as PmDoc;
  return c[field] ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: c[field] }] }] } : null;
};

/** Everything to mask in the texts of the guide (of the blocks in `only`; without it also the cover). */
export function findInText(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>, options: FindOptions, only?: ReadonlySet<string>, known: readonly Known[] = []): Finding[] {
  const out: Finding[] = [];
  if (!only && templateOf(doc).cover.on) for (const f of COVER_FIELDS) out.push(...findInRich("cover", "cover", coverRich(doc, f), options, known, f));
  for (const b of doc.blocks) {
    if (only && !only.has(b.id)) continue;
    if (b.type === "step") out.push(...findInStep(b, steps.get(b.n), options, known), ...findInRich(b.id, "desc", b.desc, options, known));
    else out.push(...findInRich(b.id, "content", (b as ContentBlock).doc, options, known));
  }
  return out;
}

/** Does the recorded data of a step (the names of the control and the window), which a saved file keeps, hold something to
 * hide? */
export function recordNeedsMask(step: GuideStep | undefined, options: FindOptions): boolean {
  if (!step) return false;
  return [step.element?.name ?? "", ...(step.element?.parents ?? []), step.window?.title ?? ""].some((s) => findMatches(s, options).length > 0);
}

// --- applying ---------------------------------------------------------------------------------------------------------------

type Range = [number, number];

/** Ranges sorted, with those that touch joined. */
function merged(ranges: readonly Range[]): Range[] {
  const out: Range[] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The pieces of a text with the ranges replaced by dots (the dots stand where a range begins, in that piece's style). */
function maskPieces(pieces: readonly string[], ranges: readonly Range[]): string[] {
  const list = merged(ranges);
  let at = 0;
  return pieces.map((p) => {
    const from = at;
    const to = (at += p.length);
    let out = "";
    let done = from;
    for (const [a, b] of list) {
      if (b <= from || a >= to) continue;
      if (a >= from) out += p.slice(done - from, a - from) + MASK;
      done = Math.max(done, Math.min(b, to));
    }
    return out + p.slice(done - from);
  });
}

export function maskParts(parts: readonly Part[], ranges: readonly Range[]): Part[] {
  const texts = maskPieces(parts.map((p) => p.t), ranges);
  return parts.map((p, i) => ({ ...p, t: texts[i] })).filter((p) => p.t !== "");
}

/** The sentence of a typing step with what was typed replaced by dots. */
export function maskTyped(parts: readonly Part[], typed: string): Part[] {
  if (!typed) return [...parts];
  const text = joined(parts);
  const ranges: Range[] = [];
  for (let i = text.indexOf(typed); i >= 0; i = text.indexOf(typed, i + typed.length)) ranges.push([i, i + typed.length]);
  return maskParts(parts, ranges);
}

/** A rich text with the findings masked (the findings belong to it). */
export function maskRich<T>(rich: T, findings: readonly Finding[]): T {
  if (findings.length === 0) return rich;
  const walk = (node: Node, path: number[]): Node => {
    const here = findings.filter((f) => f.path!.length === path.length && f.path!.every((v, i) => v === path[i]));
    if (here.length === 0) return node.content ? { ...node, content: node.content.map((c, i) => walk(c, [...path, i])) } : node;
    const kids = node.content ?? [];
    const texts = maskPieces(kids.map(piece), here.filter((f) => !f.link).map((f): Range => [f.start!, f.end!]));
    let at = 0;
    const content = kids.flatMap((k, i) => {
      const from = at;
      at += piece(k).length;
      if (k.type !== "text") return [k];
      // A link whose address held something hidden is no link any more.
      const unlink = here.some((f) => f.start! < at && from < f.end! && (f.link || String(k.marks?.find((m) => m.type === "link")?.attrs?.href ?? "").toLowerCase().includes(f.text.toLowerCase())));
      const marks = unlink ? k.marks?.filter((m) => m.type !== "link") : k.marks;
      return texts[i] === "" ? [] : [{ ...k, text: texts[i], ...(marks ? { marks } : {}) }];
    });
    return { ...node, content };
  };
  return walk(rich as Node, []) as T;
}

/** Is `r` already covered by one of the redactions? */
const covered = (list: readonly Redaction[], r: Rect): boolean =>
  list.some((o) => o.rect[0] <= r[0] && o.rect[1] <= r[1] && o.rect[0] + o.rect[2] >= r[0] + r[2] && o.rect[1] + o.rect[3] >= r[1] + r[3]);

function applyToStep(b: StepBlock, step: GuideStep | undefined, add: readonly Finding[], style: Redaction["kind"], record: boolean): StepBlock {
  const next: StepBlock = { ...b };
  let touched = false;
  const marks = add.filter((f) => f.rect);
  if (marks.length) {
    const list = [...(b.redact ?? [])];
    for (const f of marks) if (!covered(list, f.rect!)) list.push({ rect: f.rect!, kind: style });
    if (list.length !== (b.redact?.length ?? 0)) {
      next.redact = list;
      touched = true;
    }
  }
  const words = add.filter((f) => f.where === "text" || f.where === "typed");
  if (words.length) {
    const parts = b.text ?? step?.text ?? [];
    let text = maskParts(parts, words.filter((f) => f.start !== undefined).map((f): Range => [f.start!, f.end!]));
    const typed = typedOf(step);
    // Typed text that was hidden, wherever it stands in the sentence, is also left out of the file.
    if (typed && words.some((f) => f.where === "typed" || (f.start !== undefined && typed.includes(f.text)))) {
      text = maskTyped(text, typed);
      next.maskTyped = true;
    }
    next.text = text;
    touched = true;
  }
  const desc = add.filter((f) => f.where === "desc");
  if (desc.length && b.desc) {
    next.desc = maskRich(b.desc, desc);
    touched = true;
  }
  // A saved file takes the step's words from the block and keeps no names of the control and the window.
  if ((touched && (words.length || marks.length)) || (record && !b.masked)) {
    next.masked = true;
    next.text ??= step?.text;
    touched = true;
  }
  return touched ? next : b;
}

/** Apply the findings, as one change of the document: marks on pictures, dots in texts. `records` are the steps whose recorded
 * names hold something to hide. */
export function applyRedactions(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>, findings: readonly Finding[], style: Redaction["kind"], records: ReadonlySet<string> = new Set()): GuideDoc {
  let changed = false;
  const blocks = doc.blocks.map((b) => {
    const add = findings.filter((f) => f.block === b.id);
    let next = b;
    if (b.type === "step") {
      if (add.length || records.has(b.id)) next = applyToStep(b, steps.get(b.n), add, style, records.has(b.id));
    } else if (add.length) next = { ...(b as ContentBlock), doc: maskRich((b as ContentBlock).doc, add) };
    changed ||= next !== b;
    return next;
  });
  let out = changed ? { ...doc, blocks } : doc;
  const cover = findings.filter((f) => f.block === "cover" && f.field);
  if (cover.length) {
    out = changeTemplate(out, (t) => {
      for (const field of COVER_FIELDS) {
        const mine = cover.filter((f) => f.field === field);
        if (mine.length === 0) continue;
        const rich = maskRich(coverRich(doc, field)!, mine);
        t.cover[field] = paragraphs(rich as Node).map((p) => (p.node.content ?? []).map(piece).join("")).join(" ");
        if (t.cover.rich?.[field]) t.cover.rich = { ...t.cover.rich, [field]: rich };
      }
    });
  }
  return out;
}
