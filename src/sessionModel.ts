// Pure helpers for the session UI (no React, no IPC), so they can be unit tested.
import type { Capture, Group, Session } from "./ipc";

export type SortMode = "newest" | "oldest" | "custom";

/** The captures in the order the list shows them. "custom" is the stored order. */
export function sortCaptures(captures: readonly Capture[], mode: SortMode): Capture[] {
  const list = [...captures];
  if (mode === "newest") list.sort((a, b) => b.createdAt - a.createdAt);
  if (mode === "oldest") list.sort((a, b) => a.createdAt - b.createdAt);
  return list;
}

/** The group with this id, or the first one when the id is unknown (a deleted group, a new session). */
export function groupOrFirst(session: Session, groupId: string | null): Group {
  return session.groups.find((g) => g.id === groupId) ?? session.groups[0];
}

export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function selectAll(captures: readonly Capture[]): Set<string> {
  return new Set(captures.map((c) => c.id));
}

/** Drop selected ids whose captures no longer exist anywhere in the session. */
export function pruneSelection(selected: ReadonlySet<string>, session: Session): Set<string> {
  const alive = new Set(session.groups.flatMap((g) => g.captures.map((c) => c.id)));
  const next = new Set([...selected].filter((id) => alive.has(id)));
  return next.size === selected.size ? (selected as Set<string>) : next;
}

/** Which capture to show after `deletedId` is removed from the list as shown: the next one, else the previous. */
export function activeAfterDelete(shownIds: readonly string[], deletedId: string): string | null {
  const i = shownIds.indexOf(deletedId);
  if (i < 0) return shownIds[0] ?? null;
  return shownIds[i + 1] ?? shownIds[i - 1] ?? null;
}

/**
 * What Del (or a trash icon) deletes: every selected capture, in session order; with no selection the capture on show.
 * `clicked` is the card whose trash icon was used: a selected card means "the selection", any other card only itself.
 */
export function deleteTargets(
  session: Session,
  selected: ReadonlySet<string>,
  shownId: string | null,
  clicked?: string,
): string[] {
  const ids = session.groups.flatMap((g) => g.captures.map((c) => c.id));
  if (clicked !== undefined && !selected.has(clicked)) return ids.filter((id) => id === clicked);
  const chosen = ids.filter((id) => selected.has(id));
  if (chosen.length > 0) return chosen;
  return shownId !== null ? ids.filter((id) => id === shownId) : [];
}

/** Which capture to show after several are removed: the first remaining one at or after the active one's place. */
export function activeAfterDeleting(
  shownIds: readonly string[],
  deleted: ReadonlySet<string>,
  activeId: string | null,
): string | null {
  const remaining = shownIds.filter((id) => !deleted.has(id));
  if (activeId === null || !deleted.has(activeId)) return validActive(remaining, activeId);
  const at = shownIds.indexOf(activeId);
  return shownIds.slice(at + 1).find((id) => !deleted.has(id)) ?? remaining[remaining.length - 1] ?? null;
}

/** The active capture if it is still in the list, else the first one (or null for an empty list). */
export function validActive(shownIds: readonly string[], activeId: string | null): string | null {
  return activeId !== null && shownIds.includes(activeId) ? activeId : (shownIds[0] ?? null);
}

export function totalCaptures(session: Session): number {
  return session.groups.reduce((n, g) => n + g.captures.length, 0);
}

/** "14:05:09" for today, "17 Nov, 14:05" for other days. */
export function formatTime(ms: number, locale: string, now: number = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSize(width: number, height: number): string {
  return `${width} × ${height} px`;
}

// --- zoom of the preview ---------------------------------------------------------

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** The next zoom step above `zoom` (stays at the largest). */
export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

/** The next zoom step below `zoom` (stays at the smallest). */
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? ZOOM_STEPS[0];
}

/** The zoom that fits an image into a box (never enlarges beyond 100 %). */
export function fitZoom(image: { width: number; height: number }, box: { width: number; height: number }): number {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(1, box.width / image.width, box.height / image.height);
}
