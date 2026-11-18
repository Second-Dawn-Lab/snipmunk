// Default names of new groups ("Group 2", "Gruppe 2", "المجموعة ٢"), no React, so it can be unit tested.
//
// A new group gets the lowest number that no group with a default name uses. Only groups that still have a default name
// count: a renamed group is ignored, even when its new name happens to contain a number.

const DIGITS = "0-9٠-٩۰-۹"; // Latin, Arabic-Indic and Persian digits

/** The value of a string of digits in any of the three digit systems. */
export function digitsToNumber(digits: string): number | null {
  if (!new RegExp(`^[${DIGITS}]+$`).test(digits)) return null;
  let n = 0;
  for (const ch of digits) {
    const c = ch.charCodeAt(0);
    const d = c >= 0x6f0 ? c - 0x6f0 : c >= 0x660 ? c - 0x660 : c - 0x30;
    n = n * 10 + d;
  }
  return n;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The number in a default group name, or `null` for a name that is not one. `templates` are the default-name patterns of
 * every language ("Group {number}", "Gruppe {number}"), so a group made in German still counts after the interface
 * changed to English.
 */
export function defaultGroupNumber(name: string, templates: readonly string[]): number | null {
  for (const template of templates) {
    const [before, after] = template.split("{number}");
    if (after === undefined) continue;
    const m = new RegExp(`^${escape(before)}([${DIGITS}]+)${escape(after)}$`).exec(name);
    if (!m) continue;
    const n = digitsToNumber(m[1]);
    // "Group 0" and "Group 01" are not what the app makes.
    if (n !== null && n >= 1 && !/^[0٠۰]/.test(m[1])) return n;
  }
  return null;
}

/** The lowest number from 1 that no group with a default name has. */
export function lowestFreeNumber(names: readonly string[], templates: readonly string[]): number {
  const used = new Set<number>();
  for (const name of names) {
    const n = defaultGroupNumber(name, templates);
    if (n !== null) used.add(n);
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** "Group 2" for the language of `locale`: `template` is that language's "Group {number}", digits as the language writes them. */
export function nextGroupName(
  names: readonly string[],
  template: string,
  locale: string,
  allTemplates: readonly string[],
): string {
  const n = lowestFreeNumber(names, [template, ...allTemplates]);
  let shown: string;
  try {
    shown = new Intl.NumberFormat(locale, { useGrouping: false }).format(n);
  } catch {
    shown = String(n);
  }
  return template.replace("{number}", shown);
}
