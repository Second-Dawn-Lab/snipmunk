// File names for saved captures (no React): naming schemes, Windows-safe names, unique names in a folder.

import type { Naming, SaveFormat } from "../settings/defaults";

export type { Naming, SaveFormat };

export const FORMAT_EXT: Readonly<Record<SaveFormat, string>> = { png: "png", jpeg: "jpg", webp: "webp", bmp: "bmp", zip: "zip" };
export const FORMAT_MIME: Readonly<Record<Exclude<SaveFormat, "zip" | "bmp">, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Characters Windows does not allow in a file name, and control characters. */
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;
export const MAX_NAME = 120;

/** A name Windows accepts: no invalid characters, no reserved device names, no trailing dots or spaces, not too long. */
export function sanitizeName(name: string, fallback = "Capture"): string {
  let s = name.replace(INVALID, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/, "").replace(/^\.+/, "");
  // A reserved name is reserved with any extension too (CON.txt), so the part before the first dot decides.
  if (RESERVED.test(s.split(".")[0].trim())) s = `_${s}`;
  if ([...s].length > MAX_NAME) s = [...s].slice(0, MAX_NAME).join("").trim().replace(/[. ]+$/, "");
  return s || fallback;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "2026-11-18 205928" in local time. */
export function dateTimeName(ms: number, prefix = "Screenshot"): string {
  const d = new Date(ms);
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export interface NameInput {
  name: string;
  createdAt: number;
}

export interface NameContext {
  naming: Naming;
  groupName: string;
  /** Position in the saved list (0 based) and the count, for the zero-padded number. */
  index: number;
  count: number;
  /** Used for "Date and time"; "Screenshot" in English, translated by the caller. */
  dateTimePrefix?: string;
}

/** The file name (without extension) a capture gets under a naming scheme. */
export function baseName(c: NameInput, ctx: NameContext): string {
  switch (ctx.naming) {
    case "capture":
      return sanitizeName(c.name);
    case "group": {
      const width = Math.max(2, String(ctx.count).length);
      return sanitizeName(`${ctx.groupName} - ${pad(ctx.index + 1, width)} - ${c.name}`);
    }
    case "dateTime":
      return sanitizeName(dateTimeName(c.createdAt, ctx.dateTimePrefix ?? "Screenshot"));
  }
}

/** "name.png", or "name (2).png" when the name is taken (`taken` compares case-insensitively like Windows). */
export function uniqueName(base: string, ext: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  let n = 1;
  let file = `${base}.${ext}`;
  while (lower.has(file.toLowerCase())) {
    n++;
    file = `${base} (${n}).${ext}`;
  }
  return file;
}

/**
 * Names for a whole export: the scheme applied to each capture, and the conflicts inside the batch and with the files that
 * are already in the folder resolved with " (2)", " (3)".
 */
export function exportNames(
  captures: readonly NameInput[],
  ext: string,
  scheme: Pick<NameContext, "naming" | "groupName" | "dateTimePrefix">,
  existing: Iterable<string> = [],
): string[] {
  const taken = new Set(existing);
  return captures.map((c, index) => {
    const file = uniqueName(baseName(c, { ...scheme, index, count: captures.length }), ext, taken);
    taken.add(file);
    return file;
  });
}
