// Rules for the group tabs (no React, no IPC), so they can be unit tested. The backend enforces the same rules in
// src-tauri/src/sessions.rs; the colour and emoji lists below must match GROUP_COLORS and GROUP_EMOJIS there (a Rust
// test reads this file and checks).
import type { Group } from "./ipc";

/** The colours a tab can have. Each is drawn for the light and the dark theme by `.grouptab--c-<name>` in app.css. */
export const GROUP_COLORS = ["red", "orange", "amber", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** The emoji a tab can show before its name. */
export const GROUP_EMOJIS = ["📁", "⭐", "🔥", "✅", "🐞", "💡", "📄", "🎨", "📌", "🧪", "🗂️", "💬"] as const;

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && (GROUP_COLORS as readonly string[]).includes(value);
}

/** The last remaining group cannot be deleted. */
export function canDeleteGroup(groups: readonly Group[]): boolean {
  return groups.length > 1;
}

/** The groups that can receive the captures of the group being deleted (every other group, in tab order). */
export function moveTargets(groups: readonly Group[], excludeId: string): Group[] {
  return groups.filter((g) => g.id !== excludeId);
}

/** The group preselected in the "move the captures to" dropdown: the tab after the deleted one, else the one before. */
export function defaultMoveTarget(groups: readonly Group[], deletingId: string): string | null {
  const at = groups.findIndex((g) => g.id === deletingId);
  if (at < 0) return groups[0]?.id ?? null;
  return (groups[at + 1] ?? groups[at - 1])?.id ?? null;
}

export type DeleteChoice = { mode: "move"; targetId: string } | { mode: "delete" };

export type DeletePlan =
  | { ok: true; moveTo: string | null }
  | { ok: false; reason: "last" | "unknown" | "target" };

/** Check a delete request: the last group stays, and the target must be another group of the session. */
export function planGroupDelete(groups: readonly Group[], id: string, choice: DeleteChoice): DeletePlan {
  if (!canDeleteGroup(groups)) return { ok: false, reason: "last" };
  if (!groups.some((g) => g.id === id)) return { ok: false, reason: "unknown" };
  if (choice.mode === "delete") return { ok: true, moveTo: null };
  if (choice.targetId === id || !groups.some((g) => g.id === choice.targetId)) return { ok: false, reason: "target" };
  return { ok: true, moveTo: choice.targetId };
}

/** The tab to show after `deletedId` is gone: unchanged unless it was the shown one; then where its captures went. */
export function activeAfterGroupDelete(
  groups: readonly Group[],
  deletedId: string,
  activeId: string,
  moveTo: string | null,
): string {
  if (activeId !== deletedId) return activeId;
  if (moveTo) return moveTo;
  return defaultMoveTarget(groups, deletedId) ?? activeId;
}

/** What the page offers when a group is deleted: nothing to ask for an empty group. */
export function needsDeleteChoice(group: Group): boolean {
  return group.captures.length > 0;
}
