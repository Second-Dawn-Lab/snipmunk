// The only module that talks to the Rust backend. Outside Tauri (plain browser during UI
// work) it falls back to an in-memory mock with the same shape.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mockImageUrl, mockInvoke, mockListen } from "./ipc.mock";
import type { OcrResult } from "./ocr/types";
import type { Settings } from "./settings/defaults";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- the session: groups of captures ---------------------------------------

export interface Capture {
  id: string;
  name: string;
  /** Unix time in milliseconds. */
  createdAt: number;
  /** The image file, relative to the session folder (`images/<id>.png`). */
  file: string;
  /** A small preview for the list (`thumbs/<id>.png`); `null` for captures without one. */
  thumbnail: string | null;
  /** The width limit the thumbnail was made for; below the current one it is upgraded in the background. */
  thumbSize: number;
  /** Counts the times the thumbnail was replaced (an edit), so the picture is loaded again. */
  thumbRev: number;
  width: number;
  height: number;
  sourceWindowTitle: string | null;
  /** "screenshot" (taken by Snipmunk), "imported" (dropped in); `null` in sessions of earlier versions. */
  source: "screenshot" | "imported" | null;
  /** The editable marks, crop and rotation (see src/annotate/schema.ts); `null` for a capture nobody edited. */
  annotations: unknown;
}

export interface Group {
  id: string;
  name: string;
  order: number;
  /** One of `GROUP_COLORS` (groupRules.ts), or none. */
  color: string | null;
  /** One of `GROUP_EMOJIS`, or none. */
  emoji: string | null;
  /** In the user's custom order. */
  captures: Capture[];
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  groups: Group[];
}

/** What the backend returns when a command fails. */
export interface CmdError {
  code: string;
  message: string;
}

/** The URL the web view loads a capture's image from (`snipmunk-img` scheme, served by Rust). */
export function imageUrl(session: Session, capture: Capture): string {
  if (!isTauri) return mockImageUrl(capture);
  return convertFileSrc(`${session.id}/${capture.file}`, "snipmunk-img");
}

/** The small picture of a capture for lists and the toast (the image itself when there is no thumbnail). */
export function thumbUrl(
  session: { id: string },
  capture: { file: string; thumbnail: string | null; thumbSize?: number; thumbRev?: number },
): string {
  if (!isTauri) return mockImageUrl(capture as Capture);
  // The size in the address makes the picture load again when the thumbnail is upgraded.
  const url = convertFileSrc(`${session.id}/${capture.thumbnail ?? capture.file}`, "snipmunk-img");
  return capture.thumbnail ? `${url}?v=${capture.thumbSize ?? 0}.${capture.thumbRev ?? 0}` : url;
}

/** What the capture shortcut is doing: "ok", "invalid" (cannot be used) or "hook" (the keyboard hook failed). */
export interface HotkeyStatus {
  state: "ok" | "invalid" | "hook";
  shortcut: string;
  message: string;
}

export interface ShortcutCheck {
  valid: boolean;
  error: string | null;
  canonical: string | null;
  /** "windows": Windows uses it too; "shared": other programs use it. */
  warning: "windows" | "shared" | null;
}

export interface WinInfo {
  hwnd: number;
  title: string;
  rect: { x: number; y: number; w: number; h: number };
}

/** What an overlay page needs to show its monitor's frozen screenshot. */
export interface OverlayInfo {
  run: number;
  index: number;
  count: number;
  focus: boolean;
  mode: "rectangle" | "window" | "fullscreen" | "freeform";
  /** Seconds before a capture (0, 3, 5 or 10). */
  delay: number;
  magnifier: boolean;
  monitor: { x: number; y: number; w: number; h: number };
  scale: number;
  windows: WinInfo[];
  imageUrl: string;
  width: number;
  height: number;
}

export interface FinishArgs {
  label: string;
  mode: OverlayInfo["mode"];
  rect: [number, number, number, number];
  points?: [number, number][];
  windowTitle?: string;
}

