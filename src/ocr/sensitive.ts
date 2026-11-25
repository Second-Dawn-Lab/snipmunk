// Credit cards, IBANs, passwords / secrets and the user's own words in recognized text (no React), for Quick redact.
// Every detector checks more than the shape: cards pass the Luhn check, IBANs have the right length for their country and
// the mod-97 check, secrets are only the value after a label.
import type { Match } from "./pii";

const digitsOnly = (s: string) => s.replace(/\D/g, "");

// --- credit cards ---------------------------------------------------------------

/** The Luhn check of a string of digits. */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** What text recognition typically reads instead of a digit. */
const CONFUSED: Readonly<Record<string, string>> = { O: "0", o: "0", Ø: "0", ø: "0", e: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8" };
const CONFUSABLE = /[OoØøeIl|SsB]/g;
const fixDigits = (s: string) => s.replace(CONFUSABLE, (c) => CONFUSED[c]);

/** Digits, and the letters recognition mixes them up with (a slashed zero reads as O, Ø or e); the checksum decides whether it
 * is a card. */
const CARD_CANDIDATE = /(?<![\w|-])[\dOoØøeIl|SsB](?:[ -]?[\dOoØøeIl|SsB]){12,18}(?![\w|-])/g;

/** 13 to 19 digits (single spaces or dashes between them) that pass the Luhn check. */
export function isCard(raw: string): boolean {
  const digits = digitsOnly(raw);
  if (digits.length < 13 || digits.length > 19) return false;
  if (!/^[\d]+(?:[ -][\d]+)*$/.test(raw.trim())) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  return luhn(digits);
}

/** A card number that may carry typical recognition mistakes (O for 0, l for 1, S for 5, B for 8): at least 8 real digits, and
 * the Luhn check of the repaired number. */
export function isCardLoose(raw: string): boolean {
  if ((raw.match(/\d/g) ?? []).length < 8) return false;
  return isCard(fixDigits(raw));
}

export function findCards(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(CARD_CANDIDATE)) {
    if (isCardLoose(m[0])) out.push({ kind: "card", start: m.index as number, end: (m.index as number) + m[0].length, text: m[0] });
  }
  return out;
}

// --- IBAN -------------------------------------------------------------------------

/** The length of an IBAN per country (the SWIFT IBAN registry). */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

