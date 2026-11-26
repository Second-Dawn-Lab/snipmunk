import { I18nProvider } from "@seconddawn/i18n";
import { useSettings } from "@seconddawn/settings";
import { applyTheme } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { GuideBar } from "./components/GuideBar";
import { GuideFrame } from "./components/GuideFrame";
import { ScrollPill } from "./components/ScrollPill";
import { WebcamBubble } from "./components/WebcamBubble";
import { RecBar } from "./components/RecBar";
import { Countdown } from "./overlay/Countdown";
import { Overlay } from "./overlay/Overlay";
import { Toast } from "./overlay/Toast";
import { dictionaries } from "./i18n";
import { directionOf, resolveLocale } from "./language";
import { ipc, windowLabel } from "./ipc";
import { sessionStore } from "./sessionStore";
import { isEditable, ShortcutRouter } from "./settings/shortcutRouter";
import { settingsStore } from "./settings/store";
import { preloadMode } from "./lazyViews";
import { loadable } from "./loadable";

// The two large windows load their code when they are the window; the small ones (overlay, countdown, notice, bars) are
// part of the first file, so they are there quickly.
const MainWindow = loadable(() => import("./components/MainWindow").then((m) => m.MainWindow));
const SettingsWindow = loadable(() => import("./settings/SettingsWindow").then((m) => m.SettingsWindow));

const label = windowLabel();

export function App() {
  const { settings } = useSettings(settingsStore);
  const [ready, setReady] = useState(false);
  const locale = resolveLocale(settings.language);

  useEffect(() => {
    const loads = [settingsStore.init()];
    if (label === "settings") loads.push(SettingsWindow.preload());
    // Only the main window shows the session.
    if (label === "main") {
      // Its code is fetched while the settings and the session are read.
      loads.push(MainWindow.preload());
      loads.push(sessionStore.init());
      loads.push(loads[0].then(() => preloadMode(settingsStore.getState().captureKind)));
    }
    Promise.all(loads).finally(() => setReady(true));
  }, []);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  // The capture shortcut inside Snipmunk's own windows: WebView2 takes the keys before the keyboard hook of the backend
  // sees them, so the page matches the shortcut too. The backend runs each key press once (`shortcut_fired`).
  // Not while the shortcut dialog records a new shortcut.
  useEffect(() => {
    if (label !== "main" && label !== "settings") return;
    // Each shortcut has its own router; the backend runs every key press once, per shortcut.
    const routers: [ShortcutRouter, "capture" | "record"][] = [
      [new ShortcutRouter(settings.captureHotkey), "capture"],
      [new ShortcutRouter(settings.recordHotkey), "record"],
    ];
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".shortcut-capture")) return;
      const key = { code: e.code, repeat: e.repeat, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altGraph: e.getModifierState("AltGraph") };
      for (const [router, name] of routers) {
        if (!router.onKey(key, e.type === "keyup" ? "keyup" : "keydown", isEditable(document.activeElement))) continue;
        e.preventDefault();
        e.stopPropagation();
        void ipc.shortcutFired(name);
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [settings.captureHotkey, settings.recordHotkey]);

  useEffect(() => {
    // The direction comes from the locale (language.ts), never from a per-language rule in the CSS or components.
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
    document.documentElement.dataset.window = label;
  }, [locale]);

  return (
    <I18nProvider locale={locale} dictionaries={dictionaries}>
      {ready && <Root label={label} />}
      {ready && label === "main" && <Painted />}
    </I18nProvider>
  );
}

/** Shown beside the main window's content once that is there. When its first frame is painted, the backend is told, and
    shows the window (start-up). A window that is still hidden may get no animation frames, so a short timer reports it
    too. */
function Painted() {
  useEffect(() => {
    let reported = false;
    const report = (byFrame: boolean) => {
      if (reported) return;
      reported = true;
      void ipc.appReady(performance.now(), byFrame);
    };
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => report(true))));
    // (in a hidden window frames can be slow to come: 50 ms is the longest the start waits for them)
    const timer = window.setTimeout(() => report(false), 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}

/** Every window loads this page; the window's label says which one it is. */
function Root({ label }: { label: string }) {
  if (label === "settings") return <SettingsWindow />;
  if (label.startsWith("overlay-")) return <Overlay />;
  if (label === "toast") return <Toast />;
  if (label === "countdown") return <Countdown />;
  if (label === "recframe") return <div className="recframe" />;
  if (label === "guideframe") return <GuideFrame />;
  if (label === "recbar") return <RecBar />;
  if (label === "webcambubble") return <WebcamBubble />;
  if (label === "scrollpill") return <ScrollPill />;
  if (label === "guidebar") return <GuideBar />;
  if (label === "scrollframe") return <div className="recframe recframe--scroll" />;
  return <MainWindow />;
}
