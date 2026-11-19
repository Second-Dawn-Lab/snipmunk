// What goes on the clipboard when captures are copied (no React): the plan for a mode, the HTML for the images and the
// "HTML Format" clipboard text around it.
import { layoutFor, tooLarge, type Composition, type Size } from "./compose";
import { sanitizeName, uniqueName } from "./fileNames";
import type { CopyMode } from "../settings/defaults";

export type CopyPlan =
  /** Each capture is its own picture: files + HTML + the first picture as a bitmap. */
  | { kind: "separate"; count: number }
  /** One composed picture. */
  | { kind: "composed"; mode: "stack" | "grid"; layout: Composition; count: number }
  /** The composed picture would be extremely large: ask for Separate instead. */
  | { kind: "tooLarge"; mode: "stack" | "grid"; width: number; height: number; count: number };

/** What to do for `count` captures of these sizes in this mode. One capture is always just itself. */
export function planCopy(mode: CopyMode, sizes: readonly Size[]): CopyPlan {
  const count = sizes.length;
  if (mode === "separate" || count <= 1) return { kind: "separate", count };
  const layout = layoutFor(mode, sizes);
  if (tooLarge(layout.width, layout.height)) return { kind: "tooLarge", mode, width: layout.width, height: layout.height, count };
  return { kind: "composed", mode, layout, count };
}

/** `C:\Users\Me\a b.png` as a file address. */
export function fileUrl(path: string): string {
  const p = path.replace(/\\/g, "/");
  const encoded = p
    .split("/")
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join("/");
  return `file:///${encoded}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An HTML fragment with every picture, for Word, Outlook and Google Docs (they take the pictures from the file addresses). */
export function imagesHtml(items: readonly { path: string; width: number; height: number; alt: string }[]): string {
  return items.map((i) => `<p><img src="${esc(fileUrl(i.path))}" width="${i.width}" height="${i.height}" alt="${esc(i.alt)}"></p>`).join("\n");
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** The text of the "HTML Format" clipboard format: a header with byte offsets, then the page with the fragment marked. */
export function cfHtml(fragment: string): string {
  const pre = "<html><body>\r\n<!--StartFragment-->";
  const post = "<!--EndFragment-->\r\n</body></html>";
  const header = (a: number, b: number, c: number, d: number) =>
    `Version:0.9\r\nStartHTML:${String(a).padStart(10, "0")}\r\nEndHTML:${String(b).padStart(10, "0")}\r\nStartFragment:${String(c).padStart(10, "0")}\r\nEndFragment:${String(d).padStart(10, "0")}\r\n`;
  const headLen = utf8Len(header(0, 0, 0, 0));
  const startHtml = headLen;
  const startFragment = headLen + utf8Len(pre);
  const endFragment = startFragment + utf8Len(fragment);
  const endHtml = endFragment + utf8Len(post);
  return header(startHtml, endHtml, startFragment, endFragment) + pre + fragment + post;
}

/** The names the files get on the clipboard and in the drag: one per capture, unique, in order. */
export function tempFileNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((n) => {
    const file = uniqueName(sanitizeName(n), "png", taken);
    taken.add(file);
    return file;
  });
}
