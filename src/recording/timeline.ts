// Time math of a recording (no React): the recorded timeline with pauses, trim in and out, disk-space limits, the render cache
// key and the GIF size estimate.

export type PauseEvent = { type: "pause" | "resume"; at: number };

/**
 * Recording time for a wall clock time: time spent paused is not counted, so the timeline has no gaps. `events` are the pause
 * and resume moments in wall clock seconds since the start.
 */
export function recordedTime(wall: number, events: readonly PauseEvent[]): number {
  let paused = 0;
  let since: number | null = null;
  for (const e of events) {
    if (e.at > wall) break;
    if (e.type === "pause" && since === null) since = e.at;
    else if (e.type === "resume" && since !== null) {
      paused += e.at - since;
      since = null;
    }
  }
  if (since !== null) paused += wall - since;
  return Math.max(0, wall - paused);
}

export interface Trim {
  start: number;
  end: number;
}

/** A trim inside 0 to `duration`, at least `min` seconds long (the whole recording when it cannot be). */
export function clampTrim(trim: Trim, duration: number, min = 0.2): Trim {
  const d = Math.max(0, duration);
  if (d <= min) return { start: 0, end: d };
  let start = Math.min(Math.max(0, trim.start), d - min);
  let end = Math.max(Math.min(d, trim.end), start + min);
  if (end > d) {
    end = d;
    start = Math.max(0, end - min);
  }
  return { start, end };
}

export const trimmedDuration = (trim: Trim) => Math.max(0, trim.end - trim.start);

/** The time in the source for a time on the trimmed timeline. */
export const sourceTime = (trim: Trim, t: number) => Math.min(trim.end, trim.start + Math.max(0, t));

/** Where playback goes next: at the trim end it stops (returns null); before the start it jumps to the start. */
export function playbackTime(trim: Trim, t: number): number | null {
  if (t >= trim.end) return null;
  return Math.max(trim.start, t);
}

/** "1:05" or "1:02:03". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

// --- disk space -----------------------------------------------------------------------------------------------------

export type SpaceLevel = "ok" | "low" | "critical";

/** Below this many free bytes recording stops safely; below `LOW_BYTES` or with fewer than 5 minutes left the user is warned. */
export const CRITICAL_BYTES = 300 * 1024 * 1024;
export const LOW_BYTES = 2 * 1024 * 1024 * 1024;
export const LOW_SECONDS = 5 * 60;

export function spaceLevel(freeBytes: number, bytesPerSecond: number): SpaceLevel {
  if (freeBytes < CRITICAL_BYTES) return "critical";
  const secondsLeft = bytesPerSecond > 0 ? (freeBytes - CRITICAL_BYTES) / bytesPerSecond : Infinity;
  return freeBytes < LOW_BYTES || secondsLeft < LOW_SECONDS ? "low" : "ok";
}

// --- render cache -----------------------------------------------------------------------------------------------------

/** Stable text of a value: object keys sorted, so the same settings always give the same text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** The key of a rendered file: everything that changes the picture or the sound (effects, webcam layout, trim, mixer volumes). */
export function renderKey(recording: { effects: unknown; webcam: unknown; trim: Trim; volumes: unknown; sourceStamp: number }): string {
  return stableJson(recording);
}

/** Is the cached render still good for this recording? */
export function renderIsFresh(cachedKey: string | null, current: string): boolean {
  return cachedKey !== null && cachedKey === current;
}

// --- GIF ---------------------------------------------------------------------------------------------------------------

export type GifQuality = "low" | "high";

export interface GifPlan {
  fps: number;
  width: number;
  height: number;
  frames: number;
}

/** Low: about 10 frames a second at most 640 px wide; High: 15 frames a second at most 1280 px wide. */
export function gifPlan(quality: GifQuality, sourceWidth: number, sourceHeight: number, seconds: number): GifPlan {
  const fps = quality === "low" ? 10 : 15;
  const maxW = quality === "low" ? 640 : 1280;
  const k = Math.min(1, maxW / Math.max(1, sourceWidth));
  const width = Math.max(2, Math.round((sourceWidth * k) / 2) * 2);
  const height = Math.max(2, Math.round((sourceHeight * k) / 2) * 2);
  return { fps, width, height, frames: Math.max(1, Math.round(seconds * fps)) };
}

/** A rough GIF size in bytes: GIF stores about 0.35 bytes per pixel and frame after frame differencing and LZW on screen content. */
export function gifEstimate(plan: GifPlan): number {
  return Math.round(plan.width * plan.height * plan.frames * 0.35);
}

/** A GIF over this many bytes is "very large": the user is warned before exporting. */
export const GIF_WARN_BYTES = 50 * 1024 * 1024;
export const gifIsVeryLarge = (bytes: number) => bytes > GIF_WARN_BYTES;
