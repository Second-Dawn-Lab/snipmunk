// Time math of a recording (no React): trim in and out, and times as text.

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