/** The mod-97 check of an IBAN without spaces. */
export function ibanChecksum(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** What may stand between the groups of an IBAN: a space or a hyphen. */
const IBAN_GAP = /[ \-‐‑‒–—]/g;

/** Is this an IBAN (with or without spaces or hyphens): the country, its length and the check digits are right? */
export function isIban(raw: string): boolean {
  const compact = raw.replace(IBAN_GAP, "").toUpperCase();
  const len = IBAN_LENGTHS[compact.slice(0, 2)];
  return len !== undefined && compact.length === len && ibanChecksum(compact);
}

/** Countries whose IBAN has digits only after the country code. */
const NUMERIC_IBAN = new Set(["AT", "BE", "CZ", "DE", "DK", "EE", "ES", "FI", "HR", "HU", "LT", "NO", "PL", "PT", "SE", "SI", "SK"]);
/** In a place that can only hold a digit, more look-alikes are safe to repair (the checksum still decides). */
const IBAN_CONFUSED: Readonly<Record<string, string>> = { ...CONFUSED, Q: "0", D: "0", i: "1", Z: "2", z: "2", G: "6", b: "6", g: "9", q: "9" };

/** An IBAN with the typical recognition mistakes repaired in its digit places (all of it for a country with digits only, else
 * the check digits and the groups that are mostly digits). */
export function repairIban(found: string): string {
  if (NUMERIC_IBAN.has(found.slice(0, 2))) return found.slice(0, 2) + [...found.slice(2)].map((c) => IBAN_CONFUSED[c] ?? c).join("");
  // The groups and what stands between them (spaces or hyphens); without either, groups of four.
  const parts = new RegExp(IBAN_GAP.source).test(found) ? found.split(new RegExp(`(${IBAN_GAP.source})`)) : (found.match(/.{1,4}/g) ?? []);
  let first = true;
  return parts
    .map((c) => {
      if (c.length === 1 && new RegExp(IBAN_GAP.source).test(c)) return c;
      if (first) {
        first = false;
        return c.slice(0, 2) + fixDigits(c.slice(2));
      }
      // A group of only digits and look-alike letters is a group of digits; a group with real letters (WEST, ABNA) is left alone.
      return /^[\dOoØøeIlSsB]+$/.test(c) ? fixDigits(c) : c;
    })
    .join("");
}

const IBAN_START = /(?<![A-Za-z0-9])[A-Z]{2}[ ]?[\dOoØøeIlSsBQ]{2}(?=[ \-‐‑‒–—]?[A-Za-z0-9Øø|])/g;

/** "IBAN" as a label, also as recognition reads it ("1BAN", "lBAN"). */
const IBAN_LABEL = /(?<![A-Za-z])[I1l|!]BAN(?![A-Za-z])(?:[ -]?(?:Nr|No|number|Nummer)(?![A-Za-z])\.?)?[ \t]*[:：=;.-]?[ \t]*/gi;
/** The beginning of a value after that label: a country code, alone or with its two check digits. */
const IBAN_HEAD = /^(?:[A-Za-z0-9]{2}$|[A-Za-z0-9]{2}[0-9OoØøeEIlSsBQZ]{2})/;

/**
 * What stands after the label "IBAN" is hidden whether its checksum is right or not: one wrongly recognized digit would
 * break the checksum, and made-up numbers (test data) never have one. Groups are taken up to the length of the country.
 */
function labelledIban(text: string, from: number): Match | null {
  const group = /[A-Za-z0-9Øøßæ|]+/y;
  const between = /[ \t]?[ \-‐‑‒–—][ \t]?/y;
  const length = IBAN_LENGTHS[text.slice(from, from + 2).toUpperCase()] ?? 34;
  let count = 0;
  let end = from;
  let at = from;
  while (count < length) {
    group.lastIndex = at;
    const g = group.exec(text)?.[0];
    if (!g || (count === 0 && !IBAN_HEAD.test(g))) break;
    // (a word without a single digit ends a number that is already long enough: "... 0130 00 Bank")
    if (count >= 12 && !/\d|^[OoØø]+$/.test(g)) break;
    count += g.length;
    end = at + g.length;
    between.lastIndex = end;
    const gap = between.exec(text)?.[0];
    if (!gap) break;
    at = end + gap.length;
  }
  const value = text.slice(from, end);
  const digits = (value.match(/[0-9OoØø]/g) ?? []).length;
  return count >= 12 && count <= 40 && digits >= 8 ? { kind: "iban", start: from, end, text: value } : null;
}

export function findIbans(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(IBAN_START)) {
    const start = m.index as number;
    const len = IBAN_LENGTHS[m[0].slice(0, 2)];
    if (len === undefined) continue;
    // Take exactly the right number of letters and digits, allowing one space or hyphen between groups.
    const gap = new RegExp(IBAN_GAP.source);
    let count = 0;
    let i = start;
    let end = start;
    while (i < text.length && count < len) {
      const ch = text[i];
      if (/[A-Za-z0-9Øø|]/.test(ch)) {
        count++;
        end = i + 1;
      } else if (!gap.test(ch) || gap.test(text[i - 1])) break;
      i++;
    }
    if (count !== len || /[A-Za-z0-9Øø]/.test(text[end] ?? "")) continue;
    const found = text.slice(start, end);
    if (isIban(found) || isIban(repairIban(found))) out.push({ kind: "iban", start, end, text: found });
  }
  for (const label of text.matchAll(IBAN_LABEL)) {
    const m = labelledIban(text, (label.index as number) + label[0].length);
    if (!m) continue;
    // The longer of the two readings of one place.
    const same = out.findIndex((o) => m.start < o.end && o.start < m.end);
    if (same < 0) out.push(m);
    else if (m.end - m.start > out[same].end - out[same].start) out[same] = m;
  }
  return out.sort((a, b) => a.start - b.start);
}

// --- passwords and secrets ----------------------------------------------------------

/** Labels (case-insensitive) after which a value is a secret: the 12 interface languages and common English ones. */
export const SECRET_LABELS_LATIN: readonly string[] = [
  "password", "passwort", "kennwort", "passwd", "pwd", "pw", "pin", "passcode", "passphrase", "pass phrase", "pass code",
  "api key", "api-key", "apikey", "api_key", "token", "access token", "auth token", "bearer token", "secret", "client secret",
  "secret key", "access key", "private key", "credential", "credentials", "geheimnis", "schlüssel", "schluessel",
  "contraseña", "contrasena", "clave", "clave secreta", "mot de passe", "motdepasse", "mdp", "code secret", "clé secrète",
  "parola", "codice segreto", "wachtwoord", "toegangscode", "hasło", "haslo", "şifre", "sifre",
];
export const SECRET_LABELS_OTHER: readonly string[] = [
  "密码", "密碼", "口令", "كلمة المرور", "كلمة السر", "كلمة السّر", "رمز المرور", "پاسورڈ", "پاس ورڈ", "خفیہ لفظ", "پن",
];

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Words recognition often reads with gaps between the letters ("pa s s word" in a wide typewriter font). */
const SPACED = new Set(["password", "passwort", "passwd", "passcode", "kennwort"]);
const flexible = (label: string) => (SPACED.has(label) ? [...label].join(" ?") : escapeRe(label).replace(/ /g, "\\s+"));
const byLength = (a: string, b: string) => b.length - a.length;
const SECRET_RE = new RegExp(
  "(?:(?<![\\p{L}\\p{N}_])(?:" +
    [...SECRET_LABELS_LATIN].sort(byLength).map(flexible).join("|") +
    ")|(?:" +
    [...SECRET_LABELS_OTHER].sort(byLength).map(flexible).join("|") +
    "))(?:[ \\t]*[:：=;]|[ \\t]+\\.(?=[ \\t]))[ \\t]*(\\S+)",
  "giu",
);

