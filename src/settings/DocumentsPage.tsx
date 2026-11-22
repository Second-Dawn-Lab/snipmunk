import { Button, Section, Select, Switch } from "@seconddawn/ui";
import { useState } from "react";
import { HotkeyNotice } from "../components/HotkeyNotice";
import { useT } from "../i18n";
import { Setting, type PageProps } from "./pages";
import { Kbd, ShortcutDialog } from "./ShortcutDialog";

/** Settings of Documents mode (the step recorder and the guide view). */
export function DocumentsPage({ settings, set }: PageProps) {
  const { t } = useT();
  const [dialog, setDialog] = useState<"step" | "start" | null>(null);
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
              { value: "manual", label: t("settings.docModeManual") },
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