export interface ToastInfo {
  sessionId: string;
  file: string;
  groupName: string;
  copied: boolean;
  width: number;
  height: number;
}

/** The address of a toast picture (the thumbnail file of the capture). */
export function toastImageUrl(info: ToastInfo): string {
  if (!isTauri) return "";
  return convertFileSrc(`${info.sessionId}/${info.file}`, "snipmunk-img");
}

// --- plumbing -----------------------------------------------------------------

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri ? await invoke<T>(cmd, args) : await mockInvoke<T>(cmd, args);
}

function on<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  return isTauri ? listen<T>(event, (e) => handler(e.payload)) : mockListen(event, handler);
}

export const ipc = {
  // settings
  getSettings: () => call<Settings>("get_settings"),
  setSettings: (patch: Partial<Settings>) => call<Settings>("set_settings", { patch }),
  onSettingsChanged: (cb: (s: Settings) => void) => on<Settings>("settings-changed", cb),

  // windows
  openSettings: () => call<void>("open_settings"),
  quitApp: () => call<void>("quit_app"),
  closeAction: (action: "background" | "quit", remember: boolean) =>
    call<void>("close_action", { action, remember }),
  onCloseRequested: (cb: () => void) => on<null>("close-requested", cb),
  setMaximizeRect: (rect: [number, number, number, number]) =>
    call<void>("set_maximize_rect", { rect }),
  onMaximizeHover: (cb: (hovering: boolean) => void) => on<boolean>("maximize-hover", cb),

  // capture
  startCapture: (mode?: string) => call<void>("start_capture", { mode: mode ?? null }),
  /** The capture shortcut was pressed inside a Snipmunk window (the backend ignores it if the hook saw it too). */
  shortcutFired: (name: "capture") => call<void>("shortcut_fired", { name }),
  /** The overlay's delay dropdown: remember the delay; a delay above 0 closes the overlay, counts down and grabs again. */
  captureSetDelay: (delay: number) => call<void>("capture_set_delay", { delay }),
  setActiveGroup: (groupId: string | null) => call<void>("set_active_group", { groupId }),
  getHotkeyStatus: () => call<HotkeyStatus>("get_hotkey_status"),
  onHotkeyStatus: (cb: (s: HotkeyStatus) => void) => on<HotkeyStatus>("hotkey-status", cb),
  checkShortcut: (text: string) => call<ShortcutCheck>("check_shortcut", { text }),
  openUrl: (url: string) => call<void>("open_url", { url }),
  onCaptureAdded: (cb: (a: { captureId: string; groupId: string }) => void) =>
    on<{ captureId: string; groupId: string }>("capture-added", cb),
  onCaptureError: (cb: (message: string) => void) => on<string>("capture-error", cb),
  overlayInfo: (label: string) => call<OverlayInfo | null>("capture_overlay_info", { label }),
  overlayReady: (label: string) => call<void>("capture_overlay_ready", { label }),
  onCaptureOpen: (cb: (run: number) => void) => on<number>("capture-open", cb),
  onCaptureMode: (cb: (mode: OverlayInfo["mode"]) => void) => on<OverlayInfo["mode"]>("capture-mode", cb),
  captureCancel: () => call<void>("capture_cancel"),
  captureSetMode: (mode: OverlayInfo["mode"]) => call<void>("capture_set_mode", { mode }),
  captureFinish: (args: FinishArgs) => call<void>("capture_finish", { args }),
  onCountdown: (cb: (n: number) => void) => on<number>("countdown-tick", cb),
  onToast: (cb: (info: ToastInfo) => void) => on<ToastInfo>("toast-show", cb),
  toastOpen: () => call<void>("toast_open"),
  toastClose: () => call<void>("toast_close"),

  // session
  getCurrentSession: () => call<Session>("get_current_session"),
  onSessionChanged: (cb: (s: Session) => void) => on<Session>("session-changed", cb),
  /** `groupName` names the first group of the new session (in the user's language). */
  newSession: (discardPrevious: boolean, groupName?: string) =>
    call<Session>("new_session", { discardPrevious, groupName: groupName ?? null }),
  /** Save the annotations of a capture (`null` = none). Written to disk before it returns. */
  setAnnotations: (captureId: string, annotations: unknown) => call<Session>("set_annotations", { captureId, annotations }),
  /** Replace the stored picture of a capture (burn redactions in, or undo that). Same size as before. */
  replaceCaptureImage: (captureId: string, png: Blob) => replaceImage(captureId, png),
  // text recognition
  ocrStatus: () => call<OcrStatus>("ocr_status"),
  ocrGet: (captureId: string) => call<OcrResult | null>("ocr_get", { captureId }),
  ocrRecognize: (captureId: string, key: string, png: Blob) => recognize(captureId, key, png),
  onOcrQueue: (cb: (pending: number) => void) => on<{ pending: number }>("ocr-queue", (p) => cb(p.pending)),
  onOcrReady: (cb: (captureId: string) => void) => on<{ captureId: string }>("ocr-ready", (p) => cb(p.captureId)),
  copyText: (text: string) => call<void>("copy_text", { text }),
  copyTable: (html: string, text: string) => call<void>("copy_table", { html, text }),
  openOsSettings: (page: "language") => call<void>("open_os_settings", { page }),
  /** The recognized text of every capture that has one (for the gallery search). */
  ocrTexts: () => call<Record<string, string>>("ocr_texts"),
  // copy, save, share (Phase 6): the page renders, the backend stages the files in its temp folder and hands them out
  /** Empty the temp folder of a kind of export ("copy", "drag", "paint", "print", "share", "save"). */
  exportBegin: (kind: ExportKind) => call<string>("export_begin", { kind }),
  /** Stage one rendered picture; returns its path. `convert: "bmp"` turns a PNG into a BMP on white. */
  exportStage: (kind: ExportKind, name: string, data: Blob, convert?: "bmp") => stageFile(kind, name, data, convert),
  exportClipboard: (files: string[], html: string | null, image: string | null) =>
    call<void>("export_clipboard", { files, html, image }),
  clipboardFormats: () => call<string[]>("clipboard_formats"),
  exportSave: (files: string[], names: string[], folder: string) => call<string[]>("export_save", { files, names, folder }),
  exportZip: (files: string[], names: string[], folder: string, zipName: string) =>
    call<string>("export_zip", { files, names, folder, zipName }),
  exportOpenEditor: (path: string) => call<void>("export_open_editor", { path }),
  exportShare: (files: string[]) => call<void>("export_share", { files }),
  shareSupported: () => call<boolean>("share_supported"),
  exportDrag: (files: string[], preview: string) => call<void>("export_drag", { files, preview }),
  openFolder: (path: string) => call<void>("open_folder", { path }),
  sessionImagesFolder: () => call<string>("session_images_folder"),
  picturesFolder: () => call<string>("pictures_folder"),
  pickFolder: (start?: string) => call<string | null>("pick_folder", { start: start ?? null }),
  pickImages: () => call<string[]>("pick_images"),
  readPickedFile: (path: string) => readPicked(path),
  /** Replace a capture's thumbnail with a PNG rendered by the editor (the picture with its annotations). */
  setCaptureThumbnail: (captureId: string, png: Blob) => setThumbnail(captureId, png),
  createGroup: (name?: string) => call<Session>("create_group", { name: name ?? null }),
  renameGroup: (groupId: string, name: string) =>
    call<Session>("rename_group", { groupId, name }),
  /** Delete a group; its captures move to the end of `moveTo`, or are deleted with it when that is not given. */
  deleteGroup: (groupId: string, moveTo?: string) =>
    call<Session>("delete_group", { groupId, moveTo: moveTo ?? null }),
  reorderGroups: (groupIds: string[]) => call<Session>("reorder_groups", { groupIds }),
  setGroupColor: (groupId: string, color: string | null) => call<Session>("set_group_color", { groupId, color }),
  setGroupEmoji: (groupId: string, emoji: string | null) => call<Session>("set_group_emoji", { groupId, emoji }),
  /** Move captures (in this order) to a group, at `index` of its list without them (the end when not given). */
  moveCaptures: (captureIds: string[], groupId: string, index?: number) =>
    call<Session>("move_captures", { captureIds, groupId, index: index ?? null }),
  /** Copy captures; each copy sits after its original and is named `<name><suffix>`. */
  duplicateCaptures: (captureIds: string[], suffix: string) =>
    call<{ session: Session; ids: string[] }>("duplicate_captures", { captureIds, suffix }),
  /** Add a dropped image to a group. Fails with code "unsupported" when the file is not a supported image. */
  importImage: (groupId: string, file: File) => importImage(groupId, file),
  /** Development builds only: a new session with generated captures. */
  debugSeedSession: (count: number, groups = 1) => call<Session>("debug_seed_session", { count, groups }),
  renameCapture: (captureId: string, name: string) =>
    call<Session>("rename_capture", { captureId, name }),
  deleteCapture: (captureId: string) => call<Session>("delete_capture", { captureId }),
  reorderCaptures: (groupId: string, captureIds: string[]) =>
    call<Session>("reorder_captures", { groupId, captureIds }),
  moveCaptureToGroup: (captureId: string, groupId: string, index?: number) =>
    call<Session>("move_capture_to_group", { captureId, groupId, index: index ?? null }),
};

