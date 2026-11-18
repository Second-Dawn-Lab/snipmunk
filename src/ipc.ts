// The only module that talks to the Rust backend. Outside Tauri (plain browser during UI
// work) it falls back to an in-memory mock with the same shape.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mockImageUrl, mockInvoke, mockListen } from "./ipc.mock";
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
  width: number;
  height: number;
  sourceWindowTitle: string | null;
  /** Placeholder for the annotation tools (Phase 5): `null` until then. */
  annotations: unknown;
}

export interface Group {
  id: string;
  name: string;
  order: number;
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
export function thumbUrl(session: { id: string }, capture: { file: string; thumbnail: string | null }): string {
  if (!isTauri) return mockImageUrl(capture as Capture);
  return convertFileSrc(`${session.id}/${capture.thumbnail ?? capture.file}`, "snipmunk-img");
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
  newSession: (discardPrevious: boolean) => call<Session>("new_session", { discardPrevious }),
  createGroup: (name?: string) => call<Session>("create_group", { name: name ?? null }),
  renameGroup: (groupId: string, name: string) =>
    call<Session>("rename_group", { groupId, name }),
  deleteGroup: (groupId: string) => call<Session>("delete_group", { groupId }),
  renameCapture: (captureId: string, name: string) =>
    call<Session>("rename_capture", { captureId, name }),
  deleteCapture: (captureId: string) => call<Session>("delete_capture", { captureId }),
  reorderCaptures: (groupId: string, captureIds: string[]) =>
    call<Session>("reorder_captures", { groupId, captureIds }),
  moveCaptureToGroup: (captureId: string, groupId: string, index?: number) =>
    call<Session>("move_capture_to_group", { captureId, groupId, index: index ?? null }),
};

/** The label of the window this page runs in ("main", "settings"). */
export function windowLabel(): string {
  if (isTauri) return getCurrentWebviewWindow().label;
  return new URLSearchParams(window.location.search).get("window") ?? "main";
}
