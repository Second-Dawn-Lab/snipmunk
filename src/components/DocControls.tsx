import { Button, Select } from "@seconddawn/ui";
import { useState } from "react";
import { useT } from "../i18n";
import type { Settings } from "../settings/defaults";
import { AppIcon } from "./AppIcons";
import { Pop } from "./Pop";

const COUNTDOWNS = [0, 3, 5, 10] as const;
const SHAPES = ["circle", "ring", "arrow", "hand", "box"] as const;
const SIZES = ["small", "medium", "large"] as const;

/**
 * The top bar in Documents mode: "New guide" (the start shortcut is in its tip), the countdown (shared with recording) and a quick
 * menu with the options of the step recorder (the same ones as Settings → Documents).
 */
export function DocControls(props: { settings: Settings; onPatch: (change: Partial<Settings>) => void; onNew: () => void }) {
  const { t } = useT();
  const { settings, onPatch } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" title={t("docs.newTip", { hotkey: settings.docStartHotkey })} onClick={props.onNew}>
        <AppIcon name="documents" size={17} />
        <span>{t("docs.new")}</span>
      </Button>
      <label className="delay" title={t("rec.countdown")}>
        <AppIcon name="clock" size={16} />
        <Select
          label={t("rec.countdown")}
          value={String(settings.recCountdown)}
          onChange={(v) => onPatch({ recCountdown: Number(v) as Settings["recCountdown"] })}
          options={COUNTDOWNS.map((d) => ({ value: String(d), label: d === 0 ? t("delay.none") : t("delay.seconds", { count: d }) }))}
        />
      </label>
      <Pop
        open={open}
        onClose={() => setOpen(false)}
        label={t("guide.quickSettings")}
        trigger={
          <button type="button" className="dw-iconbtn" aria-haspopup="dialog" aria-expanded={open} aria-label={t("guide.quickSettings")} title={t("guide.quickSettings")} onClick={() => setOpen((o) => !o)}>
            <AppIcon name="docoptions" size={17} />
          </button>
        }
      >
        <div className="recopts">
          <label className="recopts__row">
            <span>{t("settings.docStepMode")}</span>
            <Select
              label={t("settings.docStepMode")}
              value={settings.docStepMode}
              onChange={(v) => onPatch({ docStepMode: v as Settings["docStepMode"] })}
              options={[
                { value: "auto", label: t("settings.docModeAuto") },
                { value: "manual", label: t("settings.docModeManual") },
              ]}
            />
          </label>
          <label className="recopts__row">
            <span>{t("settings.docPicture")}</span>
            <Select
              label={t("settings.docPicture")}
              value={settings.docStepPicture}
              onChange={(v) => onPatch({ docStepPicture: v as Settings["docStepPicture"] })}
              options={[
                { value: "window", label: t("settings.docPictureWindow") },
                { value: "screen", label: t("settings.docPictureScreen") },
              ]}
            />
          </label>
          <label className="recopts__check">
            <input type="checkbox" checked={settings.docZoomDefault} onChange={(e) => onPatch({ docZoomDefault: e.target.checked })} />
            <span>{t("settings.docZoom")}</span>
          </label>
          <label className="recopts__check">
            <input type="checkbox" checked={settings.docRecordTyping} onChange={(e) => onPatch({ docRecordTyping: e.target.checked })} />
            <span>{t("settings.docTyping")}</span>
          </label>
          <label className="recopts__check">
            <input type="checkbox" checked={settings.docRecordShortcuts} onChange={(e) => onPatch({ docRecordShortcuts: e.target.checked })} />
            <span>{t("settings.docShortcuts")}</span>
          </label>
          <label className="recopts__check">
            <input type="checkbox" checked={settings.docEnterTab} onChange={(e) => onPatch({ docEnterTab: e.target.checked })} />
            <span>{t("settings.docEnterTab")}</span>
          </label>
          <label className="recopts__row">
            <span>{t("guide.markerShape")}</span>
            <Select label={t("guide.markerShape")} value={settings.docMarkerShape} onChange={(v) => onPatch({ docMarkerShape: v as Settings["docMarkerShape"] })} options={SHAPES.map((s) => ({ value: s, label: t(`guide.shape.${s}`) }))} />
          </label>
          <label className="recopts__row">
            <span>{t("guide.markerSize")}</span>
            <Select label={t("guide.markerSize")} value={settings.docMarkerSize} onChange={(v) => onPatch({ docMarkerSize: v as Settings["docMarkerSize"] })} options={SIZES.map((s) => ({ value: s, label: t(`guide.size.${s}`) }))} />
          </label>
          <label className="recopts__row">
            <span>{t("guide.markerLeft")}</span>
            <input type="color" className="colorinput" value={settings.docMarkerColor} onChange={(e) => onPatch({ docMarkerColor: e.target.value.toUpperCase() })} />
          </label>
          <label className="recopts__row">
            <span>{t("guide.markerRight")}</span>
            <input type="color" className="colorinput" value={settings.docMarkerRight} onChange={(e) => onPatch({ docMarkerRight: e.target.value.toUpperCase() })} />
          </label>
        </div>
      </Pop>
    </>
  );
}
