import type { Settings } from "../settings/defaults";

/**
 * How a recording looks when it is played or exported: the cursor, the click effects, the webcam overlay and the trim. Stored in
 * the recording's `recording.json` (key `effects`) and changeable after the recording; new recordings start from the defaults of
 * the settings. The backend draws the same things when it exports, from the same numbers (`src-tauri/src/effects.rs`).
 */
export interface Effects {
  cursor: { show: boolean; size: "1" | "1.5" | "2"; halo: boolean; haloColor: string };
  click: { kind: "off" | "ripple" | "burst"; left: string; right: string; size: "small" | "medium" | "large" };
  webcam: {
    show: boolean;
    shape: "circle" | "rounded" | "rect";
    size: "s" | "m" | "l";
    /** A corner, or "free" (dragged in the player: the centre is `x`, `y` as a fraction of the picture). */
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "free";
    x: number;
    y: number;
    border: "off" | "thin" | "medium" | "thick";
    borderColor: string;
  };
  /** The part that is played and exported, in milliseconds (`endMs` null = to the end). */
  trim: { startMs: number; endMs: number | null };
}

export function effectsFromSettings(s: Settings): Effects {
  return {
    cursor: { show: s.cursorShow, size: s.cursorSize, halo: s.cursorHalo, haloColor: s.cursorHaloColor },
    click: { kind: s.clickEffect, left: s.clickLeftColor, right: s.clickRightColor, size: s.clickSize },
    webcam: { show: true, shape: s.webcamShape, size: s.webcamSize, position: s.webcamPosition, x: 0.85, y: 0.85, border: s.webcamBorder, borderColor: s.webcamBorderColor },
    trim: { startMs: 0, endMs: null },
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const color = (v: unknown, d: string): string => (typeof v === "string" && HEX.test(v) ? v : d);
const frac = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** The effects as stored (maybe missing, maybe from another version): every field valid, the rest from `base`. */
export function readEffects(raw: unknown, base: Effects): Effects {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const c = r.cursor ?? {};
  const k = r.click ?? {};
  const w = r.webcam ?? {};
  const t = r.trim ?? {};
  const startMs = typeof t.startMs === "number" && t.startMs > 0 ? t.startMs : 0;
  const endMs = typeof t.endMs === "number" && t.endMs > startMs ? t.endMs : null;
  return {
    cursor: {
      show: typeof c.show === "boolean" ? c.show : base.cursor.show,
      size: pick(c.size, ["1", "1.5", "2"], base.cursor.size),
      halo: typeof c.halo === "boolean" ? c.halo : base.cursor.halo,
      haloColor: color(c.haloColor, base.cursor.haloColor),
    },
    click: {
      kind: pick(k.kind, ["off", "ripple", "burst"], base.click.kind),
      left: color(k.left, base.click.left),
      right: color(k.right, base.click.right),
      size: pick(k.size, ["small", "medium", "large"], base.click.size),
    },
    webcam: {
      show: typeof w.show === "boolean" ? w.show : base.webcam.show,
      shape: pick(w.shape, ["circle", "rounded", "rect"], base.webcam.shape),
      size: pick(w.size, ["s", "m", "l"], base.webcam.size),
      position: pick(w.position, ["top-left", "top-right", "bottom-left", "bottom-right", "free"], base.webcam.position),
      x: frac(w.x, base.webcam.x),
      y: frac(w.y, base.webcam.y),
      // (older files have a boolean)
      border: w.border === true ? "thin" : w.border === false ? "off" : pick(w.border, ["off", "thin", "medium", "thick"], base.webcam.border),
      borderColor: color(w.borderColor, base.webcam.borderColor),
    },
    trim: { startMs, endMs },
  };
}

/** The part of the recording that is kept, in seconds: `[start, end]` for a recording of `duration` seconds. */
export function trimRange(trim: Effects["trim"], duration: number): [number, number] {
  const start = Math.min(Math.max(0, trim.startMs / 1000), duration);
  const end = trim.endMs === null ? duration : Math.min(Math.max(start, trim.endMs / 1000), duration);
  return [start, end];
}

/** The centre of the webcam picture as a fraction of the video (0..1) for a corner or a dragged position; `size` is its width as a fraction. */
export function webcamCentre(w: Effects["webcam"], width: number, aspect: number): { x: number; y: number } {
  if (w.position === "free") return { x: w.x, y: w.y };
  const margin = 0.02;
  const half = width / 2;
  const halfH = (width / aspect) / 2;
  const left = margin + half;
  const top = margin * 1.78 + halfH;
  return {
    x: w.position.endsWith("left") ? left : 1 - left,
    y: w.position.startsWith("top") ? top : 1 - top,
  };
}

/** The width of the webcam border as a fraction of the shorter side of the bubble. */
export const BORDER_WIDTH = { off: 0, thin: 0.02, medium: 0.04, thick: 0.07 } as const;

/** The width of the webcam picture as a fraction of the video width. */
export const WEBCAM_WIDTH = { s: 0.14, m: 0.2, l: 0.28 } as const;

/** The size of a cursor (times its normal size). */
export const CURSOR_SCALE = { "1": 1, "1.5": 1.5, "2": 2 } as const;

/** The click effect's radius as a fraction of the video height. */
export const CLICK_RADIUS = { small: 0.03, medium: 0.05, large: 0.08 } as const;

/** How long a click effect lasts, in milliseconds. */
export const CLICK_MS = 600;
