// E-mail addresses and phone numbers in recognized text (no React), for Quick redact. The phone matching avoids dates,
// times, prices, version numbers, IP addresses and plain ids: it asks for the shape of a phone number (a +, 00 or national
// 0 prefix, brackets, or the 3-3-4 digit groups of North America) and for 7 to 15 digits.

import { findCards, findCustom, findIbans, findSecrets, type CustomWords } from "./sensitive";

export type MatchKind = "email" | "phone" | "card" | "iban" | "secret" | "custom";

export interface Match {
  kind: MatchKind;
  start: number;
  end: number;
  text: string;
}

const EMAIL = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g;

/** A run of digits with the separators of phone numbers; refined by `isPhone`. */
const PHONE_CANDIDATE = /(?<![\w@./+-])(?:\+|00)?\(?\d[\d ()./\-–]{4,}\d(?![\w@])/g;

export function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

const DATE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/;
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const PRICE = /^\d{1,3}([.,]\d{3})*[.,]\d{2}$|^\d+[.,]\d{2}$/;
const DOTTED = /^\d{1,3}(\.\d{1,5}){2,3}$/;
const NANP = /^\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}$/;

/** Does this text look like a phone number (and not like a date, time, price, version, IP address or id)? */
export function isPhone(raw: string): boolean {
  const s = raw.trim();
  const digits = digitsOf(s);
  if (digits.length < 7 || digits.length > 15) return false;
  if (DATE.test(s) || TIME.test(s) || PRICE.test(s)) return false;
  // 192.168.1.100, 10.0.19045.1: dotted numbers are phone numbers only in the North American 3-3-4 form.
  if (DOTTED.test(s)) return NANP.test(s);
  const prefixed = /^(\+|00|\()/.test(s) || s.startsWith("0");
  if (prefixed) {
    // Letters of the same token are never part of a number; a '(' prefix needs a closing bracket.
    return !(s.startsWith("(") && !s.includes(")"));
  }
  return NANP.test(s);
}

/** Trim separators from the end (a full stop after a number is not part of it). */
function trimEnd(s: string): string {
  return s.replace(/[ ./\-–()]+$/, (m) => (m.includes(")") && s.slice(0, s.length - m.length).includes("(") ? m.slice(0, m.indexOf(")") + 1) : ""));
}

/** An address as recognition may read it: a space beside the "@" or a dot, "©" for "@", "c0m"; only with a common ending. */
const EMAIL_READ =
  /[A-Za-z0-9][A-Za-z0-9._%+-]*(?: ?@ ?|[©®](?=[A-Za-z0-9]))[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?: ?\. ?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*? ?\. ?(?:com|c0m|de|org|net|eu|info|biz|edu|gov|io|uk|fr|nl|pl|ch)(?![A-Za-z0-9])/gi;

/** An address whose domain was read with a sign no address has ("gma±i" for "gmail"): an "@" and a common ending around it
 * are enough. */
const EMAIL_ODD = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][^\s@<>()"',;:]{0,50}\.(?:com|c0m|de|org|net|eu|info|biz|edu|gov|io|uk|fr|nl|pl|ch)(?![A-Za-z0-9])/gi;

/** Labels of an e-mail address in the interface languages. */
const EMAIL_LABEL =
  /(?<![\p{L}\p{N}_@.])(?:e[ -]?mail(?:[ -](?:address|adresse))?|mail|correo(?: electrónico)?|courriel|e-?posta|البريد الإلكتروني|ای میل|邮箱|电子邮件)[ \t]*[:：=][ \t]*/giu;
/** Where the labels of e-mail addresses stand in a line. */
export const findEmailLabels = (text: string): { kind: "email"; start: number; end: number }[] =>
  [...text.matchAll(EMAIL_LABEL)].map((m) => ({ kind: "email", start: m.index as number, end: (m.index as number) + m[0].length }));

/** Does a value look like an address, however its "@" was read? */
const ADDRESS_LIKE = /[@©®€]|\. ?(?:com|c0m|de|org|net|eu|info|biz|edu|gov|io|uk|fr|nl|pl|ch|at|es|it|pk|ae|sa|cn)$/i;

/** What stands after the label of an e-mail address and looks like one, also when recognition spoiled the "@" or a dot. */
function labelledEmails(text: string): Match[] {
  const out: Match[] = [];
  for (const label of text.matchAll(EMAIL_LABEL)) {
    const from = (label.index as number) + label[0].length;
    const word = /[^\s<>()"',;]+/y;
    word.lastIndex = from + (/^[<("']*/.exec(text.slice(from))?.[0].length ?? 0);
    const start = word.lastIndex;
    let value = word.exec(text)?.[0] ?? "";
    let end = start + value.length;
    // An address that was read in pieces ("name @ example . com").
    for (;;) {
      const next = /^ ?([^\s<>()"',;]+)/.exec(text.slice(end));
      if (!next || !(/[@.]$/.test(value) || /^[@.]/.test(next[1]))) break;
      value = text.slice(start, (end += next[0].length));
    }
    const trimmed = value.replace(/[.:]+$/, "");
    if (trimmed.length > 2 && !/^•+$/.test(trimmed) && ADDRESS_LIKE.test(trimmed)) out.push({ kind: "email", start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}

export function findEmails(text: string): Match[] {
  const read = [...text.matchAll(EMAIL), ...text.matchAll(EMAIL_READ), ...text.matchAll(EMAIL_ODD)].map((m) => ({ kind: "email" as const, start: m.index as number, end: (m.index as number) + m[0].length, text: m[0] }));
  // The longer reading first: it holds the shorter one.
  const all = [...read, ...labelledEmails(text)].sort((a, b) => b.end - b.start - (a.end - a.start));
  const out: Match[] = [];
  for (const m of all) if (!out.some((o) => m.start < o.end && o.start < m.end)) out.push(m);
  return out.sort((a, b) => a.start - b.start);
}

export function findPhones(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    const start = m.index as number;
    const trimmed = trimEnd(m[0]);
    if (trimmed && isPhone(trimmed)) out.push({ kind: "phone", start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}

export interface FindOptions {
  email: boolean;
  phone: boolean;
  card?: boolean;
  iban?: boolean;
  secret?: boolean;
  custom?: CustomWords | null;
}

/** Who wins when two matches overlap (an address beats a number inside it, a card beats a phone number). */
const PRIORITY: Record<MatchKind, number> = { secret: 0, iban: 1, card: 2, email: 3, custom: 4, phone: 5 };

/** All matches of the chosen kinds, in text order, without overlaps. */
export function findMatches(text: string, options: FindOptions): Match[] {
  const all = [
    ...(options.email ? findEmails(text) : []),
    ...(options.card ? findCards(text) : []),
    ...(options.iban ? findIbans(text) : []),
    ...(options.secret ? findSecrets(text) : []),
    ...(options.custom ? findCustom(text, options.custom) : []),
    ...(options.phone ? findPhones(text) : []),
  ].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.start - b.start || b.end - a.end);
  const taken: Match[] = [];
  for (const m of all) if (!taken.some((t) => m.start < t.end && t.start < m.end)) taken.push(m);
  return taken.sort((a, b) => a.start - b.start);
}
