// Marks lock like the Windows Snipping Tool's (no React): a mark can be moved, resized, rotated, restyled and (text) edited only
// right after it was made. Once the user clicks elsewhere, changes tool or capture, or presses Esc or Enter, it is committed:
// it stays in the document (undo, the renderer and real redaction need it) but can no longer be selected or edited. Removing
// committed marks is for Undo, the Eraser and "Erase all mark-ups".

export interface LockState {
  /** The ids of the marks that were just made and can still be edited. */
  readonly live: ReadonlySet<string>;
}

export const unlocked: LockState = { live: new Set() };

/** A mark was made: it is the one that can be edited now (the previous one is committed). */
export function made(ids: readonly string[]): LockState {
  return { live: new Set(ids) };
}

export function isLive(state: LockState, id: string): boolean {
  return state.live.has(id);
}

/** Only the ids that can still be edited (a selection can never hold a committed mark). */
export function restrict(state: LockState, ids: Iterable<string>): string[] {
  return [...ids].filter((id) => state.live.has(id));
}

/** The marks that can be selected and hit (the live ones). */
export function selectable<T extends { id: string }>(state: LockState, items: readonly T[]): T[] {
  return items.filter((a) => state.live.has(a.id));
}

/** Commit everything: nothing can be edited any more. */
export function commitAll(state: LockState): LockState {
  return state.live.size === 0 ? state : unlocked;
}

export type LockEvent =
  /** A press on the picture; `onLive` is true on a live mark or one of its handles. */
  | { type: "press"; onLive: boolean }
  | { type: "toolChanged"; keep?: boolean }
  | { type: "key"; key: string }
  | { type: "captureChanged" }
  /** Undo or redo: what was live is gone or changed. */
  | { type: "history" };

export function lockStep(state: LockState, ev: LockEvent): LockState {
  switch (ev.type) {
    case "press":
      return ev.onLive ? state : commitAll(state);
    case "toolChanged":
      // The Text tool hands over to Select with the finished box still live: that is the one change that keeps it.
      return ev.keep ? state : commitAll(state);
    case "key":
      return ev.key === "Escape" || ev.key === "Enter" ? commitAll(state) : state;
    case "captureChanged":
    case "history":
      return commitAll(state);
  }
}
