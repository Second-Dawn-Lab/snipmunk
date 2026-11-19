// Gallery search matching (no React): text is folded so that case, accents, Arabic spelling variants and full-width forms
// do not matter, and a search matches when every word of the query is found in the text (CJK: as a substring).

const SPECIAL: Readonly<Record<string, string>> = {
  ß: "ss", ẞ: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ł: "l", ı: "i", ħ: "h",
  // Arabic: alef with hamza or madda, wasla -> alef; alef maqsura -> yeh; hamza carriers -> their letter; teh marbuta -> heh.
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ؤ": "و", "ئ": "ي", "ة": "ه",
  // Persian / Urdu forms of yeh, kaf and heh look like the Arabic ones.
  "ی": "ي", "ې": "ي", "ے": "ي", "ک": "ك", "ہ": "ه", "ھ": "ه", "ۃ": "ه",
  // Arabic-Indic and extended digits -> ASCII.
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Tatweel and every combining mark (accents, Arabic harakat) are dropped. */
const DROP = /[ـ\p{M}]/gu;

/** Fold a text for comparing: lower case, without accents, diacritics and tatweel, Arabic variants unified, NFKC for width. */
export function normalize(text: string): string {
  let s = text.normalize("NFKD").replace(DROP, "").toLowerCase();
  let out = "";
  for (const ch of s) out += SPECIAL[ch] ?? ch;
  s = out;
  return s.replace(/\s+/g, " ").trim();
}

/** The words of a query, folded. An empty query has no terms. */
export function queryTerms(query: string): string[] {
  const n = normalize(query);
  return n ? n.split(" ") : [];
}

/** Does the (already folded) text contain every term? */
export function matchesAll(folded: string, terms: readonly string[]): boolean {
  return terms.length > 0 && terms.every((t) => folded.includes(t));
}
