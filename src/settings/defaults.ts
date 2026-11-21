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
  /** The scrolling screenshot stops at this height (pixels). */
  scrollMaxHeight: number;
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
  /** Quick redact: credit cards, IBANs, passwords / secrets, the user's own words. */
  quickRedactCard: boolean;
  quickRedactIban: boolean;
  quickRedactSecret: boolean;
  quickRedactCustom: boolean;
  /** The user's own words to cover. */
  quickRedactWords: string[];
  /** A custom word must be a whole word. */
  quickRedactWholeWord: boolean;
  /** The top bar mode. */
  captureKind: "screenshot" | "video";
  /** Screen recording (the recording options menu in the top bar). */
  recMode: "rectangle" | "window" | "fullscreen";
  recCountdown: 0 | 3 | 5 | 10;
  recFps: 30 | 60;
  recQuality: "standard" | "high";
  recSystemSound: boolean;
  recMic: boolean;
  /** The shortcut that starts and stops a recording, from any program. */
  recordHotkey: string;
  /** Devices ("" = the Windows default; the id of a WASAPI endpoint) for the microphone and the sound of the computer. */
  micDevice: string;
  systemDevice: string;
  /** The cursor and click effects of new recordings (each recording keeps its own, changeable in its effects panel). */
  cursorShow: boolean;
  cursorSize: "1" | "1.5" | "2";
  cursorHalo: boolean;
  cursorHaloColor: string;
  clickEffect: "off" | "ripple" | "burst";
  clickLeftColor: string;
  clickRightColor: string;
  clickSize: "small" | "medium" | "large";
  /** The webcam: recorded with the screen, and how it is laid over the video. */
  webcamOn: boolean;
  webcamDevice: string;
  webcamShape: "circle" | "rounded" | "rect";
  webcamSize: "s" | "m" | "l";
  webcamPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  webcamBorder: "off" | "thin" | "medium" | "thick";
  webcamBorderColor: string;
  /** Where recordings are kept ("" = the Windows Videos folder + Snipmunk). */
  projectsDir: string;
  /** Save each screenshot automatically (to `autoSaveDir`, "" = the Pictures folder + Snipmunk). */
  autoSaveScreenshots: boolean;
  autoSaveDir: string;
  saveFormat: SaveFormat;
  saveNaming: Naming;
  /** JPEG / WebP quality, 10 to 100. */
  saveQuality: number;
  /** The folder of the last save (used when no export folder is set). */
  lastSaveFolder: string;
}

export type SaveFormat = "png" | "jpeg" | "webp" | "bmp" | "zip";
export type Naming = "capture" | "group" | "dateTime";

export type CaptureMode = "rectangle" | "window" | "fullscreen" | "freeform" | "scrolling";
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
  clearOnExit: false,
  retentionDays: 30,
  defaultCopyMode: "separate",
  galleryView: "list",
  captureMode: "rectangle",
  captureDelay: 0,
  afterCapture: "front",
  autoCopyToClipboard: true,
  scrollMaxHeight: 20000,
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
  quickRedactCard: true,
  quickRedactIban: true,
  quickRedactSecret: true,
  quickRedactCustom: true,
  quickRedactWords: [],
  quickRedactWholeWord: true,
  captureKind: "screenshot",
  recMode: "rectangle",
  recCountdown: 3,
  recFps: 30,
  recQuality: "standard",
  recSystemSound: true,
  recMic: false,
  recordHotkey: "Ctrl+Alt+R",
  micDevice: "",
  systemDevice: "",
  cursorShow: true,
  cursorSize: "1",
  cursorHalo: false,
  cursorHaloColor: "#FFD60A",
  clickEffect: "ripple",
  clickLeftColor: "#3B82F6",
  clickRightColor: "#F97316",
  clickSize: "medium",
  webcamOn: false,
  webcamDevice: "",
  webcamShape: "circle",
  webcamSize: "m",
  webcamPosition: "bottom-right",
  webcamBorder: "thin",
  webcamBorderColor: "#FFFFFF",
  projectsDir: "",
  autoSaveScreenshots: false,
  autoSaveDir: "",
  saveFormat: "png",
  saveNaming: "capture",
  saveQuality: 90,
  lastSaveFolder: "",
};
