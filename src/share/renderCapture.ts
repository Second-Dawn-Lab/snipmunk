// Draws a capture as everything that leaves the app shows it (needs a canvas): the stored picture with its crop, rotation,
// flip, marks and redactions (the redacted pixels are replaced, not covered), through the same renderer as the preview.
import { prepareWork, renderDoc, workKey, type Ctx, type WorkCanvas } from "../annotate/render";
import { migrate } from "../annotate/schema";
import { docGeometry } from "../annotate/transform";
import { imageUrl, type Capture, type Session } from "../ipc";
import type { Size } from "./compose";

function makeCanvas(w: number, h: number): WorkCanvas {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** The size of a capture as it is shown and copied (crop and rotation applied). */
export function finalSize(c: Capture): Size {
  const g = docGeometry(migrate(c.annotations ?? null), c.width, c.height);
  return { w: Math.max(1, Math.round(g.width)), h: Math.max(1, Math.round(g.height)) };
}

async function loadBitmap(session: Session, c: Capture): Promise<ImageBitmap> {
  const res = await fetch(imageUrl(session, c), { cache: "no-store" });
  if (!res.ok) throw { code: "io", message: `the picture of "${c.name}" could not be read` };
  return createImageBitmap(await res.blob());
}

/** Draw the capture with its top left corner at (x, y). */
export async function drawCapture(session: Session, c: Capture, ctx: Ctx, x = 0, y = 0): Promise<void> {
  const bitmap = await loadBitmap(session, c);
  try {
    const doc = migrate(c.annotations ?? null);
    const W = bitmap.width;
    const H = bitmap.height;
    const src = workKey(doc.items) === "" ? bitmap : (prepareWork(makeCanvas, bitmap, W, H, doc.items) as unknown as CanvasImageSource);
    ctx.save();
    ctx.translate(x, y);
    renderDoc(ctx, src, W, H, doc, 1);
    ctx.restore();
  } finally {
    bitmap.close();
  }
}

/** The capture on its own canvas. */
export async function renderCapture(session: Session, c: Capture): Promise<HTMLCanvasElement> {
  const { w, h } = finalSize(c);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  await drawCapture(session, c, canvas.getContext("2d") as Ctx);
  return canvas;
}

/** Encode a canvas. JPEG has no transparency, so it is drawn on white first. */
export async function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  let source = canvas;
  if (mime === "image/jpeg") {
    source = document.createElement("canvas");
    source.width = canvas.width;
    source.height = canvas.height;
    const ctx = source.getContext("2d") as Ctx;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.drawImage(canvas, 0, 0);
  }
  const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, mime, quality));
  if (!blob) throw { code: "io", message: "the picture could not be encoded" };
  return blob;
}
