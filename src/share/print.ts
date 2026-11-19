// Print captures with the system print dialog: one capture per page, fitted to the page with its aspect ratio kept, wide
// captures on a landscape page.
import { renderCapture, canvasBlob } from "./renderCapture";
import type { Capture, Session } from "../ipc";

/** CSS for the print page: only the print root is shown, each picture on its own page. */
export const PRINT_CSS = `
@page { margin: 10mm; }
@page wide { size: landscape; margin: 10mm; }
@page tall { size: portrait; margin: 10mm; }
@media screen { #snipmunk-print { display: none; } }
@media print {
  body > *:not(#snipmunk-print) { display: none !important; }
  #snipmunk-print { display: block; }
  #snipmunk-print .pp { break-after: page; page-break-after: always; display: flex; align-items: center; justify-content: center; height: 100vh; }
  #snipmunk-print .pp:last-child { break-after: auto; page-break-after: auto; }
  #snipmunk-print .pp.wide { page: wide; }
  #snipmunk-print .pp.tall { page: tall; }
  #snipmunk-print img { max-width: 100%; max-height: 100%; object-fit: contain; }
}`;

/** Is a picture wide (printed on a landscape page)? */
export const isWide = (w: number, h: number) => w > h;

export async function printCaptures(session: Session, captures: readonly Capture[]): Promise<void> {
  const root = document.createElement("div");
  root.id = "snipmunk-print";
  const style = document.createElement("style");
  style.textContent = PRINT_CSS;
  const urls: string[] = [];
  for (const c of captures) {
    const canvas = await renderCapture(session, c);
    const blob = await canvasBlob(canvas, "image/png");
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const page = document.createElement("div");
    page.className = `pp ${isWide(canvas.width, canvas.height) ? "wide" : "tall"}`;
    const img = document.createElement("img");
    img.src = url;
    page.appendChild(img);
    root.appendChild(page);
    canvas.width = 0;
    canvas.height = 0;
  }
  document.head.appendChild(style);
  document.body.appendChild(root);
  try {
    await Promise.all(Array.from(root.querySelectorAll("img")).map((i) => i.decode().catch(() => undefined)));
    window.print();
  } finally {
    // The print dialog is modal for the window: when print() returns the job has been handed over.
    root.remove();
    style.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
