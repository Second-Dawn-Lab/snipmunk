// Fills in {placeholders} and picks the plural form of a message.
//
// A plural looks like  "{count, plural, one {# capture} other {# captures}}"  and may sit inside a longer
// sentence. The forms are the CLDR plural categories of the language (zero, one, two, few, many, other); `other`
// is required and is used for any category a language does not spell out. `#` is the number. Placeholders such
// as {name} also work inside a form. Arabic has six forms, Polish four, German two, Chinese one.

export type Vars = Record<string, string | number>;

const PLURAL = /\{(\w+),\s*plural,\s*((?:\w+\s*\{(?:[^{}]|\{\w+\})*\}\s*)+)\}/g;
const FORM = /(\w+)\s*\{((?:[^{}]|\{\w+\})*)\}/g;

const rules = new Map<string, Intl.PluralRules>();
function categoryOf(locale: string, n: number): string {
  let r = rules.get(locale);
  if (!r) {
    r = new Intl.PluralRules(locale);
    rules.set(locale, r);
  }
  return r.select(n);
}

function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole));
}

export function formatMessage(template: string, vars: Vars | undefined, locale: string): string {
  if (!vars) return template;
  const withPlurals = template.replace(PLURAL, (whole, name: string, body: string) => {
    const n = Number(vars[name]);
    if (!Number.isFinite(n)) return whole;
    const forms = new Map<string, string>();
    for (const m of body.matchAll(FORM)) forms.set(m[1], m[2]);
    const chosen = forms.get(categoryOf(locale, n)) ?? forms.get("other") ?? "";
    return chosen.replace(/#/g, String(n));
  });
  return fill(withPlurals, vars);
}

/** For each plural in a message, the categories it spells out, e.g. [["one", "other"]]. */
export function pluralCategories(template: string): string[][] {
  return [...template.matchAll(PLURAL)].map((block) =>
    [...block[2].matchAll(FORM)].map((m) => m[1]),
  );
}

/** The categories a language's plurals use, in a fixed order. */
export function localeCategories(locale: string): string[] {
  const all: string[] = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  return ["zero", "one", "two", "few", "many", "other"].filter((c) => all.includes(c));
}
