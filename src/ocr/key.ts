// What a recognized text was made from. The text is read from the picture with the crop, rotation, flip and redactions
// applied (and without the other marks), in the chosen languages; when any of that changes the text is read again.
import type { AnnotationDoc } from "../annotate/schema";

/** The part of the key that depends on the document: "plain" for a picture without crop, rotation, flip and redactions. */
export function docKey(doc: Pick<AnnotationDoc, "crop" | "rotation" | "flipH" | "flipV" | "items">): string {
  const redactions = doc.items
    .filter((a) => a.type === "redact")
    .map((a) => {
      const r = a as { x: number; y: number; w: number; h: number; mode: string };
      return `${r.mode}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
    })
    .sort();
  const crop = doc.crop ? `c${Math.round(doc.crop.x)},${Math.round(doc.crop.y)},${Math.round(doc.crop.w)},${Math.round(doc.crop.h)}` : "";
  const turn = doc.rotation !== 0 || doc.flipH || doc.flipV ? `r${doc.rotation}${doc.flipH ? "h" : ""}${doc.flipV ? "v" : ""}` : "";
  const parts = [crop, turn, ...redactions].filter(Boolean);
  return parts.length === 0 ? "plain" : parts.join("|");
}

/** The key of a result: the document and the OCR languages setting. The Rust side makes the same key for a fresh capture. */
export function ocrKey(doc: Pick<AnnotationDoc, "crop" | "rotation" | "flipH" | "flipV" | "items">, languages: string): string {
  return `${docKey(doc)}|${languages}`;
}
