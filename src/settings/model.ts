// What the settings window offers: the pages (tabs) and every setting on them, so the search can find a setting by its
// title and description in the active language. Pure (no React), so the search is unit tested.
import type { Key } from "../locales/en";

export type Tab = "general" | "screenshots" | "recording" | "documents" | "sessions" | "copy" | "ocr" | "about";

export const TABS: { id: Tab; label: Key; icon: "settings" | "scan" | "clock" | "copy" | "text" | "info" | "play" | "doc" }[] = [
  { id: "general", label: "settings.general", icon: "settings" },
  { id: "screenshots", label: "settings.tab.screenshots", icon: "scan" },
  { id: "recording", label: "settings.tab.recording", icon: "play" },
  { id: "documents", label: "settings.tab.documents", icon: "doc" },
  { id: "sessions", label: "settings.sessions", icon: "clock" },
  { id: "copy", label: "settings.tab.copy", icon: "copy" },
  { id: "ocr", label: "settings.tab.ocr", icon: "text" },
  { id: "about", label: "settings.tab.about", icon: "info" },
];

export interface SettingEntry {
  /** Used for the DOM id the search scrolls to (`setting-<id>`). */
  id: string;
  tab: Tab;
  title: Key;
  desc?: Key;
}

export const INDEX: SettingEntry[] = [
  { id: "theme", tab: "general", title: "settings.theme", desc: "settings.themeDesc" },
  { id: "language", tab: "general", title: "settings.language", desc: "settings.languageDesc" },
  { id: "launchAtLogin", tab: "general", title: "settings.launchAtLogin", desc: "settings.launchAtLoginDesc" },
  { id: "closeAction", tab: "general", title: "settings.closeAction", desc: "settings.closeActionDesc" },
  { id: "alwaysOnTop", tab: "general", title: "settings.alwaysOnTop", desc: "settings.alwaysOnTopDesc" },
  { id: "editorWheel", tab: "general", title: "settings.editorWheel", desc: "settings.editorWheelDesc" },

  { id: "captureHotkey", tab: "screenshots", title: "settings.captureHotkey", desc: "settings.captureHotkeyDesc" },
  { id: "captureMode", tab: "screenshots", title: "settings.captureMode", desc: "settings.captureModeDesc" },
  { id: "captureDelay", tab: "screenshots", title: "settings.captureDelay", desc: "settings.captureDelayDesc" },
  { id: "afterCapture", tab: "screenshots", title: "settings.afterCapture", desc: "settings.afterCaptureDesc" },
  { id: "docStepMode", tab: "documents", title: "settings.docStepMode", desc: "settings.docStepModeDesc" },
  { id: "docStepHotkey", tab: "documents", title: "settings.docStepHotkey", desc: "settings.docStepHotkeyDesc" },
  { id: "docStartHotkey", tab: "documents", title: "settings.docStartHotkey", desc: "settings.docStartHotkeyDesc" },
  { id: "docTyping", tab: "documents", title: "settings.docTyping", desc: "settings.docTypingDesc" },
  { id: "docShortcuts", tab: "documents", title: "settings.docShortcuts", desc: "settings.docShortcutsDesc" },
  { id: "docEnterTab", tab: "documents", title: "settings.docEnterTab", desc: "settings.docEnterTabDesc" },
  { id: "docPicture", tab: "documents", title: "settings.docPicture", desc: "settings.docPictureDesc" },
  { id: "docZoom", tab: "documents", title: "settings.docZoom", desc: "settings.docZoomDesc" },
  { id: "docMarker", tab: "documents", title: "settings.docMarker", desc: "settings.docMarkerDesc" },
  { id: "docMarkerRight", tab: "documents", title: "guide.markerRight" },
  { id: "docMarkerShape", tab: "documents", title: "guide.markerShape" },
  { id: "docMarkerSize", tab: "documents", title: "guide.markerSize" },
  { id: "docBadge", tab: "documents", title: "guide.badge" },
  { id: "docKeepFull", tab: "documents", title: "settings.docKeepFull", desc: "settings.docKeepFullDesc" },
  { id: "docGuidesDir", tab: "documents", title: "settings.docGuidesDir", desc: "settings.docGuidesDirDesc" },
  { id: "docCountdown", tab: "documents", title: "settings.docCountdown", desc: "settings.docCountdownDesc" },
  { id: "autoCopy", tab: "screenshots", title: "settings.autoCopy", desc: "settings.autoCopyDesc" },
  { id: "autoSave", tab: "screenshots", title: "settings.autoSave", desc: "settings.autoSaveDesc" },
  { id: "autoSaveNaming", tab: "screenshots", title: "settings.autoSaveNaming", desc: "settings.autoSaveNaming" },
  { id: "autoSaveDir", tab: "screenshots", title: "settings.autoSaveDir", desc: "settings.autoSaveDirDesc" },
  { id: "magnifier", tab: "screenshots", title: "settings.magnifier", desc: "settings.magnifierDesc" },

  { id: "recordHotkey", tab: "recording", title: "settings.recordHotkey", desc: "settings.recordHotkeyDesc" },
  { id: "projectsDir", tab: "recording", title: "settings.projectsDir", desc: "settings.projectsDirDesc" },
  { id: "micDevice", tab: "recording", title: "settings.micDevice", desc: "settings.micDeviceDesc" },
  { id: "systemDevice", tab: "recording", title: "settings.systemDevice", desc: "settings.systemDeviceDesc" },
  { id: "recFps", tab: "recording", title: "rec.fps" },
  { id: "recQuality", tab: "recording", title: "rec.quality" },
  { id: "recCountdown", tab: "recording", title: "rec.countdown" },
  { id: "recSystemSound", tab: "recording", title: "rec.sysSound" },
  { id: "recMic", tab: "recording", title: "rec.mic" },
  { id: "cursorShow", tab: "recording", title: "fx.cursorShow" },
  { id: "cursorSize", tab: "recording", title: "fx.cursorSize" },
  { id: "cursorHalo", tab: "recording", title: "fx.halo" },
  { id: "clickEffect", tab: "recording", title: "fx.click" },
  { id: "clickColors", tab: "recording", title: "fx.clickColors" },
  { id: "clickSize", tab: "recording", title: "fx.clickSize" },
  { id: "webcamOn", tab: "recording", title: "fx.webcam" },
  { id: "webcamDevice", tab: "recording", title: "settings.webcamDevice" },
  { id: "webcamShape", tab: "recording", title: "fx.webcamShape" },
  { id: "webcamSize", tab: "recording", title: "fx.webcamSize" },
  { id: "webcamPosition", tab: "recording", title: "fx.webcamPosition" },
  { id: "webcamBorder", tab: "recording", title: "fx.webcamBorder" },

  { id: "galleryView", tab: "sessions", title: "settings.galleryView", desc: "settings.galleryViewDesc" },
  { id: "exportFolder", tab: "sessions", title: "settings.exportFolder", desc: "settings.exportFolderDesc" },
  { id: "clearOnExit", tab: "sessions", title: "settings.clearOnExit", desc: "settings.clearOnExitDesc" },
  { id: "retention", tab: "sessions", title: "settings.retention", desc: "settings.retentionDesc" },

  { id: "defaultCopyMode", tab: "copy", title: "settings.defaultCopyMode", desc: "settings.defaultCopyModeDesc" },

  { id: "ocrEngine", tab: "ocr", title: "settings.ocrEngine", desc: "settings.ocrEngineDesc" },
  { id: "ocrAuto", tab: "ocr", title: "settings.ocrAuto", desc: "settings.ocrAutoDesc" },
  { id: "ocrLanguages", tab: "ocr", title: "settings.ocrLanguages", desc: "settings.ocrLanguagesDesc" },
  { id: "ocrInstalled", tab: "ocr", title: "settings.ocrInstalled", desc: "settings.ocrAddLanguageDesc" },
  { id: "ocrModels", tab: "ocr", title: "settings.ocrModels", desc: "settings.ocrModelsDesc" },
  { id: "quickRedact", tab: "ocr", title: "settings.quickRedact", desc: "settings.quickRedactDesc" },
  { id: "ocrWords", tab: "ocr", title: "settings.ocrWords", desc: "settings.ocrWordsDesc" },

  { id: "updates", tab: "about", title: "about.updates", desc: "about.updatesDesc" },
  { id: "autoUpdate", tab: "about", title: "update.auto", desc: "update.autoDesc" },
  { id: "github", tab: "about", title: "about.github", desc: "about.githubDesc" },
  { id: "license", tab: "about", title: "about.license", desc: "about.licenseDesc" },
  { id: "translations", tab: "about", title: "about.translations", desc: "about.translationsDesc" },
];

/** Lower case and without accents, so "uber" finds "Über" and "ayar" finds "Ayarlar" in any language. */
export function fold(text: string, locale: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(locale);
}

export interface SearchGroup {
  tab: Tab;
  entries: SettingEntry[];
}

/**
 * The settings whose title or description contain every word of the query, grouped by page in the order of the pages.
 * `t` gives the text in the active language, so the search follows the language of the window.
 */
export function searchSettings(
  query: string,
  t: (key: Key) => string,
  locale: string,
  index: readonly SettingEntry[] = INDEX,
): SearchGroup[] {
  const words = fold(query, locale).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const groups: SearchGroup[] = [];
  for (const tab of TABS) {
    const entries = index.filter((e) => {
      if (e.tab !== tab.id) return false;
      const text = fold(`${t(e.title)} ${e.desc ? t(e.desc) : ""}`, locale);
      return words.every((w) => text.includes(w));
    });
    if (entries.length > 0) groups.push({ tab: tab.id, entries });
  }
  return groups;
}
