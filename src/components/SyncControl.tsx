import { useEffect, useState } from "react";
import { useT } from "../i18n";

const MIN = -500;
const MAX = 500;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n / 10) * 10));

/**
 * The lip sync of the webcam: the label on its own line with a hint, a full-width slider, a number field (type a value in
 * milliseconds), −10 / +10 buttons and a reset. Positive: the webcam is shown later. The player follows at once and keeps its place.
 */
export function SyncControl(props: { value: number; onChange: (ms: number) => void }) {
  const { t } = useT();
  const { value, onChange } = props;
  // What is typed is kept as text until it is committed (Enter or leaving the field).
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(/\s/g, ""));
    setDraft(null);
    if (Number.isFinite(n) && draft.trim() !== "") onChange(clamp(n));
  };
  return (
    <div className="syncctl" role="group" aria-labelledby="syncctl-label">
      <div className="syncctl__label" id="syncctl-label">
        {t("fx.webcamSync")}
      </div>
      <div className="syncctl__hint">{t("fx.webcamSyncHint")}</div>
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={10}
        dir="ltr"
        value={value}
        aria-labelledby="syncctl-label"
        aria-valuetext={`${value} ms`}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
      />
      <div className="syncctl__row">
        <button type="button" className="syncctl__btn" dir="ltr" disabled={value <= MIN} title={t("fx.webcamSyncEarlier")} aria-label={t("fx.webcamSyncEarlier")} onClick={() => onChange(clamp(value - 10))}>
          −10
        </button>
        <input
          type="text"
          inputMode="numeric"
          className="syncctl__num"
          dir="ltr"
          value={draft ?? String(value)}
          aria-label={`${t("fx.webcamSync")} (ms)`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setDraft(null);
          }}
        />
        <span className="syncctl__unit" dir="ltr">
          ms
        </span>
        <button type="button" className="syncctl__btn" dir="ltr" disabled={value >= MAX} title={t("fx.webcamSyncLater")} aria-label={t("fx.webcamSyncLater")} onClick={() => onChange(clamp(value + 10))}>
          +10
        </button>
        <button type="button" className="syncctl__btn syncctl__reset" disabled={value === 0} title={t("fx.webcamSyncReset")} aria-label={t("fx.webcamSyncReset")} onClick={() => onChange(0)}>
          ↺
        </button>
      </div>
    </div>
  );
}
