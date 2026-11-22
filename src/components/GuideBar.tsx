import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";
import { AppIcon } from "./AppIcons";

/**
 * The floating bar while a guide is recorded (its own small window: left out of the pictures, never takes the focus): the number of
 * steps, Take step, Pause/Resume, Stop and Cancel (which asks first). Clicks on Snipmunk's own windows never become steps. A hint
 * appears once when the app in front runs as administrator (its input cannot be seen).
 */
export function GuideBar() {
  const { t } = useT();
  const [state, setState] = useState({ recording: false, paused: false, steps: 0 });
  const [count, setCount] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const capsule = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ipc.guideState().then(setState).catch(() => undefined);
    const a = ipc.onGuideState((s) => (setState(s), setCount(null)));
    const b = ipc.onGuideCountdown((n) => setCount(n > 0 ? n : null));
    const c = ipc.onGuideHint((h) => h === "elevated" && setHint(true));
    return () => {
      for (const p of [a, b, c]) void p.then((fn) => fn());
    };
  }, []);

  // The window is as big as the bar.
  useLayoutEffect(() => {
    const el = capsule.current;
    if (!el) return;
    void ipc.guideBarFit(Math.ceil(el.offsetWidth + 8), Math.ceil(el.offsetHeight + 8)).catch(() => undefined);
  }, [asking, hint, count, state.paused]);

  const stop = () => {
    setBusy(true);
    void ipc.guideStop().finally(() => setBusy(false));
  };

  return (
    <div className="guidebar" ref={capsule} role="toolbar" aria-label={t("docs.title")}>
      {asking ? (
        <div className="guidebar__ask">
          <div>
            <strong>{t("docbar.cancelTitle")}</strong>
            <span>{t("docbar.cancelBody")}</span>
          </div>
          <button type="button" className="guidebar__btn" onClick={() => setAsking(false)}>
            {t("docbar.keep")}
          </button>
          <button type="button" className="guidebar__btn guidebar__btn--danger" onClick={() => void ipc.guideCancel()}>
            {t("docbar.cancel")}
          </button>
        </div>
      ) : (
        <>
          <div className="guidebar__row">
            <span className={`guidebar__dot${state.paused || count !== null ? "" : " guidebar__dot--live"}`} aria-hidden="true" />
            <span className="guidebar__steps" aria-live="polite">
              {count !== null ? t("docbar.countdown", { count }) : state.paused ? `${t("docbar.steps", { count: state.steps })} · ${t("docbar.pause")}` : t("docbar.steps", { count: state.steps })}
            </span>
            <button type="button" className="guidebar__icon" disabled={count !== null || state.paused} title={t("docbar.take")} aria-label={t("docbar.take")} onClick={() => void ipc.guideTakeStep()}>
              <AppIcon name="camera" size={16} />
            </button>
            <button
              type="button"
              className="guidebar__icon"
              disabled={count !== null}
              title={state.paused ? t("docbar.resume") : t("docbar.pause")}
              aria-label={state.paused ? t("docbar.resume") : t("docbar.pause")}
              onClick={() => void (state.paused ? ipc.guideResume() : ipc.guidePause())}
            >
              <AppIcon name={state.paused ? "play" : "pause"} size={16} />
            </button>
            <button type="button" className="guidebar__btn guidebar__btn--stop" disabled={busy || count !== null} onClick={stop}>
              {t("docbar.stop")}
            </button>
            <button type="button" className="guidebar__icon" title={t("docbar.cancel")} aria-label={t("docbar.cancel")} onClick={() => setAsking(true)}>
              <AppIcon name="close" size={15} />
            </button>
          </div>
          {hint && <div className="guidebar__hint">{t("docbar.elevated")}</div>}
        </>
      )}
    </div>
  );
}
