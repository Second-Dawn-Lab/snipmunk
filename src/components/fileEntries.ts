// What the File menu of the top bar holds in each of the three modes (no React): the entries, which of them can be used, and
// their shortcuts. "Close Snipmunk" stands last in every mode.

import type { useT } from "../i18n";

/** Text only, in every mode: with an icon on some entries the labels of one menu would not line up. */
export type FileEntry =
  | { kind: "item"; id: string; label: string; hint?: string; disabled?: boolean; danger?: boolean; run: () => void }
  | { kind: "heading"; id: string; label: string }
  | { kind: "separator"; id: string };

type Words = ReturnType<typeof useT>["t"];
/** A guide or project that was opened before. */
export interface RecentFile {
  path: string;
  name: string;
  exists: boolean;
}

/** How many recent files a menu lists. */
export const RECENT = 6;

const recentEntries = (title: string, recent: readonly RecentFile[], open: (path: string) => void): FileEntry[] =>
  recent.length === 0
    ? []
    : [{ kind: "heading", id: "recent", label: title }, ...recent.slice(0, RECENT).map((r): FileEntry => ({ kind: "item", id: `recent:${r.path}`, label: r.name, disabled: !r.exists, run: () => open(r.path) }))];

/** Screenshots mode: what can be done with the capture on show (or the selection, when printing). */
export function screenshotEntries(
  t: Words,
  state: { capture: boolean; busy: boolean; windows: boolean },
  run: { save: () => void; paint: () => void; print: () => void; folder: () => void },
): FileEntry[] {
  const off = !state.capture || state.busy;
  return [
    { kind: "item", id: "save", label: t("file.saveCapture"), disabled: off, run: run.save },
    { kind: "item", id: "paint", label: state.windows ? t("actions.editPaint") : t("actions.openEditor"), disabled: off, run: run.paint },
    { kind: "item", id: "print", label: t("guide.print"), hint: "Ctrl+P", disabled: off, run: run.print },
    { kind: "item", id: "folder", label: t("menu.openFolder"), disabled: state.busy, run: run.folder },
  ];
}

/**
 * Recording mode, for what is on show: a project ("Save" and "Save as…"), the current recording that is not a project yet
 * ("Save as project…", "Discard recording…"), or nothing.
 */
export function recordingEntries(
  t: Words,
  state: { shown: boolean; project: boolean; dirty: boolean; busy: boolean; recent: readonly RecentFile[] },
  run: { open: () => void; save: () => void; saveAs: () => void; rename: () => void; explorer: () => void; close: () => void; discard: () => void; openRecent: (path: string) => void },
): FileEntry[] {
  const none = !state.shown;
  const saving: FileEntry[] = state.project
    ? [
        { kind: "item", id: "save", label: t("proj.save"), hint: "Ctrl+S", disabled: !state.dirty || state.busy, run: run.save },
        { kind: "item", id: "saveAs", label: t("proj.saveAsCopy"), disabled: state.busy, run: run.saveAs },
      ]
    : [{ kind: "item", id: "save", label: t("proj.saveAs"), disabled: none || state.busy, run: run.save }];
  return [
    { kind: "item", id: "open", label: t("proj.open"), hint: "Ctrl+O", run: run.open },
    ...saving,
    { kind: "item", id: "rename", label: t("proj.rename"), hint: "F2", disabled: none, run: run.rename },
    { kind: "item", id: "explorer", label: t("ctx.showInExplorer"), disabled: !state.project, run: run.explorer },
    state.project || none
      ? { kind: "item", id: "close", label: t("proj.close"), hint: "Ctrl+W", disabled: !state.project, run: run.close }
      : { kind: "item", id: "discard", label: t("proj.discard"), danger: true, run: run.discard },
    ...recentEntries(t("proj.recent"), state.recent, run.openRecent),
  ];
}

/** Documents mode, with or without an open guide. */
export function guideEntries(
  t: Words,
  state: { open: boolean; file: boolean; unchanged: boolean; busy: boolean; recent: readonly RecentFile[] },
  run: { create: () => void; open: () => void; save: () => void; saveAs: () => void; rename: () => void; explorer: () => void; close: () => void; openRecent: (path: string) => void },
): FileEntry[] {
  const none = !state.open;
  return [
    { kind: "item", id: "new", label: t("docs.new"), run: run.create },
    { kind: "item", id: "open", label: t("guide.open"), hint: "Ctrl+O", run: run.open },
    { kind: "item", id: "save", label: t("guide.save"), hint: "Ctrl+S", disabled: none || state.busy || (state.file && state.unchanged), run: run.save },
    { kind: "item", id: "saveAs", label: t("guide.saveAs"), hint: "Ctrl+Shift+S", disabled: none || state.busy, run: run.saveAs },
    { kind: "item", id: "rename", label: t("proj.rename"), hint: "F2", disabled: none, run: run.rename },
    { kind: "item", id: "explorer", label: t("ctx.showInExplorer"), disabled: !state.file, run: run.explorer },
    { kind: "item", id: "close", label: t("guide.close"), hint: "Ctrl+W", disabled: none, run: run.close },
    ...recentEntries(t("guide.recent"), state.recent, run.openRecent),
  ];
}

/** Every File menu ends the same way. */
export const withClose = (t: Words, entries: readonly FileEntry[], close: () => void): FileEntry[] => [
  ...entries,
  { kind: "separator", id: "end" },
  { kind: "item", id: "quit", label: t("file.closeApp"), run: close },
];
