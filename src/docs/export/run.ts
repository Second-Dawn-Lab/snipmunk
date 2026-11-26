// Making an export: the choices, the data (pictures and template), and writing the files of each format.

import { strToU8, zipSync } from "fflate";
import { ipc, type GuideStep } from "../../ipc";
import type { Block, GuideDoc } from "../model";
import { applyTemplate, templateOf } from "../template/apply";
import type { Template } from "../template/model";
import { exportHtml, type ExportData } from "./html";
import { exportMarkdown } from "./markdown";
import { paginate, printHtml } from "./paginate";
import { collectPictures } from "./pictures";

export type Format = "pdf" | "docx" | "md" | "html";

export interface Choices {
  format: Format;
  cover: boolean;
  toc: boolean;
  numbers: boolean;
  descriptions: boolean;
  markers: boolean;
  annotations: boolean;
  /** `null`: the template's own. */
  pageSize: "a4" | "letter" | null;
  orientation: "portrait" | "landscape" | null;
  /** `null`: PNG; else the JPEG quality (PDF and Word only). */
  jpeg: number | null;
  mdSteps: "list" | "headings";
  mdFrontMatter: boolean;
  mdZip: boolean;
  openAfter: boolean;
}

export const DEFAULT_CHOICES: Choices = {
  format: "pdf",
  cover: false,
  toc: false,
  numbers: true,
  descriptions: true,
  markers: true,
  annotations: true,
  pageSize: null,
  orientation: null,
  jpeg: null,
  mdSteps: "list",
  mdFrontMatter: false,
  mdZip: false,
  openAfter: false,
};

/** The remembered choices, completed with the defaults. */
export function readChoices(text: string | null): Choices {
  try {
    const v = JSON.parse(text ?? "{}") as Partial<Choices>;
    const out = { ...DEFAULT_CHOICES };
    for (const k of Object.keys(out) as (keyof Choices)[]) if (k in v && (v[k] === null || typeof v[k] === typeof out[k] || out[k] === null)) (out as Record<string, unknown>)[k] = v[k];
    return out;
  } catch {
    return DEFAULT_CHOICES;
  }
}

/** The words and the language an export is written in. */
export interface Locale {
  lang: string;
  rtl: boolean;
  contents: string;
  /** "Page {n} of {of}". */
  pagePattern: string;
  /** "Step {n}". */
  stepPattern: string;
  date: string;
}

export interface Source {
  doc: GuideDoc;
  steps: ReadonlyMap<number, GuideStep>;
}

/** The guide as it is exported: with another template when one is chosen for this export, and its page size and orientation. */
export function exportDoc(source: Source, template: Template | null, c: Pick<Choices, "pageSize" | "orientation">): GuideDoc {
  let doc = template ? applyTemplate(source.doc, template) : source.doc;
  if (c.pageSize || c.orientation) {
    const t = JSON.parse(JSON.stringify(templateOf(doc))) as Template;
    if (c.pageSize) t.page.size = c.pageSize;
    if (c.orientation) t.page.orientation = c.orientation;
    doc = { ...doc, template: t };
  }
  return doc;
}

export async function buildData(
  source: Source,
  doc: GuideDoc,
  c: Choices,
  locale: Locale,
  progress?: (done: number, of: number) => void,
  signal?: AbortSignal,
): Promise<ExportData> {
  // Only PDF and Word may use the smaller JPEG pictures.
  const jpeg = c.format === "pdf" || c.format === "docx" ? c.jpeg : null;
  const pictures = await collectPictures(doc, doc.blocks, source.steps, { markers: c.markers, annotations: c.annotations, jpeg }, progress, signal);
  return {
    doc,
    steps: source.steps,
    template: templateOf(doc),
    pictures,
    options: { cover: c.cover, toc: c.toc, numbers: c.numbers, descriptions: c.descriptions },
    lang: locale.lang,
    rtl: locale.rtl,
    words: { contents: locale.contents, page: (n, of) => locale.pagePattern.replace("{n}", String(n)).replace("{of}", String(of)) },
    date: locale.date,
  };
}

export function base64Of(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const textBase64 = (text: string) => base64Of(new TextEncoder().encode(text));
const dataBytes = (url: string): Uint8Array => Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));

/** The Markdown text and the picture files that go next to it (in the folder `folder`). */
export function markdownFiles(d: ExportData, c: Pick<Choices, "mdSteps" | "mdFrontMatter">, locale: Locale, folder: string): { text: string; files: { name: string; data: Uint8Array }[] } {
  const files = new Map<string, { name: string; data: Uint8Array }>();
  let images = 0;
  const numbers = new Map<string, number>();
  d.doc.blocks.filter((b: Block) => b.type === "step").forEach((b, i) => numbers.set(b.id, i + 1));
  const text = exportMarkdown(d, {
    steps: c.mdSteps,
    frontMatter: c.mdFrontMatter,
    stepWord: (n) => locale.stepPattern.replace("{n}", String(n)),
    image: (key) => {
      const found = d.pictures.get(key);
      // (Markdown shows one picture: with callouts around it, the one of everything)
      const img = found?.whole ?? found;
      if (!img) return null;
      let f = files.get(key);
      if (!f) {
        const ext = img.src.startsWith("data:image/jpeg") ? "jpg" : "png";
        const name = numbers.has(key) ? `step-${String(numbers.get(key)).padStart(2, "0")}.${ext}` : `image-${String(++images).padStart(2, "0")}.${ext}`;
        files.set(key, (f = { name, data: dataBytes(img.src) }));
      }
      return `${folder}/${f.name}`;
    },
  });
  return { text, files: [...files.values()] };
}

/** The extension of the file an export writes. */
export const extensionOf = (c: Pick<Choices, "format" | "mdZip">): string => (c.format === "md" && c.mdZip ? "zip" : c.format);

/** Write the export to `path`; returns the number of bytes of the main file. */
export async function writeExport(path: string, d: ExportData, c: Choices, locale: Locale, signal?: AbortSignal): Promise<number> {
  const stop = () => {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
  };
  stop();
  if (c.format === "html") return ipc.exportWrite(path, textBase64(exportHtml(d)));
  if (c.format === "docx") {
    // The Word writer (and the library it uses) is loaded only when a Word file is made.
    const { exportDocx } = await import("./docx");
    const data = await exportDocx(d, { pagePattern: locale.pagePattern });
    stop();
    return ipc.exportWrite(path, data);
  }
  if (c.format === "pdf") {
    const pages = await paginate(d);
    stop();
    return ipc.exportPdf(printHtml(d, pages), path, pages.box.w, pages.box.h);
  }
  const slash = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const dir = path.slice(0, slash + 1);
  const base = path.slice(slash + 1).replace(/\.(md|zip)$/i, "");
  const folder = `${base}_images`;
  const md = markdownFiles(d, c, locale, folder);
  if (c.mdZip) {
    const entries: Record<string, Uint8Array> = { [`${base}.md`]: strToU8(md.text) };
    for (const f of md.files) entries[`${folder}/${f.name}`] = f.data;
    // The pictures are compressed already.
    return ipc.exportWrite(path, base64Of(zipSync(entries, { level: 0 })));
  }
  for (const f of md.files) {
    stop();
    await ipc.exportWrite(`${dir}${folder}\\${f.name}`, base64Of(f.data));
  }
  return ipc.exportWrite(path, textBase64(md.text));
}
