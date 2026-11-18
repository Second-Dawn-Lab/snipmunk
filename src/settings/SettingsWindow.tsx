import { useSettings } from "@seconddawn/settings";
import { Icon } from "@seconddawn/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { WindowControls } from "../components/WindowControls";
import { useT } from "../i18n";
import { AboutPage, CapturePage, CopyPage, GeneralPage, OcrPage, SessionsPage } from "./pages";
import type { Settings } from "./defaults";
import { searchSettings, TABS, type SettingEntry, type Tab } from "./model";
import { settingsStore } from "./store";

/** How long a setting that was jumped to stays highlighted. */
const HIGHLIGHT_MS = 1800;

/** The separate Settings window: pages on the left (mirrored in right-to-left languages), a search box above them. */
export function SettingsWindow() {
  const { t, locale } = useT();
  const { settings, patch } = useSettings(settingsStore);
  const set = (change: Partial<Settings>) => void patch(change);
  const [tab, setTab] = useState<Tab>("general");
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<string | null>(null);
  const page = useRef<HTMLElement>(null);

  const results = useMemo(() => searchSettings(query, t, locale), [query, t, locale]);
  const searching = query.trim().length > 0;

  // After a jump from the search: show the page, scroll to the setting and highlight it for a moment.
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(`setting-${jump}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("setting--found");
    const timer = window.setTimeout(() => el.classList.remove("setting--found"), HIGHLIGHT_MS);
    setJump(null);
    return () => {
      window.clearTimeout(timer);
      el.classList.remove("setting--found");
    };
  }, [jump, tab]);

  const open = (entry: SettingEntry) => {
    setTab(entry.tab);
    setQuery("");
    setJump(entry.id);
  };

  const title = TABS.find((x) => x.id === tab);

  return (
    <div className="shell settings-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar__content" data-tauri-drag-region>
          <div className="titlebar__brand" data-tauri-drag-region>
            <span className="titlebar__name" data-tauri-drag-region>
              {t("settings.title")}
            </span>
          </div>
        </div>
        <WindowControls canMinimize={false} canMaximize={false} />
      </header>

      <div className="settings">
        <aside className="settings__side">
          <label className="settings__search">
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              placeholder={t("settings.search")}
              aria-label={t("settings.search")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                } else if (e.key === "Enter" && results[0]) {
                  open(results[0].entries[0]);
                }
              }}
            />
          </label>

          {searching ? (
            <div className="settings__results" role="list" aria-label={t("settings.search")}>
              {results.length === 0 && <p className="settings__none">{t("settings.noResults")}</p>}
              {results.map((group) => (
                <div key={group.tab} role="group" aria-label={t(TABS.find((x) => x.id === group.tab)!.label)}>
                  <div className="settings__group">{t(TABS.find((x) => x.id === group.tab)!.label)}</div>
                  {group.entries.map((entry) => (
                    <button key={entry.id} type="button" className="settings__result" role="listitem" onClick={() => open(entry)}>
                      {t(entry.title)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <nav className="settings__nav" aria-label={t("settings.tabs")}>
              {TABS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="settings__tab"
                  aria-current={x.id === tab ? "page" : undefined}
                  onClick={() => setTab(x.id)}
                >
                  <Icon name={x.icon} size={17} />
                  {t(x.label)}
                </button>
              ))}
            </nav>
          )}
        </aside>

        <main className="settings__page" ref={page}>
          <h2>{title ? t(title.label) : ""}</h2>
          {tab === "general" && <GeneralPage settings={settings} set={set} />}
          {tab === "capture" && <CapturePage settings={settings} set={set} />}
          {tab === "sessions" && <SessionsPage settings={settings} set={set} />}
          {tab === "copy" && <CopyPage settings={settings} set={set} />}
          {tab === "ocr" && <OcrPage settings={settings} set={set} />}
          {tab === "about" && <AboutPage />}
        </main>
      </div>
    </div>
  );
}
