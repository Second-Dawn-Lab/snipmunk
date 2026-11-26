// Copy, save, share, drag and edit-in-Paint of captures: render with the shared renderer, stage in the backend's temp
// folder, hand over. Captures are rendered one after the other so a big selection does not hold all pictures in memory.
import type { Ctx } from "../annotate/render";
import { ipc, type Capture, type Group, type Session } from "../ipc";
import type { CopyMode, Naming, SaveFormat } from "../settings/defaults";
import { cfHtml, imagesHtml, planCopy, tempFileNames } from "./clipboardPayload";
import { exportNames, FORMAT_EXT, FORMAT_MIME, sanitizeName, dateTimeName } from "./fileNames";
import { canvasBlob, drawCapture, finalSize, renderCapture } from "./renderCapture";

export type CopyOutcome =
  | { status: "ok"; count: number; mode: CopyMode; /** The picture was too large for a bitmap on the clipboard (PNG and file only). */ limited?: boolean }
  | { status: "tooLarge"; mode: "stack" | "grid"; width: number; height: number };

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Put captures on the clipboard in a mode. A composed picture that would be extremely large is not made (`tooLarge`). */
export async function copyCaptures(session: Session, captures: readonly Capture[], mode: CopyMode): Promise<CopyOutcome> {
  const plan = planCopy(mode, captures.map(finalSize));
  if (plan.kind === "tooLarge") return { status: "tooLarge", mode: plan.mode, width: plan.width, height: plan.height };
  await ipc.exportBegin("copy");
  if (plan.kind === "separate") {
    const names = tempFileNames(captures.map((c) => c.name));
    const staged: { path: string; width: number; height: number; alt: string }[] = [];
    for (const [i, c] of captures.entries()) {
      const canvas = await renderCapture(session, c);
      const size = { width: canvas.width, height: canvas.height };
      const path = await ipc.exportStage("copy", names[i], await canvasBlob(canvas, "image/png"));
      release(canvas);
      staged.push({ path, ...size, alt: c.name });
    }
    // The file list lets chats and Explorer take every picture; Outlook turns files into attachments, so without it
    // (Settings, Copy & paste) the pictures come in the body from the HTML.
    // The pictures and the files on the clipboard (chats, Word, Paint, Explorer).
    const limited = await ipc.exportClipboard(
      staged.map((s) => s.path),
      cfHtml(imagesHtml(staged)),
      staged[0].path,
    );
    return { status: "ok", count: captures.length, mode: "separate", limited };
  }
  const canvas = document.createElement("canvas");
  canvas.width = plan.layout.width;
  canvas.height = plan.layout.height;
  const ctx = canvas.getContext("2d") as Ctx;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const p of plan.layout.items) await drawCapture(session, captures[p.index], ctx, p.x, p.y);
  const width = canvas.width;
  const height = canvas.height;
  const path = await ipc.exportStage("copy", `${plan.mode === "stack" ? "Stack" : "Grid"}.png`, await canvasBlob(canvas, "image/png"));
  release(canvas);
  const limited = await ipc.exportClipboard([path], cfHtml(imagesHtml([{ path, width, height, alt: plan.mode }])), path);
  return { status: "ok", count: captures.length, mode: plan.mode, limited };
}

export interface SaveOptions {
  format: SaveFormat;
  naming: Naming;
  /** 10 to 100, for JPEG and WebP. */
  quality: number;
  folder: string;
  /** "Screenshot" in the user's language, for the "Date and time" names. */
  dateTimePrefix: string;
}

/** Save captures as files in a folder. Existing files are never replaced. Returns the paths. */
export async function saveCaptures(session: Session, group: Pick<Group, "name">, captures: readonly Capture[], o: SaveOptions): Promise<string[]> {
  await ipc.exportBegin("save");
  const scheme = { naming: o.naming, groupName: group.name, dateTimePrefix: o.dateTimePrefix };
  const innerExt = o.format === "zip" ? "png" : FORMAT_EXT[o.format];
  const names = exportNames(captures, innerExt, scheme);
  const staged: string[] = [];
  for (const [i, c] of captures.entries()) {
    const canvas = await renderCapture(session, c);
    let blob: Blob;
    if (o.format === "jpeg" || o.format === "webp") blob = await canvasBlob(canvas, FORMAT_MIME[o.format], o.quality / 100);
    else blob = await canvasBlob(canvas, "image/png");
    release(canvas);
    staged.push(await ipc.exportStage("save", names[i], blob, o.format === "bmp" ? "bmp" : undefined));
  }
  if (o.format === "zip") {
    const stamp = dateTimeName(captures[0]?.createdAt ?? Date.now(), sanitizeName(group.name, "Snipmunk"));
    return [await ipc.exportZip(staged, names, o.folder, `${stamp}.zip`)];
  }
  return ipc.exportSave(staged, names, o.folder);
}

/** Render one capture into a temp PNG and open it in Paint (nothing comes back). */
export async function editInPaint(session: Session, c: Capture): Promise<void> {
  await ipc.exportBegin("paint");
  const canvas = await renderCapture(session, c);
  const path = await ipc.exportStage("paint", `${sanitizeName(c.name)}.png`, await canvasBlob(canvas, "image/png"));
  release(canvas);
  await ipc.exportOpenEditor(path);
}

/** Render captures into temp PNGs and show the Windows share sheet. */
export async function shareCaptures(session: Session, captures: readonly Capture[]): Promise<void> {
  const paths = await stageAll("share", session, captures);
  await ipc.exportShare(paths);
}

/** Render captures into temp PNGs (for a native drag, or to share). */
export async function stageAll(kind: "share" | "drag", session: Session, captures: readonly Capture[]): Promise<string[]> {
  await ipc.exportBegin(kind);
  const names = tempFileNames(captures.map((c) => c.name));
  const out: string[] = [];
  for (const [i, c] of captures.entries()) {
    const canvas = await renderCapture(session, c);
    out.push(await ipc.exportStage(kind, names[i], await canvasBlob(canvas, "image/png")));
    release(canvas);
  }
  return out;
}
