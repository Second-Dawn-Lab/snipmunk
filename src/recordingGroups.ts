// Screenshot groups and recording groups live in one session but are shown separately (no React).
import type { Group } from "./ipc";

export const isRecordingGroup = (g: Pick<Group, "kind">) => g.kind === "recording";

/** The groups of one kind, in their order. */
export function groupsOfKind<T extends Pick<Group, "kind">>(groups: readonly T[], recording: boolean): T[] {
  return groups.filter((g) => isRecordingGroup(g) === recording);
}

/** The order of all groups after the tabs of one kind were reordered: those tabs take the new order in their places, the other
 * kind's groups stay where they are. */
export function mergeGroupOrder(all: readonly { id: string }[], shownOrder: readonly string[]): string[] {
  const shown = new Set(shownOrder);
  let k = 0;
  return all.map((g) => (shown.has(g.id) ? shownOrder[k++] : g.id));
}

/** Does a recording group exist? (The recording mode makes the first one when there is none.) */
export const hasRecordingGroup = (groups: readonly Pick<Group, "kind">[]) => groups.some(isRecordingGroup);