const SECRET_LABEL_RE = new RegExp(
  "(?:(?<![\\p{L}\\p{N}_])(?:" +
    [...SECRET_LABELS_LATIN].sort(byLength).map(flexible).join("|") +
    ")|(?:" +
    [...SECRET_LABELS_OTHER].sort(byLength).map(flexible).join("|") +
    "))[ \\t]*[:：=;]",
  "giu",
);

/** Where the labels of secrets and of IBANs stand in a line, with their separator (for what follows them in a picture, also
 * when it cannot be read). "IBM:", "IBNI:" or "IRQ' :" are what recognition makes of "IBAN:" in small type. */
export function findValueLabels(text: string): { kind: "secret" | "iban"; start: number; end: number }[] {
  const iban = /(?<![A-Za-z])(?:[I1l|!]BAN(?![A-Za-z])(?:[ \t]*[:：=;])?|[I1l|!](?:B(?:M|NI|N|AH|NJ|O[AÆ])|RQ'?)[ \t]*[:：])/gi;
  const of = (kind: "secret" | "iban", re: RegExp) => [...text.matchAll(re)].map((m) => ({ kind, start: m.index as number, end: (m.index as number) + m[0].length }));
  // A password label whose separator was not read, before a word that mixes digits with other signs.
  const bare = /(?<![\p{L}\p{N}_])(?:pa ?s ?s ?w ?o ?r ?d|passwort|kennwort|pwd)(?=[ \t]+(?=\S*\d)(?=\S*[A-Za-z$#!%&*?@])\S{6,})/giu;
  return [...of("iban", iban), ...of("secret", SECRET_LABEL_RE), ...of("secret", bare)];
}

/** An IBAN that recognition spoiled, for pictures only: a country code, then mostly digits between signs that no clean
 * reading has ("DE-69 37ø4 w44 632 ø13e", "DE-$91.111222233334444-55", "DES9111122223333444455" for "DE89…"). */
export function findGarbledIbans(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Z]{2})[ .-]{0,2}(?:[0-9OØø$]|[SBE](?=[0-9OØøSE]?[ .-]?\d))[0-9A-Za-z$§Øøßæ|!.,' -]{10,40}[0-9OØøWU]/g)) {
    if (IBAN_LENGTHS[m[1]] === undefined) continue;
    const body = m[0].slice(2).replace(/[ .,'-]/g, "");
    const digits = (body.match(/\d/g) ?? []).length;
    // (a clean reading is judged by its check digits; at least six of ten signs must be digits)
    if (digits >= 12 && digits * 10 >= body.length * 6 && /\D/.test(body)) out.push({ kind: "iban", start: m.index as number, end: (m.index as number) + m[0].length, text: m[0] });
  }
  return out;
}



/** The value after a label (`Password: hunter2`), not the label. Same line, one word. */
export function findSecrets(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(SECRET_RE)) {
    const raw = m[1];
    // Quotes around the value stay out of the box.
    const lead = /^["'“”‘’«»]+/.exec(raw)?.[0].length ?? 0;
    const value = raw.slice(lead).replace(/["'“”‘’«»,;]+$/, "");
    // (what Quick redact already hid is not found again)
    if (!value || /^•+$/.test(value)) continue;
    const end = (m.index as number) + m[0].length;
    const start = end - raw.length + lead;
    out.push({ kind: "secret", start, end: start + value.length, text: value });
  }
  return out;
}

/** Is this the name of a field that holds a secret ("Password", "Kennwort", "API key")? */
export function isSecretLabel(name: string): boolean {
  const low = name.trim().toLowerCase();
  if (!low) return false;
  const latin = SECRET_LABELS_LATIN.some((l) => new RegExp(`(?<![\\p{L}\\p{N}_])${flexible(l)}(?![\\p{L}\\p{N}_])`, "u").test(low));
  return latin || SECRET_LABELS_OTHER.some((l) => low.includes(l));
}

// --- the user's own words ---------------------------------------------------------------

export interface CustomWords {
  words: readonly string[];
  wholeWord: boolean;
}

export function findCustom(text: string, custom: CustomWords): Match[] {
  const out: Match[] = [];
  for (const raw of custom.words) {
    const w = raw.trim();
    if (!w) continue;
    const body = escapeRe(w);
    const re = new RegExp(custom.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, "giu");
    for (const m of text.matchAll(re)) out.push({ kind: "custom", start: m.index as number, end: (m.index as number) + m[0].length, text: m[0] });
  }
  return out;
}
