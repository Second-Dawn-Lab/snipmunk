/** Mirror of `Settings` in src-tauri/src/settings.rs (camelCase JSON). Keep the two in step. */
export interface Settings {
  theme: "system" | "light" | "dark";
  /** "system" or one of `LANGUAGES` (src/language.ts). */
  language: string;
  launchAtLogin: boolean;
  closeAction: "background" | "quit" | "ask";
  /** Stored only until Phase 3 wires the keyboard hook. */
  captureHotkey: string;
  alwaysOnTop: boolean;
  /** "" = not chosen yet. */
  exportFolder: string;
  newSessionAction: "ask" | "autoExport" | "clear";
  clearOnExit: boolean;
  /** Kept sessions older than this many days are deleted at startup; 0 = keep forever. */
  retentionDays: number;
  defaultCopyMode: CopyMode;
  /** How the capture list looks. */
  galleryView: "list" | "medium" | "large";
  captureMode: CaptureMode;
  /** Seconds before a capture. */
  captureDelay: CaptureDelay;
  /** "front": bring Snipmunk to the front; "background": show a small notification. */
  afterCapture: "front" | "background";
  autoCopyToClipboard: boolean;
  showMagnifier: boolean;
  // The last colors and sizes picked in the annotation tool popovers. Colors are "#rrggbb"; fill and outline
  // may also be "none". Opacities are 0 to 100.
  lastPenColor: string;
  lastPenSize: number;
  lastHighlighterColor: string;
  lastHighlighterSize: number;
  lastFillColor: string;
  lastFillOpacity: number;
  lastOutlineColor: string;
  lastOutlineOpacity: number;
  lastOutlineSize: number;
  // The Text tool: colour, size in image pixels, a solid label behind the text.
  lastTextColor: string;
  lastTextSize: number;
  lastTextBackground: boolean;
  /** The mouse wheel in the editor: "zoom" (wheel zooms, Shift pans) or "scroll" (wheel pans, Ctrl zooms). */
  editorWheel: "zoom" | "scroll";
  /** Recognize the text of every new capture in the background. */
  ocrAuto: boolean;
  /** "auto" (every language Windows has) or a comma separated list of language tags ("de-DE,en-GB"). */
  ocrLanguages: string;
  /** Quick redact: cover e-mail addresses / phone numbers. */
  quickRedactEmail: boolean;
  quickRedactPhone: boolean;
}

export type CaptureMode = "rectangle" | "window" | "fullscreen" | "freeform";
export type CaptureDelay = 0 | 3 | 5 | 10;

export type CopyMode = "separate" | "stack" | "grid";

export const defaultSettings: Settings = {
  theme: "system",
  language: "system",
  launchAtLogin: false,
  closeAction: "background",
  captureHotkey: "Ctrl+Alt+PrintScreen",
  alwaysOnTop: false,
  exportFolder: "",
  newSessionAction: "ask",
  clearOnExit: false,
  retentionDays: 30,
  defaultCopyMode: "separate",
  galleryView: "list",
  captureMode: "rectangle",
  captureDelay: 0,
  afterCapture: "front",
  autoCopyToClipboard: true,
  showMagnifier: true,
  lastPenColor: "#E53935",
  lastPenSize: 4,
  lastHighlighterColor: "#FFEB3B",
  lastHighlighterSize: 18,
  lastFillColor: "none",
  lastFillOpacity: 100,
  lastOutlineColor: "#E53935",
  lastOutlineOpacity: 100,
  lastOutlineSize: 3,
  lastTextColor: "#E53935",
  lastTextSize: 28,
  lastTextBackground: false,
  editorWheel: "zoom",
  ocrAuto: true,
  ocrLanguages: "auto",
  quickRedactEmail: true,
  quickRedactPhone: true,
};
