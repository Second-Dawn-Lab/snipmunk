import { Button, Icon, Row, Section, Select, Switch } from "@seconddawn/ui";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState, type ReactNode } from "react";
import { HotkeyNotice } from "../components/HotkeyNotice";
import { useT } from "../i18n";
import { ipc, isTauri, type OcrStatus } from "../ipc";
import { LANGUAGES } from "../language";
import type { CaptureDelay, CaptureMode, Settings } from "./defaults";
import { Kbd, ShortcutDialog } from "./ShortcutDialog";

export interface PageProps {
  settings: Settings;
  set: (change: Partial<Settings>) => void;
}

const RETENTION_CHOICES = [0, 7, 14, 30, 90, 365];
const REPO = "https://github.com/Second-Dawn-Lab/snipmunk";

/** One setting: a row of the design system, with an id the search can scroll to and highlight. */
export function Setting(props: { id: string; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="setting" id={`setting-${props.id}`}>
      <Row title={props.title} description={props.description}>
        {props.children}
      </Row>
    </div>
  );
}

export function GeneralPage({ settings, set }: PageProps) {
  const { t } = useT();
  return (
    <Section>
      <Setting id="theme" title={t("settings.theme")} description={t("settings.themeDesc")}>
        <Select
          label={t("settings.theme")}
          value={settings.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: "system", label: t("settings.themeSystem") },
            { value: "light", label: t("settings.themeLight") },
            { value: "dark", label: t("settings.themeDark") },
          ]}
        />
      </Setting>
      <Setting id="language" title={t("settings.language")} description={t("settings.languageDesc")}>
        <Select
          label={t("settings.language")}
          value={settings.language}
          onChange={(language) => set({ language })}
          options={[
            { value: "system", label: t("settings.languageSystem") },
            ...LANGUAGES.map((l) => ({ value: l.code as string, label: l.name })),
          ]}
        />
      </Setting>
      <Setting id="launchAtLogin" title={t("settings.launchAtLogin")} description={t("settings.launchAtLoginDesc")}>
        <Switch
          label={t("settings.launchAtLogin")}
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => set({ launchAtLogin })}
        />
      </Setting>
      <Setting id="closeAction" title={t("settings.closeAction")} description={t("settings.closeActionDesc")}>
        <Select
          label={t("settings.closeAction")}
          value={settings.closeAction}
          onChange={(closeAction) => set({ closeAction })}
          options={[
            { value: "background", label: t("settings.closeBackground") },
            { value: "quit", label: t("settings.closeQuit") },
            { value: "ask", label: t("settings.closeAsk") },
          ]}
        />
      </Setting>
      <Setting id="alwaysOnTop" title={t("settings.alwaysOnTop")} description={t("settings.alwaysOnTopDesc")}>
        <Switch
          label={t("settings.alwaysOnTop")}
          checked={settings.alwaysOnTop}
          onChange={(alwaysOnTop) => set({ alwaysOnTop })}
        />
      </Setting>
      <Setting id="editorWheel" title={t("settings.editorWheel")} description={t("settings.editorWheelDesc")}>
        <Select
          label={t("settings.editorWheel")}
          value={settings.editorWheel}
          onChange={(editorWheel) => set({ editorWheel })}
          options={[
            { value: "zoom", label: t("settings.wheelZoom") },
            { value: "scroll", label: t("settings.wheelScroll") },
          ]}
        />
      </Setting>
    </Section>
  );
}

