// State shared by the annotation toolbar and the editor, and the per-capture history and save queue that outlive the editor
// component (the editor is made again for every capture; its history is not lost).
import { useSyncExternalStore } from "react";
import { ipc } from "../ipc";
import type { FindOptions } from "../ocr/pii";
import { sessionStore } from "../sessionStore";
import type { AspectId } from "./crop";
import { History } from "./history";
import { ImageRevisions, type EditState } from "./imageRevs";
import { migrate, toStored, type AnnotationDoc, type AnnotationType, type RedactMode } from "./schema";
import type { ShapeKind, Tool } from "./tools";
import type { ToolValues } from "./styles";

export interface EditorUi {
  tool: Tool;
  shape: ShapeKind;
  redactMode: RedactMode;
  emoji: string;
  aspect: AspectId;
  /** A capture is shown, so the tools work. */
  enabled: boolean;
  cropping: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasMarks: boolean;
  hasCrop: boolean;
  selectedTypes: AnnotationType[];
  /** The Text actions toolbar is open: the text layer lies over the picture. */
  textMode: boolean;
  /** Text is being recognized for the shown capture. */
  ocrBusy: boolean;
  /** A table was found in the recognized text. */
  hasTable: boolean;
  /** Recognized text is there (so "Copy all text" has something to copy). */
  hasText: boolean;
  /** The capture has redactions that could be burned in. */
  hasRedactions: boolean;
  /** The capture has redactions made by Quick redact. */
  hasQuickRedactions: boolean;
}

/** What the toolbar can ask the editor to do. The editor registers itself while a capture is shown. */
export interface EditorActions {
  undo(): void;
  redo(): void;
  eraseAll(): void;
  /** Quarter turns clockwise (negative = anticlockwise). */
  rotate(turns: number): void;
  flip(axis: "h" | "v"): void;
  cropApply(): void;
  cropCancel(): void;
  cropReset(): void;
  setAspect(id: AspectId): void;
  /** A tool value changed: restyle the selected marks. */
  restyle(patch: Partial<ToolValues>): void;
  /** Copy the recognized text, or a table found in it. */
  copyAllText(): void;
  copyTable(): void;
  /** Cover e-mail addresses and phone numbers (`options` say which). */
  quickRedact(options: FindOptions): void;
  removeQuickRedactions(): void;
  /** Ask whether to burn the redactions into the stored picture. */
  askBake(): void;
}

const initial: EditorUi = {
  tool: "select",
  shape: "rect",
  redactMode: "pixelate",
  emoji: "❤️",
  aspect: "free",
  enabled: false,
  cropping: false,
  canUndo: false,
  canRedo: false,
  hasMarks: false,
  hasCrop: false,
  selectedTypes: [],
  textMode: false,
  ocrBusy: false,
  hasTable: false,
  hasText: false,
  hasRedactions: false,
  hasQuickRedactions: false,
};

let ui: EditorUi = initial;
let registered: EditorActions | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<EditorUi>) {
  const next = { ...ui, ...patch };
  if ((Object.keys(patch) as (keyof EditorUi)[]).every((k) => JSON.stringify(ui[k]) === JSON.stringify(next[k]))) return;
  ui = next;
  listeners.forEach((l) => l());
}

const noop = () => {};

export const editorStore = {
  get: () => ui,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set,
  setTool(tool: Tool) {
    set({ tool });
  },
  /** The editor of the shown capture registers its actions (and the tools work); the returned function removes them. */
  register(actions: EditorActions): () => void {
    registered = actions;
    set({ enabled: true });
    return () => {
      if (registered === actions) registered = null;
    };
  },
  /** The editor went away (another capture, or none): the tools are off until the next one registers. */
  reset() {
    registered = null;
    set({
      enabled: false,
      cropping: false,
      canUndo: false,
      canRedo: false,
      hasMarks: false,
      hasCrop: false,
      selectedTypes: [],
      ocrBusy: false,
      hasTable: false,
      hasText: false,
      hasRedactions: false,
      hasQuickRedactions: false,
    });
  },
  actions: {
    undo: () => registered?.undo(),
    redo: () => registered?.redo(),
    eraseAll: () => registered?.eraseAll(),
    rotate: (turns: number) => registered?.rotate(turns),
    flip: (axis: "h" | "v") => registered?.flip(axis),
    cropApply: () => registered?.cropApply(),
    cropCancel: () => registered?.cropCancel(),
    cropReset: () => registered?.cropReset(),
    setAspect: (id: AspectId) => (registered?.setAspect ?? noop)(id),
    restyle: (patch: Partial<ToolValues>) => registered?.restyle(patch),
    copyAllText: () => registered?.copyAllText(),
    copyTable: () => registered?.copyTable(),
    quickRedact: (options: FindOptions) => registered?.quickRedact(options),
    removeQuickRedactions: () => registered?.removeQuickRedactions(),
    askBake: () => registered?.askBake(),
  } satisfies EditorActions,
};

export function useEditorUi(): EditorUi {
  return useSyncExternalStore(editorStore.subscribe, editorStore.get);
}

// --- history, kept per capture while the session runs ---------------------------------------------------------------------

const histories = new Map<string, History<EditState<AnnotationDoc>>>();
const revisions = new Map<string, ImageRevisions>();

/** The history of a capture, started from its stored annotations the first time. Each entry also says which version of the stored picture it belongs to (a permanent redaction makes a new one). */
export function historyOf(captureId: string, stored: unknown): History<EditState<AnnotationDoc>> {
  let h = histories.get(captureId);
  if (!h) {
    h = new History({ doc: migrate(stored), rev: 0 });
    histories.set(captureId, h);
  }
  return h;
}

/** The versions of a capture's stored picture the undo history can bring back (in memory only). */
export function revisionsOf(captureId: string): ImageRevisions {
  let r = revisions.get(captureId);
  if (!r) {
    r = new ImageRevisions();
    revisions.set(captureId, r);
  }
  return r;
}

// --- saving ------------------------------------------------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();

/**
 * Save the annotations of a capture. Saves run one after the other in the order they were asked for, so an older one can
 * never overwrite a newer one; each is on disk before the next starts.
 */
export function saveAnnotations(captureId: string, doc: AnnotationDoc, onError: (e: unknown) => void): Promise<void> {
  const job = queue.then(async () => {
    try {
      sessionStore.apply(await ipc.setAnnotations(captureId, toStored(doc)));
    } catch (e) {
      onError(e);
    }
  });
  queue = job;
  return job;
}