async function importImage(groupId: string, file: File): Promise<Session> {
  if (!isTauri) return mockInvoke<Session>("import_image", { groupId, name: file.name });
  // The bytes go as the raw request body (no base64); the group and the file name travel in headers.
  return invoke<Session>("import_image", new Uint8Array(await file.arrayBuffer()), {
    headers: { "x-group-id": encodeURIComponent(groupId), "x-file-name": encodeURIComponent(file.name) },
  });
}

export type ExportKind = "copy" | "drag" | "paint" | "print" | "share" | "save";

async function stageFile(kind: ExportKind, name: string, data: Blob, convert?: "bmp"): Promise<string> {
  if (!isTauri) return `mock/${kind}/${name}`;
  const headers: Record<string, string> = { "x-kind": kind, "x-name": encodeURIComponent(name) };
  if (convert) headers["x-convert"] = convert;
  return invoke<string>("export_stage", new Uint8Array(await data.arrayBuffer()), { headers });
}

async function readPicked(path: string): Promise<File> {
  if (!isTauri) throw { code: "unsupported", message: "needs the Snipmunk app" };
  const buf = await invoke<ArrayBuffer>("read_picked_file", { path });
  return new File([buf], path.split(/[\\/]/).pop() ?? "image", { type: "" });
}

export interface OcrStatus {
  engine: string;
  available: boolean;
  languages: { tag: string; name: string }[];
}

