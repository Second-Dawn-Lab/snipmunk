import { I18nProvider } from "@seconddawn/i18n";
import { useSettings } from "@seconddawn/settings";
import { applyTheme } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { MainWindow } from "./components/MainWindow";
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
import { SettingsWindow } from "./settings/SettingsWindow";
import { isEditable, ShortcutRouter } from "./settings/shortcutRouter";
import { settingsStore } from "./settings/store";

const label = windowLabel();

export function App() {
  const { settings } = useSettings(settingsStore);
  const [ready, setReady] = useState(false);
  const locale = resolveLocale(settings.language);

  useEffect(() => {
    const loads = [settingsStore.init()];
    // Only the main window shows the session.
    if (label === "main") loads.push(sessionStore.init());
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
    </I18nProvider>
  );
}

/** Every window loads this page; the window's label says which one it is. */
function Root({ label }: { label: string }) {
  if (label === "settings") return <SettingsWindow />;
  if (label.startsWith("overlay-")) return <Overlay />;
  if (label === "toast") return <Toast />;
  if (label === "countdown") return <Countdown />;
  if (label === "recframe") return <div className="recframe" />;
  if (label === "recbar") return <RecBar />;
  if (label === "webcambubble") return <WebcamBubble />;
  if (label === "scrollpill") return <ScrollPill />;
  return <MainWindow />;
}
