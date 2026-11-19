import { Button, IconButton, Select } from "@seconddawn/ui";
import { useState } from "react";
import { useT } from "../i18n";
import type { CaptureDelay, CaptureMode, Settings } from "../settings/defaults";
import { RecordControls } from "./RecordControls";

type CaptureSettings = Settings;
import { AppIcon, type AppIconName } from "./AppIcons";
import { hotkeyLabel } from "./hotkeyLabel";
import { MenuItem } from "./MenuItem";
import { SubmenuItem } from "./SubmenuItem";
import { Pop } from "./Pop";

export interface ShareApi {
  hasCapture: boolean;
  busy: boolean;
  canShare: boolean;
  onPaint: () => void;
  onSave: () => void;
  onCopy: () => void;
  onShare: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onPrint: () => void;
}

export interface ZoomApi {
  percent: number;
  enabled: boolean;
  actual: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

const MODES: { id: CaptureMode; icon: AppIconName }[] = [
  { id: "rectangle", icon: "rectangle" },
  { id: "window", icon: "window" },
  { id: "fullscreen", icon: "fullscreen" },
  { id: "freeform", icon: "freeform" },
];
const DELAYS: CaptureDelay[] = [0, 3, 5, 10];

const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/**
 * The top bar, like the Snipping Tool's: Add capture with its mode menu, the delay, screenshot/recording, New
 * session on the left; Edit in Paint, Save, Copy, Share, Zoom and More on the right. Those on the right act on the
 * capture shown in the preview. Everything that needs capture, export or sharing is a placeholder for now.
 */
export function TopBar(props: {
  settings: Settings;
  onPatch: (change: Partial<Settings>) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  /** Start a capture, optionally in this mode (picked from the mode menu). */
  onCapture: (mode?: CaptureMode) => void;
  zoom: ZoomApi;
  /** Start a recording of an area (the recording mode). */
  onRecord: (area: CaptureSettings["recMode"]) => void;
  /** What the buttons on the right do with the capture shown in the preview. */
  share: ShareApi;
}) {
  const { t, locale } = useT();
  const { settings, zoom, share } = props;
  const video = settings.captureKind === "video";
  const off = !share.hasCapture || share.busy;
  const [modeOpen, setModeOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const hotkey = hotkeyLabel(settings.captureHotkey, locale);
  const mode = MODES.find((m) => m.id === settings.captureMode) ?? MODES[0];
  const key = (k: string) => hotkeyLabel(k, locale);

  // Choosing a mode from the menu starts a capture in that mode, like the Snipping Tool's New menu.
  const pickMode = (id: CaptureMode) => {
    setModeOpen(false);
    props.onCapture(id);
  };

  const zoomItems = (afterSelect: () => void) => (
    <>
      <MenuItem label={t("zoom.actual")} hint={key("Ctrl+0")} disabled={!zoom.enabled} onSelect={() => { afterSelect(); zoom.actual(); }} />
      <MenuItem label={t("zoom.in")} hint={key("Ctrl++")} disabled={!zoom.enabled} onSelect={() => { afterSelect(); zoom.zoomIn(); }} />
      <MenuItem label={t("zoom.out")} hint={key("Ctrl+-")} disabled={!zoom.enabled} onSelect={() => { afterSelect(); zoom.zoomOut(); }} />
      <MenuItem label={t("zoom.fit")} hint={key("Ctrl+1")} disabled={!zoom.enabled} onSelect={() => { afterSelect(); zoom.fit(); }} />
    </>
  );

  return (
    <div className="topbar" role="toolbar" aria-label={t("app.name")}>
      <div className="topbar__group">
        {video ? (
          <RecordControls settings={settings} onPatch={props.onPatch} onRecord={props.onRecord} />
        ) : (
          <>
        <Pop
          open={modeOpen}
          onClose={() => setModeOpen(false)}
          kind="menu"
          label={t("capture.modes")}
          trigger={
            <span className="splitbtn">
              <button
                type="button"
                className="splitbtn__main"
                title={t("capture.addTip", { hotkey })}
                onClick={() => props.onCapture()}
              >
                <AppIcon name={mode.icon} size={17} />
                <span>{t("capture.add")}</span>
              </button>
              <button
                type="button"
                className="splitbtn__more"
                aria-haspopup="menu"
                aria-expanded={modeOpen}
                aria-label={t("capture.modes")}
                title={t("capture.modes")}
                onClick={() => setModeOpen((o) => !o)}
              >
                <AppIcon name="chevron" size={14} />
              </button>
            </span>
          }
        >
          {MODES.map((m) => (
            <MenuItem
              key={m.id}
              role="menuitemradio"
              icon={m.icon}
              label={t(`mode.${m.id}`)}
              checked={m.id === settings.captureMode}
              onSelect={() => pickMode(m.id)}
            />
          ))}
        </Pop>

        <label className="delay" title={t("capture.delay")}>
          <AppIcon name="clock" size={16} />
          <Select
            label={t("capture.delay")}
            value={String(settings.captureDelay)}
            onChange={(v) => props.onPatch({ captureDelay: Number(v) as CaptureDelay })}
            options={DELAYS.map((d) => ({
              value: String(d),
              label: d === 0 ? t("delay.none") : t("delay.seconds", { count: d }),
            }))}
          />
        </label>
          </>
        )}

        <div className="segmented" role="group" aria-label={t("kind.label")}>
          <button
            type="button"
            className="segmented__btn"
            aria-pressed={!video}
            title={t("kind.screenshot")}
            aria-label={t("kind.screenshot")}
            onClick={() => props.onPatch({ captureKind: "screenshot" })}
          >
            <AppIcon name="camera" size={17} />
          </button>
          <button
            type="button"
            className="segmented__btn"
            aria-pressed={video}
            title={t("kind.recording")}
            aria-label={t("kind.recording")}
            onClick={() => props.onPatch({ captureKind: "video" })}
          >
            <AppIcon name="video" size={17} />
          </button>
        </div>

        <Button icon="plus" onClick={props.onNewSession}>
          {t("header.newSession")}
        </Button>
      </div>

      <div className="topbar__group topbar__group--end">
        <button
          type="button"
          className="editbtn"
          disabled={off}
          onClick={share.onPaint}
          title={isWindows ? t("actions.editPaintTip") : t("actions.openEditorTip")}
        >
          <AppIcon name="paint" size={17} />
          <span>{isWindows ? t("actions.editPaint") : t("actions.openEditor")}</span>
        </button>
        <ActionButton icon="save" label={t("actions.save")} tip={t("actions.saveTip")} disabled={off} onClick={share.onSave} />
        <ActionButton icon="copy" label={t("actions.copy")} tip={t("actions.copyTip")} disabled={off} onClick={share.onCopy} />
        <ActionButton
          icon="share"
          label={t("actions.share")}
          tip={share.canShare ? t("actions.shareTip") : t("share.unsupported")}
          disabled={off || !share.canShare}
          onClick={share.onShare}
        />

        <Pop
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
          kind="menu"
          align="end"
          label={t("actions.zoom")}
          trigger={
            <button
              type="button"
              className="dw-iconbtn"
              aria-label={t("zoom.current", { percent: zoom.percent })}
              title={t("zoom.current", { percent: zoom.percent })}
              aria-haspopup="menu"
              aria-expanded={zoomOpen}
              disabled={!zoom.enabled}
              onClick={() => setZoomOpen((o) => !o)}
            >
              <AppIcon name="zoom" size={17} />
            </button>
          }
        >
          {zoomItems(() => setZoomOpen(false))}
        </Pop>

        <Pop
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          kind="menu"
          align="end"
          label={t("actions.more")}
          trigger={
            <IconButton
              icon="more"
              label={t("actions.more")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            />
          }
        >
          <SubmenuItem label={t("menu.zoom")} icon="zoom">
            {zoomItems(() => setMoreOpen(false))}
          </SubmenuItem>
          <MenuItem label={t("menu.openFile")} icon="openfile" hint={key("Ctrl+O")} disabled={share.busy} onSelect={() => { setMoreOpen(false); share.onOpenFile(); }} />
          <MenuItem label={t("menu.openFolder")} icon="window" onSelect={() => { setMoreOpen(false); share.onOpenFolder(); }} />
          <MenuItem label={t("menu.print")} icon="print" hint={key("Ctrl+P")} disabled={off} onSelect={() => { setMoreOpen(false); share.onPrint(); }} />
          <MenuItem
            label={t("menu.settings")}
            icon="settings"
            onSelect={() => {
              setMoreOpen(false);
              props.onOpenSettings();
            }}
          />
        </Pop>
      </div>
    </div>
  );
}

/** An icon-only button with a tooltip (also while it is disabled). */
function ActionButton(props: { icon: AppIconName; label: string; tip: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="dw-iconbtn" disabled={props.disabled} aria-label={props.label} title={props.tip} onClick={props.onClick}>
      <AppIcon name={props.icon} size={17} />
    </button>
  );
}