async function replaceImage(captureId: string, png: Blob): Promise<Session> {
  if (!isTauri) return mockInvoke<Session>("set_capture_thumbnail", { captureId });
  return invoke<Session>("replace_capture_image", new Uint8Array(await png.arrayBuffer()), {
    headers: { "x-capture-id": encodeURIComponent(captureId) },
  });
}

async function recognize(captureId: string, key: string, png: Blob): Promise<OcrResult> {
  if (!isTauri) throw { code: "ocr", message: "text recognition needs the Snipmunk app" };
  return invoke<OcrResult>("ocr_recognize", new Uint8Array(await png.arrayBuffer()), {
    headers: { "x-capture-id": encodeURIComponent(captureId), "x-key": encodeURIComponent(key) },
  });
}

async function setThumbnail(captureId: string, png: Blob): Promise<Session> {
  if (!isTauri) return mockInvoke<Session>("set_capture_thumbnail", { captureId });
  return invoke<Session>("set_capture_thumbnail", new Uint8Array(await png.arrayBuffer()), {
    headers: { "x-capture-id": encodeURIComponent(captureId) },
  });
}

/** The label of the window this page runs in ("main", "settings"). */
export function windowLabel(): string {
  if (isTauri) return getCurrentWebviewWindow().label;
  return new URLSearchParams(window.location.search).get("window") ?? "main";
}
