// Reads the cursor track file of a recording (cursor.jsonl, written by src-tauri/src/cursor.rs) into the samples the player draws
// from (see cursorTrack.ts). No React.

import type { CursorSample } from "./cursorTrack";

export interface CursorShape {
  id: string;
  /** The hot spot of the picture: the point that is at the position of the cursor. */
  hx: number;
  hy: number;
  w: number;
  h: number;
  /** The PNG, relative to the recording folder (`cursors/<id>.png`). */
  file: string;
}

export interface CursorFile {
  width: number;
  height: number;
  samples: CursorSample[];
  shapes: Record<string, CursorShape>;
}

/**
 * One JSON object per line: a header, cursor pictures, positions and buttons. A line that cannot be read (the last one of a
 * recording that a crash cut off) is skipped. Times in the file are milliseconds; the samples have seconds.
 */
export function parseCursorFile(text: string): CursorFile {
  const out: CursorFile = { width: 0, height: 0, samples: [], shapes: {} };
  let shape = "arrow";
  let visible = true;
  let left = false;
  let right = false;
  let x = 0;
  let y = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let v: Record<string, unknown>;
    try {
      v = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (v.type === "header") {
      out.width = Number(v.width) || 0;
      out.height = Number(v.height) || 0;
    } else if (typeof v.shape === "string") {
      out.shapes[v.shape] = {
        id: v.shape,
        hx: Number(v.hx) || 0,
        hy: Number(v.hy) || 0,
        w: Number(v.w) || 0,
        h: Number(v.h) || 0,
        file: String(v.file ?? ""),
      };
    } else if (typeof v.b === "string") {
      if (v.b === "l") left = v.d === 1;
      else right = v.d === 1;
      out.samples.push({ t: Number(v.t) / 1000, x, y, shape, visible, left, right });
    } else if (typeof v.x === "number" && typeof v.y === "number") {
      x = v.x;
      y = v.y;
      visible = v.v === 1;
      if (typeof v.s === "string") shape = v.s;
      out.samples.push({ t: Number(v.t) / 1000, x, y, shape, visible, left, right });
    }
  }
  return out;
}
