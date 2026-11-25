import { Button, Section, Select, Switch } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { HotkeyNotice } from "../components/HotkeyNotice";
import { useT } from "../i18n";
import { BUILT_INS, normalizeTemplate, type Template } from "../docs/template/model";
import { useTemplateName } from "../docs/template/TemplatePanel";
import { ipc } from "../ipc";
import { FolderSetting, Setting, type PageProps } from "./pages";
import { Kbd, ShortcutDialog } from "./ShortcutDialog";

/** Settings of Documents mode (the step recorder and the guide view). */
export function DocumentsPage({ settings, set }: PageProps) {
  const { t } = useT();
  const [dialog, setDialog] = useState<"step" | "start" | null>(null);
  const [guides, setGuides] = useState("");
  const [own, setOwn] = useState<Template[]>([]);
  const nameOf = useTemplateName();
  useEffect(() => {
    void ipc.templatesList().then((l) => setOwn(l.map(normalizeTemplate))).catch(() => undefined);
  }, []);
  const templates = [...BUILT_INS, ...own];
  useEffect(() => {
    void ipc.defaultFolders().then((d) => setGuides(d.guides)).catch(() => undefined);
  }, []);
  return (
    <>
      <HotkeyNotice />
      <Section>
        <Setting id="docStepMode" title={t("settings.docStepMode")} description={t("settings.docStepModeDesc")}>
          <Select
            label={t("settings.docStepMode")}
            value={settings.docStepMode}
            onChange={(v) => set({ docStepMode: v as "auto" | "manual" })}
            options={[
              { value: "auto", label: t("settings.docModeAuto") },
              { value: "manual", label: t("settings.docModeManualKey", { hotkey: settings.docStepHotkey }) },
            ]}
          />
        </Setting>
        <Setting id="docStepHotkey" title={t("settings.docStepHotkey")} description={t("settings.docStepHotkeyDesc")}>
          <Kbd keys={settings.docStepHotkey} />
          <Button onClick={() => setDialog("step")}>{t("settings.shortcutChange")}</Button>
        </Setting>
        <Setting id="docStartHotkey" title={t("settings.docStartHotkey")} description={t("settings.docStartHotkeyDesc")}>
          <Kbd keys={settings.docStartHotkey} />
          <Button onClick={() => setDialog("start")}>{t("settings.shortcutChange")}</Button>
        </Setting>
        <Setting id="docTyping" title={t("settings.docTyping")} description={t("settings.docTypingDesc")}>
          <Switch label={t("settings.docTyping")} checked={settings.docRecordTyping} onChange={(docRecordTyping) => set({ docRecordTyping })} />
        </Setting>
        <Setting id="docShortcuts" title={t("settings.docShortcuts")} description={t("settings.docShortcutsDesc")}>
          <Switch label={t("settings.docShortcuts")} checked={settings.docRecordShortcuts} onChange={(docRecordShortcuts) => set({ docRecordShortcuts })} />
        </Setting>
        <Setting id="docEnterTab" title={t("settings.docEnterTab")} description={t("settings.docEnterTabDesc")}>
          <Switch label={t("settings.docEnterTab")} checked={settings.docEnterTab} onChange={(docEnterTab) => set({ docEnterTab })} />
        </Setting>
        <Setting id="docTemplate" title={t("settings.docTemplate")} description={t("settings.docTemplateDesc")}>
          <Select
            label={t("settings.docTemplate")}
            value={templates.some((x) => x.id === settings.docTemplate) ? settings.docTemplate : "basic"}
            onChange={(docTemplate) => set({ docTemplate })}
            options={templates.map((x) => ({ value: x.id, label: nameOf(x) }))}
          />
        </Setting>
        <Setting id="docPicture" title={t("settings.docPicture")} description={t("settings.docPictureDesc")}>
          <Select
            label={t("settings.docPicture")}
            value={settings.docStepPicture}
            onChange={(v) => set({ docStepPicture: v as "window" | "screen" })}
            options={[
              { value: "window", label: t("settings.docPictureWindow") },
              { value: "screen", label: t("settings.docPictureScreen") },
            ]}
          />
        </Setting>
        <Setting id="docZoom" title={t("settings.docZoom")} description={t("settings.docZoomDesc")}>
          <Switch label={t("settings.docZoom")} checked={settings.docZoomDefault} onChange={(docZoomDefault) => set({ docZoomDefault })} />
        </Setting>
        <Setting id="docMarker" title={t("settings.docMarker")} description={t("settings.docMarkerDesc")}>
          <input
            type="color"
            className="colorinput"
            aria-label={t("settings.docMarker")}
            value={settings.docMarkerColor}
            onChange={(e) => set({ docMarkerColor: e.target.value.toUpperCase() })}
          />
        </Setting>
        <Setting id="docMarkerRight" title={t("guide.markerRight")}>
          <input type="color" className="colorinput" aria-label={t("guide.markerRight")} value={settings.docMarkerRight} onChange={(e) => set({ docMarkerRight: e.target.value.toUpperCase() })} />
        </Setting>
        <Setting id="docMarkerShape" title={t("guide.markerShape")}>
          <Select
            label={t("guide.markerShape")}
            value={settings.docMarkerShape}
            onChange={(v) => set({ docMarkerShape: v as typeof settings.docMarkerShape })}
            options={(["circle", "ring", "arrow", "hand", "box"] as const).map((s) => ({ value: s, label: t(`guide.shape.${s}`) }))}
          />
        </Setting>
        <Setting id="docMarkerSize" title={t("guide.markerSize")}>
          <Select
            label={t("guide.markerSize")}
            value={settings.docMarkerSize}
            onChange={(v) => set({ docMarkerSize: v as typeof settings.docMarkerSize })}
            options={(["small", "medium", "large"] as const).map((s) => ({ value: s, label: t(`guide.size.${s}`) }))}
          />
        </Setting>
        <Setting id="docBadge" title={t("guide.badge")}>
          <Select
            label={t("guide.badge")}
            value={settings.docBadgeStyle}
            onChange={(v) => set({ docBadgeStyle: v as typeof settings.docBadgeStyle })}
            options={(["circle", "square", "none"] as const).map((s) => ({ value: s, label: t(`guide.badge.${s}`) }))}
          />
        </Setting>
        <Setting id="docKeepFull" title={t("settings.docKeepFull")} description={t("settings.docKeepFullDesc")}>
          <Switch label={t("settings.docKeepFull")} checked={settings.docKeepFull} onChange={(docKeepFull) => set({ docKeepFull })} />
        </Setting>
        <Setting id="docGuidesDir" title={t("settings.docGuidesDir")} description={t("settings.docGuidesDirDesc")}>
          <FolderSetting label={t("settings.docGuidesDir")} value={settings.docGuidesDir} fallback={guides} onChange={(docGuidesDir) => set({ docGuidesDir })} />
        </Setting>
        <Setting id="docCountdown" title={t("settings.docCountdown")} description={t("settings.docCountdownDesc")}>
          <span>{settings.recCountdown === 0 ? t("delay.none") : t("delay.seconds", { count: settings.recCountdown })}</span>
        </Setting>
      </Section>
      {dialog && (
        <ShortcutDialog
          current={dialog === "step" ? settings.docStepHotkey : settings.docStartHotkey}
          fallback={dialog === "step" ? "Ctrl+Alt+S" : "Ctrl+Alt+G"}
          other={dialog === "step" ? settings.docStartHotkey : settings.docStepHotkey}
          onClose={() => setDialog(null)}
          onSave={(keys) => {
            setDialog(null);
            set(dialog === "step" ? { docStepHotkey: keys } : { docStartHotkey: keys });
          }}
        />
      )}
    </>
  );
}
