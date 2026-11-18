import { useSyncExternalStore } from "react";
import { ipc, type Session } from "./ipc";

// The current session, shared by every component of a window. The backend is the source of truth: each command
// returns the new session, and `session-changed` keeps other windows (and a late answer) in step.
let state: Session | null = null;
const listeners = new Set<() => void>();

function set(next: Session) {
  // A stale echo must not roll back a newer state.
  if (state && next.id === state.id && next.updatedAt < state.updatedAt) return;
  state = next;
  listeners.forEach((l) => l());
}

export const sessionStore = {
  getState: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async init() {
    set(await ipc.getCurrentSession());
    await ipc.onSessionChanged(set);
  },
  /** Apply the session a command returned. */
  apply: set,
};

export function useSession(): Session | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState);
}
