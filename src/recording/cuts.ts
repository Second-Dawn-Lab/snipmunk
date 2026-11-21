// Cuts and splits of a recording (no React): the parts that are cut out, the segments the splits make, and the undo history.
// Times are in milliseconds of the recording (screen time), the same as `effects.cuts`.

export interface Cut {
  startMs: number;
  endMs: number;
}

/** The cuts as they are stored: within 0..limit, sorted, overlapping and touching ones merged, empty ones dropped. */
export function normalizeCuts(cuts: readonly Cut[], limitMs = Number.MAX_SAFE_INTEGER): Cut[] {
  const v = cuts
    .map((c) => ({ startMs: Math.round(Math.min(Math.max(0, c.startMs), limitMs)), endMs: Math.round(Math.min(Math.max(0, c.endMs), limitMs)) }))
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Cut[] = [];
  for (const c of v) {
    const last = out[out.length - 1];
    if (last && c.startMs <= last.endMs) last.endMs = Math.max(last.endMs, c.endMs);
    else out.push({ ...c });
  }
  return out;
}

/** The cuts inside `start..end`, cut to it. */
export function cutsWithin(cuts: readonly Cut[], startMs: number, endMs: number): Cut[] {
  return cuts.map((c) => ({ startMs: Math.max(c.startMs, startMs), endMs: Math.min(c.endMs, endMs) })).filter((c) => c.endMs > c.startMs);
}

/** How much of `start..end` is kept once the cuts are out (ms). */
export function keptMs(startMs: number, endMs: number, cuts: readonly Cut[]): number {
  const removed = cutsWithin(cuts, startMs, endMs).reduce((n, c) => n + (c.endMs - c.startMs), 0);
  return Math.max(0, endMs - startMs - removed);
}

/** The time on the edited timeline (ms from the trim start, cuts out) of a time of the recording; a time in a cut is where the cut begins. */
export function editedTime(t: number, startMs: number, cuts: readonly Cut[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t <= c.startMs) break;
    removed += Math.min(t, c.endMs) - Math.max(c.startMs, startMs);
  }
  return Math.max(0, t - startMs - Math.max(0, removed));
}

/** The end of the cut that holds `t` (ms), or null when `t` is not in a cut. */
export function cutEndAt(t: number, cuts: readonly Cut[]): number | null {
  for (const c of cuts) if (t >= c.startMs && t < c.endMs) return c.endMs;
  return null;
}

export interface Segment {
  startMs: number;
  endMs: number;
  /** Cut out (hatched). */
  cut: boolean;
}

/** The segments between the trim ends, the split points and the edges of the cuts. */
export function segments(startMs: number, endMs: number, splits: readonly number[], cuts: readonly Cut[]): Segment[] {
  const points = new Set<number>([startMs, endMs]);
  for (const s of splits) if (s > startMs && s < endMs) points.add(s);
  for (const c of cuts) {
    if (c.startMs > startMs && c.startMs < endMs) points.add(c.startMs);
    if (c.endMs > startMs && c.endMs < endMs) points.add(c.endMs);
  }
  const p = [...points].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i];
    const b = p[i + 1];
    out.push({ startMs: a, endMs: b, cut: cuts.some((c) => c.startMs <= a && c.endMs >= b) });
  }
  return out;
}

/** The segment that holds `t`, if any. */
export function segmentAt(list: readonly Segment[], t: number): Segment | null {
  return list.find((s) => t >= s.startMs && t < s.endMs) ?? null;
}

/** Add a split point (not within `min` ms of an edge or another split). Returns the same list when nothing changes. */
export function addSplit(splits: readonly number[], at: number, startMs: number, endMs: number, min = 100): number[] {
  const t = Math.round(at);
  if (t - startMs < min || endMs - t < min || splits.some((s) => Math.abs(s - t) < min)) return splits as number[];
  return [...splits, t].sort((a, b) => a - b);
}

/** Cut out a segment, or bring a cut one back. */
export function toggleSegment(cuts: readonly Cut[], seg: Segment): Cut[] {
  if (seg.cut) {
    const out: Cut[] = [];
    for (const c of cuts) {
      if (c.endMs <= seg.startMs || c.startMs >= seg.endMs) out.push(c);
      else {
        if (c.startMs < seg.startMs) out.push({ startMs: c.startMs, endMs: seg.startMs });
        if (c.endMs > seg.endMs) out.push({ startMs: seg.endMs, endMs: c.endMs });
      }
    }
    return out;
  }
  return normalizeCuts([...cuts, { startMs: seg.startMs, endMs: seg.endMs }]);
}

export interface EditState {
  cuts: Cut[];
  splits: number[];
}

/** Undo and redo of the edits (split, delete, restore). */
export class EditHistory {
  private past: EditState[] = [];
  private future: EditState[] = [];

  /** Remember `before` (the state the next edit starts from). */
  push(before: EditState): void {
    this.past.push({ cuts: [...before.cuts], splits: [...before.splits] });
    this.future = [];
  }

  undo(now: EditState): EditState | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ cuts: [...now.cuts], splits: [...now.splits] });
    return prev;
  }

  redo(now: EditState): EditState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ cuts: [...now.cuts], splits: [...now.splits] });
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
