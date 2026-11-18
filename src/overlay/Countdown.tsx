import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";

/** The delay countdown (3, 2, 1) next to the pointer. */
export function Countdown() {
  const { t } = useT();
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    const unlisten = ipc.onCountdown(setN);
    return () => void unlisten.then((fn) => fn());
  }, []);

  return (
    <div className="countdown" role="timer" aria-label={t("countdown.label")} title={t("countdown.cancel")}>
      <span dir="ltr">{n ?? ""}</span>
    </div>
  );
}
