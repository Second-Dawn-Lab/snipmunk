// The tools of the annotation toolbar and their keyboard shortcuts (no React).

export type Tool = "select" | "pen" | "highlighter" | "eraser" | "shapes" | "text" | "crop" | "blur";

export type ShapeKind = "rect" | "ellipse" | "line" | "arrow" | "emoji";

/** Shortcuts, active only while the preview has the focus and nothing is being typed. R rotates (it is a command, not a mode). */
export const TOOL_KEYS: Readonly<Record<string, Tool | "rotate">> = {
  v: "select",
  p: "pen",
  h: "highlighter",
  e: "eraser",
  s: "shapes",
  t: "text",
  c: "crop",
  r: "rotate",
  b: "blur",
};

/** The tool for a pressed key, or `null` (also for keys held with Ctrl, Alt or Meta). */
export function toolForKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Tool | "rotate" | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  return TOOL_KEYS[e.key.toLowerCase()] ?? null;
}

/** The letter shown in a tool's tooltip. */
export function keyOf(tool: Tool | "rotate"): string {
  return (Object.entries(TOOL_KEYS).find(([, t]) => t === tool)?.[0] ?? "").toUpperCase();
}

export type UndoKey = "undo" | "redo";

/** Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo. */
export function undoKeyFor(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): UndoKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && !e.shiftKey) return "redo";
  return null;
}
