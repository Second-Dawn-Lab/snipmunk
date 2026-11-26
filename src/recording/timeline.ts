// Time math of a recording (no React): the video's clock, trim in and out, and times as text.

/**
 * A video's own clock against the recording's. An encoder that reorders pictures (B-frames, as Windows' software H.264
 * encoder does) writes every picture a picture later than it was taken: such a video begins `startMs` after 0. The cursor,
 * the clicks, the sound, the trim and the cuts are on the recording's clock.
 */
export function videoClock(startMs: number | null | undefined) {
  const start = typeof startMs === "number" && Number.isFinite(startMs) ? Math.max(0, startMs) / 1000 : 0;
  return {
    /** The recorded time (seconds) of the picture the video shows at `videoTime`. */
    recorded: (videoTime: number) => Math.max(0, videoTime - start),
    /** The video's time that shows the picture recorded at `t` (seconds). */
    video: (t: number) => t + start,
  };
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

/** "1:05" or "1:02:03". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
