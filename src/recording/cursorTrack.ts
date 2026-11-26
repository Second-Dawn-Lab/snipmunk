// The cursor track of a recording (no React): positions, shape changes, visibility and mouse buttons over time, and the
// clicks in it. The screen is recorded without the cursor; it is drawn on top when playing and when rendering (see `drawFx`),
// so it can be changed afterwards.

export interface CursorSample {
  /** Seconds since the start of the recording (pauses excluded). */
  t: number;
  /** Position in recording pixels. */
  x: number;
  y: number;
  /** The cursor image in use (an id of the stored cursor images: "arrow", "ibeam", "hand", ...). */
  shape: string;
  visible: boolean;
  left: boolean;
  right: boolean;
}

export interface CursorState {
  x: number;
  y: number;
  shape: string;
  visible: boolean;
  left: boolean;
  right: boolean;
}

/** The index of the last sample at or before `t` (-1 before the first). */
export function sampleBefore(track: readonly CursorSample[], t: number): number {
  let lo = 0;
  let hi = track.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Where the cursor is at time `t`: positions are interpolated between samples; the shape, visibility and buttons are those of the
 * last sample (they change in steps). Before the first sample the first one is used, after the last the last one.
 */
export function cursorAt(track: readonly CursorSample[], t: number): CursorState | null {
  if (track.length === 0) return null;
  const i = sampleBefore(track, t);
  const a = track[Math.max(0, i)];
  const b = track[Math.min(track.length - 1, i + 1)];
  let x = a.x;
  let y = a.y;
  if (i >= 0 && b !== a && b.t > a.t) {
    const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    x = a.x + (b.x - a.x) * k;
    y = a.y + (b.y - a.y) * k;
  }
  return { x, y, shape: a.shape, visible: a.visible, left: a.left, right: a.right };
}

export interface ClickEvent {
  t: number;
  x: number;
  y: number;
  button: "left" | "right";
}

/** The presses of the mouse buttons (a button going from up to down), in time order. */
export function clicksOf(track: readonly CursorSample[]): ClickEvent[] {
  const out: ClickEvent[] = [];
  let left = false;
  let right = false;
  for (const s of track) {
    if (s.left && !left) out.push({ t: s.t, x: s.x, y: s.y, button: "left" });
    if (s.right && !right) out.push({ t: s.t, x: s.x, y: s.y, button: "right" });
    left = s.left;
    right = s.right;
  }
  return out;
}