export function OcrPage({ settings, set }: PageProps) {
  const { t } = useT();
  const [status, setStatus] = useState<OcrStatus | null>(null);
  useEffect(() => {
    let gone = false;
    ipc.ocrStatus().then((s) => !gone && setStatus(s), () => !gone && setStatus({ engine: "windows", available: false, languages: [] }));
    return () => {
      gone = true;
    };
  }, []);
  const languages = status?.languages ?? [];
  return (
    <Section>
      <Setting id="ocrEngine" title={t("settings.ocrEngine")} description={t("settings.ocrEngineDesc")}>
        <span>{t("settings.ocrEngineValue")}</span>
      </Setting>
      <Setting id="ocrAuto" title={t("settings.ocrAuto")} description={t("settings.ocrAutoDesc")}>
        <Switch label={t("settings.ocrAuto")} checked={settings.ocrAuto} onChange={(ocrAuto) => set({ ocrAuto })} />
      </Setting>
      <Setting id="ocrLanguages" title={t("settings.ocrLanguages")} description={t("settings.ocrLanguagesDesc")}>
        <Select
          label={t("settings.ocrLanguages")}
          value={settings.ocrLanguages === "auto" || languages.some((l) => l.tag === settings.ocrLanguages) ? settings.ocrLanguages : "auto"}
          onChange={(ocrLanguages) => set({ ocrLanguages })}
          options={[{ value: "auto", label: t("settings.ocrLanguagesAuto") }, ...languages.map((l) => ({ value: l.tag, label: l.name }))]}
        />
      </Setting>
      <Setting id="ocrInstalled" title={t("settings.ocrInstalled")} description={t("settings.ocrAddLanguageDesc")}>
        <div className="ocrlangs">
          <span>{status === null ? "…" : languages.length > 0 ? languages.map((l) => l.name).join(", ") : t("settings.ocrInstalledNone")}</span>
          <Button onClick={() => void ipc.openOsSettings("language")} aria-label={t("settings.ocrAddLanguage")}>
            {t("settings.ocrOpenSettings")}
          </Button>
        </div>
      </Setting>
      <Setting id="ocrModels" title={t("settings.ocrModels")} description={t("settings.ocrModelsDesc")}>
        <span>{t("settings.ocrModelsValue")}</span>
      </Setting>
      <Setting id="quickRedact" title={t("settings.quickRedact")} description={t("settings.quickRedactDesc")}>
        <div className="ocrlangs">
          <Switch label={t("ocr.redactEmail")} checked={settings.quickRedactEmail} onChange={(quickRedactEmail) => set({ quickRedactEmail })} />
          <span>{t("ocr.redactEmail")}</span>
          <Switch label={t("ocr.redactPhone")} checked={settings.quickRedactPhone} onChange={(quickRedactPhone) => set({ quickRedactPhone })} />
          <span>{t("ocr.redactPhone")}</span>
          <Switch label={t("ocr.redactCard")} checked={settings.quickRedactCard} onChange={(quickRedactCard) => set({ quickRedactCard })} />
          <span>{t("ocr.redactCard")}</span>
          <Switch label={t("ocr.redactIban")} checked={settings.quickRedactIban} onChange={(quickRedactIban) => set({ quickRedactIban })} />
          <span>{t("ocr.redactIban")}</span>
          <Switch label={t("ocr.redactSecret")} checked={settings.quickRedactSecret} onChange={(quickRedactSecret) => set({ quickRedactSecret })} />
          <span>{t("ocr.redactSecret")}</span>
          <Switch label={t("ocr.redactCustom")} checked={settings.quickRedactCustom} onChange={(quickRedactCustom) => set({ quickRedactCustom })} />
          <span>{t("ocr.redactCustom")}</span>
        </div>
      </Setting>
      <Setting id="ocrWords" title={t("settings.ocrWords")} description={t("settings.ocrWordsDesc")}>
        <WordList settings={settings} set={set} />
      </Setting>
    </Section>
  );
}

