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
const CONFUSED: Readonly<Record<string, string>> = { O: "0", o: "0", Ø: "0", ø: "0", I: "1", l: "1", "|": "1", S: "5", B: "8" };
const CONFUSABLE = /[OoØøIl|SB]/g;
const fixDigits = (s: string) => s.replace(CONFUSABLE, (c) => CONFUSED[c]);

/** Digits, and the letters recognition mixes them up with (O o I l | S B); the checksum decides whether it is a card. */
const CARD_CANDIDATE = /(?<![\w|-])[\dOoØøIl|SB](?:[ -]?[\dOoØøIl|SB]){12,18}(?![\w|-])/g;

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

/** Is this an IBAN (with or without spaces): the country, its length and the check digits are right? */
export function isIban(raw: string): boolean {
  const compact = raw.replace(/ /g, "").toUpperCase();
  const len = IBAN_LENGTHS[compact.slice(0, 2)];
  return len !== undefined && compact.length === len && ibanChecksum(compact);
}

/** An IBAN with the typical recognition mistakes repaired in its digit places (the check digits, and groups that are mostly digits). */
export function repairIban(found: string): string {
  const spaced = found.includes(" ");
  const chunks = spaced ? found.split(" ") : (found.match(/.{1,4}/g) ?? []);
  const fixed = chunks.map((c, i) => {
    if (i === 0) return c.slice(0, 2) + fixDigits(c.slice(2));
    // A group of only digits and look-alike letters is a group of digits; a group with real letters (WEST, ABNA) is left alone.
    return /^[\dOoØøIlSB]+$/.test(c) ? fixDigits(c) : c;
  });
  return fixed.join(spaced ? " " : "");
}

const IBAN_START = /(?<![A-Za-z0-9])[A-Z]{2}[\dOoØøIlSB]{2}(?=[ ]?[A-Za-z0-9Øø])/g;

export function findIbans(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(IBAN_START)) {
    const start = m.index as number;
    const len = IBAN_LENGTHS[m[0].slice(0, 2)];
    if (len === undefined) continue;
    // Take exactly the right number of letters and digits, allowing single spaces between groups.
    let count = 0;
    let i = start;
    let end = start;
    while (i < text.length && count < len) {
      const ch = text[i];
      if (/[A-Za-z0-9Øø]/.test(ch)) {
        count++;
        end = i + 1;
      } else if (ch !== " " || text[i - 1] === " ") break;
      i++;
    }
    if (count !== len || /[A-Za-z0-9Øø]/.test(text[end] ?? "")) continue;
    const found = text.slice(start, end);
    if (isIban(found) || isIban(repairIban(found))) out.push({ kind: "iban", start, end, text: found });
  }
  return out;
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

const flexible = (label: string) => escapeRe(label).replace(/ /g, "\\s+");
const byLength = (a: string, b: string) => b.length - a.length;
const SECRET_RE = new RegExp(
  "(?:(?<![\\p{L}\\p{N}_])(?:" +
    [...SECRET_LABELS_LATIN].sort(byLength).map(flexible).join("|") +
    ")|(?:" +
    [...SECRET_LABELS_OTHER].sort(byLength).map(flexible).join("|") +
    "))[ \\t]*[:：=][ \\t]*(\\S+)",
  "giu",
);

/** The value after a label (`Password: hunter2`), not the label. Same line, one word. */
export function findSecrets(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(SECRET_RE)) {
    const raw = m[1];
    // Quotes around the value stay out of the box.
    const lead = /^["'“”‘’«»]+/.exec(raw)?.[0].length ?? 0;
    const value = raw.slice(lead).replace(/["'“”‘’«»,;]+$/, "");
    if (!value) continue;
    const end = (m.index as number) + m[0].length;
    const start = end - raw.length + lead;
    out.push({ kind: "secret", start, end: start + value.length, text: value });
  }
  return out;
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
