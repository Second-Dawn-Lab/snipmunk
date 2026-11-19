import { Select } from "@seconddawn/ui";
import { useState } from "react";
import { useT } from "../i18n";
import type { Settings } from "../settings/defaults";
import { AppIcon } from "./AppIcons";
import { MenuItem } from "./MenuItem";
import { Pop } from "./Pop";

const AREAS = ["rectangle", "window", "fullscreen"] as const;
const COUNTDOWNS = [0, 3, 5, 10] as const;

/**
 * The top bar in the recording mode: the red Record button with the area menu, the countdown and the recording options (the
 * options belong to the recording mode, not to the Settings window, like the Snipping Tool's).
 */
export function RecordControls(props: { settings: Settings; onPatch: (change: Partial<Settings>) => void; onRecord: (area: Settings["recMode"]) => void }) {
  const { t } = useT();
  const { settings, onPatch } = props;
  const [areaOpen, setAreaOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const soon = t("rec.soon");
  return (
    <>
      <Pop
        open={areaOpen}
        onClose={() => setAreaOpen(false)}
        kind="menu"
        label={t("rec.modes")}
        trigger={
          <span className="splitbtn splitbtn--record">
            <button type="button" className="splitbtn__main" title={t("rec.recordTip")} onClick={() => props.onRecord(settings.recMode)}>
              <span className="recdot" aria-hidden="true" />
              <span>{t("rec.record")}</span>
            </button>
            <button
              type="button"
              className="splitbtn__more"
              aria-haspopup="menu"
              aria-expanded={areaOpen}
              aria-label={t("rec.modes")}
              title={t("rec.modes")}
              onClick={() => setAreaOpen((o) => !o)}
            >
              <AppIcon name="chevron" size={14} />
            </button>
          </span>
        }
      >
        {AREAS.map((a) => (
          <MenuItem
            key={a}
            role="menuitemradio"
            icon={a}
            label={t(`mode.${a}`)}
            checked={settings.recMode === a}
            onSelect={() => {
              setAreaOpen(false);
              onPatch({ recMode: a });
              props.onRecord(a);
            }}
          />
        ))}
      </Pop>

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
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        label={t("rec.options")}
        trigger={
          <button
            type="button"
            className="dw-iconbtn"
            aria-haspopup="dialog"
            aria-expanded={optionsOpen}
            aria-label={t("rec.options")}
            title={t("rec.options")}
            onClick={() => setOptionsOpen((o) => !o)}
          >
            <AppIcon name="settings" size={17} />
          </button>
        }
      >
        <div className="recopts">
          <label className="recopts__row">
            <span>{t("rec.fps")}</span>
            <Select
              label={t("rec.fps")}
              value={String(settings.recFps)}
              onChange={(v) => onPatch({ recFps: Number(v) as Settings["recFps"] })}
              options={[
                { value: "30", label: t("rec.fpsValue", { count: 30 }) },
                { value: "60", label: t("rec.fpsValue", { count: 60 }) },
              ]}
            />
          </label>
          <label className="recopts__row">
            <span>{t("rec.quality")}</span>
            <Select
              label={t("rec.quality")}
              value={settings.recQuality}
              onChange={(v) => onPatch({ recQuality: v })}
              options={[
                { value: "standard", label: t("rec.qStandard") },
                { value: "high", label: t("rec.qHigh") },
              ]}
            />
          </label>
          <label className="recopts__check">
            <input type="checkbox" checked={settings.recSystemSound} onChange={(e) => onPatch({ recSystemSound: e.target.checked })} />
            <span>{t("rec.sysSound")}</span>
          </label>
          <label className="recopts__check">
            <input type="checkbox" checked={settings.recMic} onChange={(e) => onPatch({ recMic: e.target.checked })} />
            <span>{t("rec.mic")}</span>
          </label>
          {settings.recMic && <p className="recopts__note">{t("rec.micDefault")}</p>}
          {(["webcam", "cursor", "clickFx"] as const).map((k) => (
            <div key={k} className="recopts__soon" aria-disabled="true" title={soon}>
              <span>{t(`rec.${k}`)}</span>
              <em>{soon}</em>
            </div>
          ))}
        </div>
      </Pop>
    </>
  );
}
