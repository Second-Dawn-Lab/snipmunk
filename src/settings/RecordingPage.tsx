import { Button, Section, Select, Switch } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { ClickControls, CursorControls, WebcamControls, type FieldRow } from "../components/EffectsControls";
import { HotkeyNotice } from "../components/HotkeyNotice";
import { useT } from "../i18n";
import { ipc, type AudioDevice } from "../ipc";
import { effectsFromSettings } from "../recording/effects";
import type { Settings } from "./defaults";
import { FolderSetting, Setting, type PageProps } from "./pages";
import { Kbd, ShortcutDialog } from "./ShortcutDialog";

const POLL_MS = 3000;

/** The devices Windows has now, read again every few seconds so a plugged in or removed device shows up. */
export function useDevices(): { mic: AudioDevice[]; system: AudioDevice[]; webcam: AudioDevice[] } {
  const [devices, setDevices] = useState<{ mic: AudioDevice[]; system: AudioDevice[]; webcam: AudioDevice[] }>({ mic: [], system: [], webcam: [] });
  useEffect(() => {
    let alive = true;
    const read = () => {
      void Promise.all([ipc.audioDevices().catch(() => ({ mic: [], system: [] })), ipc.webcamDevices().catch(() => [])]).then(([a, w]) => {
        if (alive) setDevices({ mic: a.mic, system: a.system, webcam: w });
      });
    };
    read();
    const id = window.setInterval(read, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return devices;
}

/** A device picker: "Default (name)" first, then the devices; a chosen device that is not there is still shown (and falls back when used). */
export function DeviceSelect(props: { label: string; value: string; devices: AudioDevice[]; onChange: (id: string) => void }) {
  const { t } = useT();
  const def = props.devices.find((d) => d.isDefault);
  const options = [
    { value: "", label: def ? t("settings.deviceDefault", { name: def.name }) : t("settings.deviceDefaultNone") },
    ...props.devices.map((d) => ({ value: d.id, label: d.name })),
  ];
  if (props.value && !props.devices.some((d) => d.id === props.value)) {
    options.push({ value: props.value, label: t("settings.deviceGone") });
  }
  return <Select label={props.label} value={props.value} onChange={props.onChange} options={options} />;
}

/** Settings → Recording: everything that belongs to recording the screen, in one place. */
export function RecordingPage({ settings, set }: PageProps) {
  const { t } = useT();
  const [keyDialog, setKeyDialog] = useState(false);
  const [folders, setFolders] = useState({ recordings: "", pictures: "" });
  const devices = useDevices();
  useEffect(() => {
    void ipc.defaultFolders().then(setFolders).catch(() => undefined);
  }, []);

  const fx = effectsFromSettings(settings);
  const row: FieldRow = ({ id, label, children }) => (
    <Setting key={id} id={id} title={label}>
      {children}
    </Setting>
  );
  const patch = (change: Partial<Settings>) => set(change);

  return (
    <>
      <HotkeyNotice />
      <Section>
        <Setting id="recordHotkey" title={t("settings.recordHotkey")} description={t("settings.recordHotkeyDesc")}>
          <Kbd keys={settings.recordHotkey} />
          <Button onClick={() => setKeyDialog(true)}>{t("settings.shortcutChange")}</Button>
        </Setting>
        <Setting id="projectsDir" title={t("settings.projectsDir")} description={t("settings.projectsDirDesc")}>
          <FolderSetting label={t("settings.projectsDir")} value={settings.projectsDir} fallback={folders.recordings} onChange={(projectsDir) => set({ projectsDir })} />
        </Setting>
        <Setting id="micDevice" title={t("settings.micDevice")} description={t("settings.micDeviceDesc")}>
          <DeviceSelect label={t("settings.micDevice")} value={settings.micDevice} devices={devices.mic} onChange={(micDevice) => patch({ micDevice })} />
        </Setting>
        <Setting id="systemDevice" title={t("settings.systemDevice")} description={t("settings.systemDeviceDesc")}>
          <DeviceSelect label={t("settings.systemDevice")} value={settings.systemDevice} devices={devices.system} onChange={(systemDevice) => patch({ systemDevice })} />
        </Setting>
        <Setting id="recFps" title={t("rec.fps")}>
          <Select
            label={t("rec.fps")}
            value={String(settings.recFps)}
            onChange={(v) => patch({ recFps: Number(v) as Settings["recFps"] })}
            options={[30, 60].map((n) => ({ value: String(n), label: t("rec.fpsValue", { count: n }) }))}
          />
        </Setting>
        <Setting id="recQuality" title={t("rec.quality")}>
          <Select
            label={t("rec.quality")}
            value={settings.recQuality}
            onChange={(recQuality) => patch({ recQuality })}
            options={[
              { value: "standard", label: t("rec.qStandard") },
              { value: "high", label: t("rec.qHigh") },
            ]}
          />
        </Setting>
        <Setting id="recCountdown" title={t("rec.countdown")}>
          <Select
            label={t("rec.countdown")}
            value={String(settings.recCountdown)}
            onChange={(v) => patch({ recCountdown: Number(v) as Settings["recCountdown"] })}
            options={[0, 3, 5, 10].map((d) => ({ value: String(d), label: d === 0 ? t("delay.none") : t("delay.seconds", { count: d }) }))}
          />
        </Setting>
        <Setting id="recSystemSound" title={t("rec.sysSound")}>
          <Switch label={t("rec.sysSound")} checked={settings.recSystemSound} onChange={(recSystemSound) => patch({ recSystemSound })} />
        </Setting>
        <Setting id="recMic" title={t("rec.mic")} description={t("rec.micDefault")}>
          <Switch label={t("rec.mic")} checked={settings.recMic} onChange={(recMic) => patch({ recMic })} />
        </Setting>
        <CursorControls
          row={row}
          value={fx.cursor}
          onChange={(c) => patch({ cursorShow: c.show, cursorSize: c.size, cursorHalo: c.halo, cursorHaloColor: c.haloColor })}
        />
        <ClickControls row={row} value={fx.click} onChange={(c) => patch({ clickEffect: c.kind, clickLeftColor: c.left, clickRightColor: c.right, clickSize: c.size })} />
        <Setting id="webcamOn" title={t("fx.webcam")} description={t("fx.webcamDesc")}>
          <Switch label={t("fx.webcam")} checked={settings.webcamOn} onChange={(webcamOn) => patch({ webcamOn })} />
        </Setting>
        <Setting id="webcamDevice" title={t("settings.webcamDevice")}>
          <DeviceSelect label={t("settings.webcamDevice")} value={settings.webcamDevice} devices={devices.webcam} onChange={(webcamDevice) => patch({ webcamDevice })} />
        </Setting>
        <WebcamControls
          row={row}
          value={fx.webcam}
          onChange={(w) => patch({ webcamShape: w.shape, webcamSize: w.size, webcamPosition: w.position === "free" ? "bottom-right" : w.position, webcamBorder: w.border, webcamBorderColor: w.borderColor })}
        />
      </Section>
      {keyDialog && (
        <ShortcutDialog
          current={settings.recordHotkey}
          fallback="Ctrl+Alt+R"
          other={settings.captureHotkey}
          onClose={() => setKeyDialog(false)}
          onSave={(recordHotkey) => {
            setKeyDialog(false);
            set({ recordHotkey });
          }}
        />
      )}
    </>
  );
}