/** The words Quick redact always covers: add, remove, whole words only. */
function WordList({ settings, set }: PageProps) {
  const { t } = useT();
  const [text, setText] = useState("");
  const words = settings.quickRedactWords;
  const add = () => {
    const w = text.trim();
    if (!w || words.some((x) => x.toLowerCase() === w.toLowerCase())) return setText("");
    set({ quickRedactWords: [...words, w], quickRedactCustom: true });
    setText("");
  };
  return (
    <div className="wordlist">
      <div className="wordlist__add">
        <input
          className="wordlist__input"
          value={text}
          placeholder={t("settings.ocrWordPlaceholder")}
          aria-label={t("settings.ocrWordPlaceholder")}
          maxLength={100}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button onClick={add}>{t("settings.ocrWordAdd")}</Button>
      </div>
      <div className="ocrlangs">
        <Switch label={t("settings.ocrWordWhole")} checked={settings.quickRedactWholeWord} onChange={(quickRedactWholeWord) => set({ quickRedactWholeWord })} />
        <span>{t("settings.ocrWordWhole")}</span>
      </div>
      {words.length === 0 ? (
        <p className="wordlist__none">{t("settings.ocrWordsNone")}</p>
      ) : (
        <ul className="wordlist__list">
          {words.map((w) => (
            <li key={w}>
              <span className="wordlist__word">{w}</span>
              <button
                type="button"
                className="wordlist__remove"
                aria-label={t("settings.ocrWordRemove", { word: w })}
                title={t("settings.ocrWordRemove", { word: w })}
                onClick={() => set({ quickRedactWords: words.filter((x) => x !== w) })}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A folder setting: the folder in use (the default when none is chosen), Choose… and Default. */
export function FolderSetting(props: { label: string; value: string; fallback: string; onChange: (folder: string) => void }) {
  const { t } = useT();
  return (
    <div className="foldersetting">
      <span className="foldersetting__path" dir="ltr" title={props.value || props.fallback}>
        {props.value || props.fallback}
      </span>
      <Button
        onClick={() =>
          void ipc
            .pickFolder(props.value || props.fallback)
            .then((f) => f && props.onChange(f))
            .catch(() => undefined)
        }
      >
        {t("settings.chooseFolder")}
      </Button>
      {props.value !== "" && <Button onClick={() => props.onChange("")}>{t("settings.folderDefault")}</Button>}
    </div>
  );
}

export function ScreenshotsPage({ settings, set }: PageProps) {
  const { t } = useT();
  const [recording, setRecording] = useState(false);
  const [defaults, setDefaults] = useState({ recordings: "", pictures: "" });
  useEffect(() => {
    void ipc.defaultFolders().then(setDefaults).catch(() => undefined);
  }, []);
  return (
    <>
      <HotkeyNotice />
      <Section>
        <Setting id="captureHotkey" title={t("settings.captureHotkey")} description={t("settings.captureHotkeyDesc")}>
          <Kbd keys={settings.captureHotkey} />
          <Button onClick={() => setRecording(true)}>{t("settings.shortcutChange")}</Button>
        </Setting>
        <Setting id="captureMode" title={t("settings.captureMode")} description={t("settings.captureModeDesc")}>
          <Select
            label={t("settings.captureMode")}
            value={settings.captureMode}
            onChange={(captureMode) => set({ captureMode: captureMode as CaptureMode })}
            options={(["rectangle", "window", "fullscreen", "freeform", "scrolling"] as const).map((m) => ({
              value: m,
              label: t(`mode.${m}`),
            }))}
          />
        </Setting>
        <Setting id="captureDelay" title={t("settings.captureDelay")} description={t("settings.captureDelayDesc")}>
          <Select
            label={t("settings.captureDelay")}
            value={String(settings.captureDelay)}
            onChange={(v) => set({ captureDelay: Number(v) as CaptureDelay })}
            options={[0, 3, 5, 10].map((d) => ({
              value: String(d),
              label: d === 0 ? t("delay.none") : t("delay.seconds", { count: d }),
            }))}
          />
        </Setting>
        <Setting id="afterCapture" title={t("settings.afterCapture")} description={t("settings.afterCaptureDesc")}>
          <Select
            label={t("settings.afterCapture")}
            value={settings.afterCapture}
            onChange={(afterCapture) => set({ afterCapture })}
            options={[
              { value: "front", label: t("settings.afterFront") },
              { value: "background", label: t("settings.afterBackground") },
            ]}
          />
        </Setting>
        <Setting id="scrollMax" title={t("settings.scrollMax")} description={t("settings.scrollMaxDesc")}>
          <Select
            label={t("settings.scrollMax")}
            value={String(settings.scrollMaxHeight)}
            onChange={(v) => set({ scrollMaxHeight: Number(v) })}
            options={[5000, 10000, 20000, 32000].map((h) => ({ value: String(h), label: t("scroll.px", { height: h }) }))}
          />
        </Setting>
        <Setting id="scrollBack" title={t("settings.scrollBack")} description={t("settings.scrollBackDesc")}>
          <Switch label={t("settings.scrollBack")} checked={settings.scrollBack} onChange={(scrollBack) => set({ scrollBack })} />
        </Setting>
        <Setting id="autoCopy" title={t("settings.autoCopy")} description={t("settings.autoCopyDesc")}>
          <Switch
            label={t("settings.autoCopy")}
            checked={settings.autoCopyToClipboard}
            onChange={(autoCopyToClipboard) => set({ autoCopyToClipboard })}
          />
        </Setting>
        <Setting id="magnifier" title={t("settings.magnifier")} description={t("settings.magnifierDesc")}>
          <Switch
            label={t("settings.magnifier")}
            checked={settings.showMagnifier}
            onChange={(showMagnifier) => set({ showMagnifier })}
          />
        </Setting>
        <Setting id="autoSave" title={t("settings.autoSave")} description={t("settings.autoSaveDesc")}>
          <Switch label={t("settings.autoSave")} checked={settings.autoSaveScreenshots} onChange={(autoSaveScreenshots) => set({ autoSaveScreenshots })} />
        </Setting>
        {settings.autoSaveScreenshots && (
          <>
            <Setting id="autoSaveDir" title={t("settings.autoSaveDir")} description={t("settings.autoSaveDirDesc")}>
              <FolderSetting label={t("settings.autoSaveDir")} value={settings.autoSaveDir} fallback={defaults.pictures} onChange={(autoSaveDir) => set({ autoSaveDir })} />
            </Setting>
            <Setting id="autoSaveNaming" title={t("settings.autoSaveNaming")} description="">
              <Select
                label={t("settings.autoSaveNaming")}
                value={settings.saveNaming}
                onChange={(saveNaming) => set({ saveNaming: saveNaming as typeof settings.saveNaming })}
                options={(["capture", "group", "dateTime"] as const).map((n) => ({ value: n, label: t(`naming.${n}`) }))}
              />
            </Setting>
          </>
        )}
      </Section>
      {recording && (
        <ShortcutDialog
          current={settings.captureHotkey}
          other={settings.recordHotkey}
          onClose={() => setRecording(false)}
          onSave={(captureHotkey) => {
            setRecording(false);
            set({ captureHotkey });
          }}
        />
      )}
    </>
  );
}

function TextSetting(props: { label: string; value: string; placeholder?: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== props.value) props.onCommit(next);
    else setDraft(props.value);
  };
  return (
    <input
      className="textsetting"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(props.value);
      }}
    />
  );
}

export function SessionsPage({ settings, set }: PageProps) {
  const { t } = useT();
  // Offer the saved value even if it is not one of the usual choices.
  const retention = RETENTION_CHOICES.includes(settings.retentionDays)
    ? RETENTION_CHOICES
    : [...RETENTION_CHOICES, settings.retentionDays].sort((a, b) => a - b);
  return (
    <Section>
      <Setting id="galleryView" title={t("settings.galleryView")} description={t("settings.galleryViewDesc")}>
        <Select
          label={t("settings.galleryView")}
          value={settings.galleryView}
          onChange={(galleryView) => set({ galleryView })}
          options={[
            { value: "list", label: t("view.list") },
            { value: "medium", label: t("view.medium") },
            { value: "large", label: t("view.large") },
          ]}
        />
      </Setting>
      <Setting id="exportFolder" title={t("settings.exportFolder")} description={t("settings.exportFolderDesc")}>
        <TextSetting
          label={t("settings.exportFolder")}
          placeholder={t("settings.exportFolderPlaceholder")}
          value={settings.exportFolder}
          onCommit={(exportFolder) => set({ exportFolder })}
        />
      </Setting>
      <Setting id="clearOnExit" title={t("settings.clearOnExit")} description={t("settings.clearOnExitDesc")}>
        <Switch
          label={t("settings.clearOnExit")}
          checked={settings.clearOnExit}
          onChange={(clearOnExit) => set({ clearOnExit })}
        />
      </Setting>
      <Setting id="retention" title={t("settings.retention")} description={t("settings.retentionDesc")}>
        <Select
          label={t("settings.retention")}
          value={String(settings.retentionDays)}
          onChange={(days) => set({ retentionDays: Number(days) })}
          options={retention.map((days) => ({
            value: String(days),
            label: days === 0 ? t("settings.retentionForever") : t("settings.retentionDays", { days }),
          }))}
        />
      </Setting>
    </Section>
  );
}

export function CopyPage({ settings, set }: PageProps) {
  const { t } = useT();
  return (
    <Section>
      <Setting id="defaultCopyMode" title={t("settings.defaultCopyMode")} description={t("settings.defaultCopyModeDesc")}>
        <Select
          label={t("settings.defaultCopyMode")}
          value={settings.defaultCopyMode}
          onChange={(defaultCopyMode) => set({ defaultCopyMode })}
          options={[
            { value: "separate", label: t("copyMode.separate") },
            { value: "stack", label: t("copyMode.stack") },
            { value: "grid", label: t("copyMode.grid") },
          ]}
        />
      </Setting>
    </Section>
  );
}

export function AboutPage() {
  const { t } = useT();
  const [version, setVersion] = useState("0.0.0");
  useEffect(() => {
    if (isTauri) void getVersion().then(setVersion).catch(() => undefined);
  }, []);
  const open = (url: string) => void ipc.openUrl(url).catch(() => undefined);
  return (
    <>
      <div className="about">
        <div className="about__name">{t("app.name")}</div>
        <div className="about__tagline">{t("app.tagline")}</div>
        <div className="about__version">{t("about.version", { version })}</div>
      </div>
      <Section>
        <Setting id="updates" title={t("about.updates")} description={t("about.updatesDesc")}>
          <button type="button" className="dw-btn" aria-disabled="true" title={`${t("about.updates")} – ${t("soon.label")}`}>
            <Icon name="download" size={16} />
            {t("about.updates")}
          </button>
        </Setting>
        <Setting id="github" title={t("about.github")} description={t("about.githubDesc")}>
          <Button icon="external" onClick={() => open(REPO)}>
            {t("about.open")}
          </Button>
        </Setting>
        <Setting id="license" title={t("about.license")} description={t("about.licenseDesc")}>
          <Button icon="external" onClick={() => open(`${REPO}/blob/main/LICENSE`)}>
            {t("about.open")}
          </Button>
        </Setting>
        <Setting id="translations" title={t("about.translations")} description={t("about.translationsDesc")}>
          <Button icon="external" onClick={() => open(`${REPO}/issues`)}>
            {t("about.helpTranslate")}
          </Button>
        </Setting>
      </Section>
    </>
  );
}
