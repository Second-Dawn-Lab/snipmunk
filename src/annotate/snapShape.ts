// The annotation a recognized stroke becomes (no React): lines, arrows, ellipses and rectangles are the ordinary marks in the
// pen's colour and size; a triangle, a star or a turned rectangle is a pen stroke along the clean outline.
import { newId, type Annotation, type HighlighterAnnotation, type PenAnnotation } from "./schema";
import type { Snap } from "./shapeRecognizer";

/** The opacity a snapped highlighter shape gets (the highlighter is see-through). */
export const HIGHLIGHT_OPACITY = 45;

export function snappedAnnotation(snap: Snap, pen: PenAnnotation | HighlighterAnnotation): Annotation {
  const opacity = pen.type === "highlighter" ? HIGHLIGHT_OPACITY : 100;
  const base = { stroke: pen.color, strokeOpacity: opacity, strokeWidth: pen.size };
  switch (snap.kind) {
    case "line":
    case "arrow":
      return { type: snap.kind, id: newId(), x1: snap.a.x, y1: snap.a.y, x2: snap.b.x, y2: snap.b.y, ...base };
    case "ellipse":
    case "rect":
      return { type: snap.kind, id: newId(), x: snap.x, y: snap.y, w: snap.w, h: snap.h, rotation: 0, fill: "none", fillOpacity: 100, ...base };
    case "polygon": {
      const pts: number[] = [];
      for (const p of snap.points) pts.push(p.x, p.y, 0.5);
      pts.push(snap.points[0].x, snap.points[0].y, 0.5);
      return { ...pen, id: newId(), points: pts };
    }
  }
}
