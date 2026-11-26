// What can be dropped into the capture list (no React, no IPC), so it can be unit tested.

/** The image types that are added to the session (the backend decodes them; GIF gives its first frame). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif"] as const;
const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/x-ms-bmp", "image/gif"];
/** Types a browser or Windows reports for a file it does not know: the extension decides then. */
const UNKNOWN_MIME = ["", "application/octet-stream"];

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export interface FileLike {
  name: string;
  type: string;
}

/** A file the capture list takes: a known image type, or an unknown type with an image extension. */
export function isSupportedImage(file: FileLike): boolean {
  const mime = file.type.toLowerCase();
  if (IMAGE_MIME.includes(mime)) return true;
  if (UNKNOWN_MIME.includes(mime)) return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
  return false;
}

/** Does a drag carry something the capture list could use? `types` is `dataTransfer.types`. */
export function isImportDrag(types: readonly string[]): boolean {
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html");
}

export interface DropContent<F extends FileLike = FileLike> {
  files: readonly F[];
  /** `text/uri-list` of the drop. */
  uriList: string;
  /** `text/html` of the drop (a browser puts the `<img>` there). */
  html: string;
}

export type DropPlan<F extends FileLike = FileLike> =
  /** Files to add: `accepted` in their dropped order, `skipped` that are not supported images. */
  | { kind: "files"; accepted: F[]; skipped: number }
  /** Only an address came along (an image dragged from a web page that gave no file): nothing is downloaded. */
  | { kind: "url"; urls: string[] }
  | { kind: "none" };

/** The http(s) addresses in a drop, from the uri list and from the `src` of images in dragged HTML. */
export function webUrls(content: Pick<DropContent, "uriList" | "html">): string[] {
  const urls = new Set<string>();
  for (const line of content.uriList.split(/\r?\n/)) {
    const l = line.trim();
    if (/^https?:\/\//i.test(l)) urls.add(l);
  }
  for (const m of content.html.matchAll(/<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) urls.add(m[1]);
  return [...urls];
}

/** What to do with a drop: add its files, tell the user to save the picture first, or ignore it. */
export function planDrop<F extends FileLike>(content: DropContent<F>): DropPlan<F> {
  if (content.files.length > 0) {
    const accepted = content.files.filter(isSupportedImage);
    return { kind: "files", accepted, skipped: content.files.length - accepted.length };
  }
  const urls = webUrls(content);
  return urls.length > 0 ? { kind: "url", urls } : { kind: "none" };
}
