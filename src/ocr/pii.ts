// E-mail addresses and phone numbers in recognized text (no React), for Quick redact. The phone matching avoids dates,
// times, prices, version numbers, IP addresses and plain ids: it asks for the shape of a phone number (a +, 00 or national
// 0 prefix, brackets, or the 3-3-4 digit groups of North America) and for 7 to 15 digits.

export type MatchKind = "email" | "phone";

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

export function findEmails(text: string): Match[] {
  return [...text.matchAll(EMAIL)].map((m) => ({ kind: "email" as const, start: m.index as number, end: (m.index as number) + m[0].length, text: m[0] }));
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
}

/** All matches of the chosen kinds, in text order, without overlaps (an address wins over a number inside it). */
export function findMatches(text: string, options: FindOptions): Match[] {
  const all = [...(options.email ? findEmails(text) : []), ...(options.phone ? findPhones(text) : [])].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  for (const m of all) {
    const last = out[out.length - 1];
    if (last && m.start < last.end) continue;
    out.push(m);
  }
  return out;
}
