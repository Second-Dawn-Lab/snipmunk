import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";
import { formatTime } from "../recording/timeline";

/**
 * The floating recording bar (its own small transparent window, left out of the recording): first the countdown with large
 * digits (the ✕ or Esc cancels), then the red dot with the timer, Discard (with a confirmation on the same line) and Stop.
 * The window is as big as the capsule: the page tells the backend its size whenever it changes. The bar drags the window.
 */
export function RecBar() {
  const { t } = useT();
  // The recorded time as of `at` (pauses not counted); it runs on from there unless the recording is paused.
  const [clock, setClock] = useState({ recording: false, elapsed: 0, at: 0, paused: false });
  const [now, setNow] = useState(Date.now());
  const start = clock.recording ? 1 : 0;
  const [count, setCount] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const capsule = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const take = (s: { recording: boolean; elapsedMs: number; paused: boolean }) =>
      setClock({ recording: s.recording, elapsed: s.elapsedMs, at: Date.now(), paused: s.paused });
    void ipc.recordingState().then(take).catch(() => undefined);
    const state = ipc.onRecordingState((s) => {
      take(s);
      if (s.recording) setCount(null);
    });
    const counting = ipc.onRecCountdown((n) => setCount(n > 0 ? n : null));
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(timer);
      void state.then((fn) => fn());
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

  return (
    <div className="floatbar" ref={capsule} data-tauri-drag-region role="toolbar" aria-label={t("rec.recording")}>
      {count !== null && start === 0 ? (
        <>
          <span className="floatbar__count" dir="ltr" role="timer" aria-live="assertive" data-tauri-drag-region>
            {count}
          </span>
          <button type="button" className="floatbar__btn" title={t("session.cancel")} aria-label={t("session.cancel")} onClick={() => void ipc.cancelCountdown()}>
            ✕
          </button>
        </>
      ) : (
        <>
          <span className={clock.paused ? "recdot" : "recdot recdot--live"} aria-hidden="true" data-tauri-drag-region />
          <span className="floatbar__time" dir="ltr" data-tauri-drag-region>
            {formatTime(clock.recording ? (clock.elapsed + (clock.paused ? 0 : Math.max(0, now - clock.at))) / 1000 : 0)}
          </span>
          {asking ? (
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
              <button
                type="button"
                className="floatbar__btn"
                disabled={busy}
                title={clock.paused ? t("rec.resume") : t("rec.pause")}
                aria-label={clock.paused ? t("rec.resume") : t("rec.pause")}
                aria-pressed={clock.paused}
                onClick={pause}
              >
                {clock.paused ? "▶" : "⏸"}
              </button>
              <button type="button" className="floatbar__btn" disabled={busy} title={t("rec.discard")} aria-label={t("rec.discard")} onClick={() => setAsking(true)}>
                🗑
              </button>
              <button type="button" className="floatbar__btn floatbar__btn--danger" disabled={busy} onClick={stop}>
                {t("rec.stop")}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
