import { I18nProvider } from "@seconddawn/i18n";
import { useSettings } from "@seconddawn/settings";
import { applyTheme } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { MainWindow } from "./components/MainWindow";
import { Countdown } from "./overlay/Countdown";
import { Overlay } from "./overlay/Overlay";
import { Toast } from "./overlay/Toast";
import { dictionaries } from "./i18n";
import { directionOf, resolveLocale } from "./language";
import { windowLabel } from "./ipc";
import { sessionStore } from "./sessionStore";
import { SettingsWindow } from "./settings/SettingsWindow";
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
  return <MainWindow />;
}
