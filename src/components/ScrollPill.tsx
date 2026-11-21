import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";

type Reason = "end" | "max" | "stopped" | "noScroll";

/**
 * The pill of a scrolling screenshot (its own small window, left out of the pictures): the height so far, a thumbnail of the newest
 * part, and Stop. Esc stops too. When the capture is over it says why for a moment.
 */
export function ScrollPill() {
  const { t } = useT();
  const [height, setHeight] = useState(0);
  const [n, setN] = useState(0);
  const [reason, setReason] = useState<Reason | null>(null);

  useEffect(() => {
    const progress = ipc.onScrollProgress((p) => {
      setHeight(p.height);
      setN(p.n);
    });
    const done = ipc.onScrollDone((r) => setReason(r as Reason));
    return () => {
      void progress.then((fn) => fn());
      void done.then((fn) => fn());
    };
  }, []);

  const text = reason ? t(`scroll.${reason}`) : t("scroll.title");
  return (
    <div className="scrollpill" role="status" aria-live="polite">
      <div className="scrollpill__thumb">{n > 0 && <img src={`${convertFileSrc("scroll", "snipmunk-cam")}?n=${n}`} alt="" />}</div>
      <div className="scrollpill__text">
        <strong>{text}</strong>
        <span dir="ltr" className="scrollpill__height">{t("scroll.px", { height })}</span>
      </div>
      <button type="button" className="scrollpill__stop" disabled={reason !== null} title={t("scroll.hint")} onClick={() => void ipc.scrollStop()}>
        {t("scroll.stop")}
      </button>
    </div>
  );
}
