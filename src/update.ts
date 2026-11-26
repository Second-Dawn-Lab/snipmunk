// What the pages show about updates (the search and the download are done by the backend, src-tauri/src/updates.rs).
import { useEffect, useState } from "react";
import { ipc, type UpdatePhase, type UpdateView } from "./ipc";
import type { Key } from "./locales/en";

const NOTHING: UpdateView = { supported: true, phase: { kind: "idle" } };

/** The state of the updater, followed. */
export function useUpdate(): UpdateView {
  const [view, setView] = useState(NOTHING);
  useEffect(() => {
    let alive = true;
    let told = false;
    const listening = ipc.onUpdateState((v) => {
      told = true;
      setView(v);
    });
    void listening
      .then(() => ipc.updateState())
      .then((v) => alive && !told && setView(v))
      .catch(() => undefined);
    return () => {
      alive = false;
      void listening.then((stop) => stop());
    };
  }, []);
  return view;
}

/** The sentence for a phase, with its values; `null` while there is nothing to say. */
export function updateMessage(phase: UpdatePhase): { key: Key; vars?: Record<string, string | number> } | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "downloading":
      return phase.percent === null
        ? { key: "update.preparing", vars: { version: phase.version } }
        : { key: "update.downloading", vars: { version: phase.version, percent: phase.percent } };
    case "available":
    case "ready":
    case "failed":
      return { key: `update.${phase.kind}`, vars: { version: phase.version } };
    default:
      return { key: `update.${phase.kind}` };
  }
}

/** The words of the question about unsaved work: before Quit, or before the restart that installs an update. */
export function quitWording(update: boolean): { title: Key; body: Key; cancel: Key; discard: Key } {
  return update
    ? { title: "update.askTitle", body: "update.askBody", cancel: "update.later", discard: "update.askDont" }
    : { title: "proj.quitTitle", body: "proj.quitBody", cancel: "session.cancel", discard: "proj.quitDont" };
}

/** What "Later" puts away: this phase of this version. The notice comes back when something else happens. */
export const dismissKey = (phase: UpdatePhase): string => `${phase.kind}:${"version" in phase ? phase.version : ""}`;

/** Does the main window show a notice? Only about a version that is there: never "up to date" or "offline". */
export function showsNotice(view: UpdateView, dismissed: string | null): boolean {
  const kind = view.phase.kind;
  if (!view.supported || (kind !== "available" && kind !== "downloading" && kind !== "ready" && kind !== "failed")) return false;
  return kind === "downloading" || dismissKey(view.phase) !== dismissed;
}
