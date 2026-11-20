import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";
import { formatTime } from "../recording/timeline";
import { AppIcon } from "./AppIcons";

/**
 * The floating recording bar (its own small transparent window, left out of the recording). ONE layout for the countdown and the
 * recording, so nothing jumps when the recording starts: the digits are in the place of the timer, every button is there but
 * disabled (the last one is the cancel button), and when the countdown is over the same elements are enabled and the red dot
 * starts. The window is as big as the capsule: the page tells the backend its size when it changes. The bar drags the window.
 */
export function RecBar() {
  const { t } = useT();
  // The recorded time as of `at` (pauses not counted); it runs on from there unless the recording is paused.
  const [clock, setClock] = useState({ recording: false, elapsed: 0, at: 0, paused: false });
  const [now, setNow] = useState(Date.now());
  const [count, setCount] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const [mic, setMic] = useState(false);
  const capsule = useRef<HTMLDivElement>(null);
  const live = clock.recording;

  useEffect(() => {
    const take = (s: { recording: boolean; elapsedMs: number; paused: boolean }) =>
      setClock({ recording: s.recording, elapsed: s.elapsedMs, at: Date.now(), paused: s.paused });
    void ipc.recordingState().then(take).catch(() => undefined);
    void ipc
      .getSettings()
      .then((s) => {
        setSound(s.recSystemSound);
        setMic(s.recMic);
      })
      .catch(() => undefined);
    const state = ipc.onRecordingState((s) => {
      take(s);
      if (s.recording) setCount(null);
    });
    const settings = ipc.onSettingsChanged((s) => {
      setSound(s.recSystemSound);
      setMic(s.recMic);
    });
    const counting = ipc.onRecCountdown((n) => setCount(n > 0 ? n : null));
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(timer);
      void state.then((fn) => fn());
      void settings.then((fn) => fn());
      void counting.then((fn) => fn());
    };
  }, []);

  // The window is as big as the capsule (the window is transparent around it).
  useLayoutEffect(() => {
    const el = capsule.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      void ipc.recbarFit(Math.ceil(r.width) + 4, Math.ceil(r.height) + 4).catch(() => undefined);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const stop = () => {
    setBusy(true);
    void ipc.stopRecording().catch(() => undefined);
  };
  const pause = () => void ipc.pauseRecording(!clock.paused).catch(() => undefined);
  const discard = () => {
    setBusy(true);
    void ipc.discardRecording().catch(() => undefined);
  };
  const toggle = (key: "recSystemSound" | "recMic", value: boolean) => {
    if (key === "recSystemSound") setSound(value);
    else setMic(value);
    void ipc.setSettings({ [key]: value }).catch(() => undefined);
  };

  const shown = live ? (clock.elapsed + (clock.paused ? 0 : Math.max(0, now - clock.at))) / 1000 : 0;
  const off = !live || busy;
  const iconBtn = (label: string, icon: Parameters<typeof AppIcon>[0]["name"], onClick: () => void, pressed?: boolean) => (
    <button type="button" className="floatbar__btn floatbar__btn--icon" disabled={off} title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <AppIcon name={icon} size={18} />
    </button>
  );

  return (
    <div className="floatbar" ref={capsule} data-tauri-drag-region role="toolbar" aria-label={t("rec.recording")}>
      <span className={live && !clock.paused ? "recdot recdot--live" : "recdot recdot--idle"} aria-hidden="true" data-tauri-drag-region />
      {live ? (
        <span className="floatbar__time" dir="ltr" role="timer" data-tauri-drag-region>
          {formatTime(shown)}
        </span>
      ) : (
        <span className="floatbar__time floatbar__time--count" dir="ltr" role="timer" aria-live="assertive" data-tauri-drag-region>
          {count ?? ""}
        </span>
      )}
      {asking && live ? (
        <>
          <span className="floatbar__ask" data-tauri-drag-region>
            {t("rec.discardAsk")}
          </span>
          <button type="button" className="floatbar__btn floatbar__btn--danger" disabled={busy} onClick={discard}>
            {t("rec.discardYes")}
          </button>
          <button type="button" className="floatbar__btn" disabled={busy} onClick={() => setAsking(false)}>
            {t("rec.keep")}
          </button>
        </>
      ) : (
        <>
          {iconBtn(clock.paused ? t("rec.resume") : t("rec.pause"), clock.paused ? "play" : "pause", pause, clock.paused)}
          {iconBtn(t("rec.discard"), "trash", () => setAsking(true))}
          {iconBtn(t("rec.soundToggle"), sound ? "speaker" : "speakerOff", () => toggle("recSystemSound", !sound), sound)}
          {iconBtn(t("rec.micToggle"), mic ? "mic" : "micOff", () => toggle("recMic", !mic), mic)}
          {live ? (
            <button type="button" className="floatbar__btn floatbar__btn--danger floatbar__btn--stop" disabled={busy} onClick={stop}>
              {t("rec.stop")}
            </button>
          ) : (
            <button type="button" className="floatbar__btn floatbar__btn--stop" disabled={count === null} onClick={() => void ipc.cancelCountdown()}>
              {t("session.cancel")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
