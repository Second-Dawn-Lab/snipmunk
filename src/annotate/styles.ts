// How the tool values of the popovers (kept in the settings) become marks, and how changing a value restyles the selected
// marks (no React).
import type { Settings } from "../settings/defaults";
import type { Pt } from "./geometry";
import { newId, type Annotation, type EmojiAnnotation, type LineAnnotation, type PenAnnotation, type HighlighterAnnotation, type Rect, type ShapeAnnotation, type TextAnnotation } from "./schema";
import type { ShapeKind } from "./tools";

/** The values the popovers change. */
export type ToolValues = Pick<
  Settings,
  | "lastPenColor"
  | "lastPenSize"
  | "lastHighlighterColor"
  | "lastHighlighterSize"
  | "lastFillColor"
  | "lastFillOpacity"
  | "lastOutlineColor"
  | "lastOutlineOpacity"
  | "lastOutlineSize"
  | "lastTextColor"
  | "lastTextSize"
  | "lastTextBackground"
>;

export const TOOL_VALUE_KEYS: readonly (keyof ToolValues)[] = [
  "lastPenColor", "lastPenSize", "lastHighlighterColor", "lastHighlighterSize", "lastFillColor", "lastFillOpacity",
  "lastOutlineColor", "lastOutlineOpacity", "lastOutlineSize", "lastTextColor", "lastTextSize", "lastTextBackground",
];

export function pickValues(s: Settings): ToolValues {
  const out: Record<string, unknown> = {};
  for (const k of TOOL_VALUE_KEYS) out[k] = s[k];
  return out as unknown as ToolValues;
}

/** A line has no "none" colour: with the outline set to none it takes the pen's colour. */
const lineColor = (v: ToolValues) => (v.lastOutlineColor === "none" ? v.lastPenColor : v.lastOutlineColor);

export function newPen(points: number[], v: ToolValues): PenAnnotation {
  return { type: "pen", id: newId(), points, color: v.lastPenColor, size: v.lastPenSize };
}

export function newHighlighter(points: number[], v: ToolValues): HighlighterAnnotation {
  return { type: "highlighter", id: newId(), points, color: v.lastHighlighterColor, size: v.lastHighlighterSize };
}

export function newShape(kind: "rect" | "ellipse", r: Rect, v: ToolValues): ShapeAnnotation {
  return {
    type: kind,
    id: newId(),
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    rotation: 0,
    fill: v.lastFillColor,
    fillOpacity: v.lastFillOpacity,
    stroke: v.lastOutlineColor,
    strokeOpacity: v.lastOutlineOpacity,
    strokeWidth: v.lastOutlineSize,
  };
}

export function newLine(kind: "line" | "arrow", a: Pt, b: Pt, v: ToolValues): LineAnnotation {
  return {
    type: kind,
    id: newId(),
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    stroke: lineColor(v),
    strokeOpacity: v.lastOutlineOpacity,
    strokeWidth: v.lastOutlineSize,
  };
}

export function newEmoji(char: string, at: Pt, size: number): EmojiAnnotation {
  return { type: "emoji", id: newId(), x: at.x - size / 2, y: at.y - size / 2, size, char, rotation: 0 };
}

export function newText(at: Pt, v: ToolValues): TextAnnotation {
  return {
    type: "text",
    id: newId(),
    x: at.x,
    y: at.y,
    w: 0,
    h: 0,
    text: "",
    fontSize: v.lastTextSize,
    color: v.lastTextColor,
    background: v.lastTextBackground,
    rotation: 0,
    fixedWidth: false,
  };
}

/** The shape kinds a shape tool can draw, as the mark types they make. */
export function isBoxShape(kind: ShapeKind): kind is "rect" | "ellipse" {
  return kind === "rect" || kind === "ellipse";
}

/**
 * The mark with the changed tool values applied: changing the pen colour restyles selected pen strokes, the fill the
 * selected rectangles and ellipses, and so on. A value that does not concern the mark leaves it as it is.
 */
export function restyle(a: Annotation, patch: Partial<ToolValues>): Annotation {
  switch (a.type) {
    case "pen":
      return { ...a, color: patch.lastPenColor ?? a.color, size: patch.lastPenSize ?? a.size };
    case "highlighter":
      return { ...a, color: patch.lastHighlighterColor ?? a.color, size: patch.lastHighlighterSize ?? a.size };
    case "rect":
    case "ellipse":
      return {
        ...a,
        fill: patch.lastFillColor ?? a.fill,
        fillOpacity: patch.lastFillOpacity ?? a.fillOpacity,
        stroke: patch.lastOutlineColor ?? a.stroke,
        strokeOpacity: patch.lastOutlineOpacity ?? a.strokeOpacity,
        strokeWidth: patch.lastOutlineSize ?? a.strokeWidth,
      };
    case "line":
    case "arrow":
      return {
        ...a,
        stroke: patch.lastOutlineColor && patch.lastOutlineColor !== "none" ? patch.lastOutlineColor : a.stroke,
        strokeOpacity: patch.lastOutlineOpacity ?? a.strokeOpacity,
        strokeWidth: patch.lastOutlineSize ?? a.strokeWidth,
      };
    case "text":
      return {
        ...a,
        color: patch.lastTextColor ?? a.color,
        fontSize: patch.lastTextSize ?? a.fontSize,
        background: patch.lastTextBackground ?? a.background,
      };
    default:
      return a;
  }
}

/** The key that joins consecutive restyles of the same value into one undo step. */
export function styleKey(patch: Partial<ToolValues>): string {
  return `style:${Object.keys(patch).sort().join(",")}`;
}
