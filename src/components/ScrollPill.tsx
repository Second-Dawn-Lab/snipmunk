import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";

type State = "ok" | "slow" | "max";

/**
 * The pill of a scrolling screenshot (its own small window, left out of the pictures, never takes the focus): "Scroll now · height",
 * a thumbnail of the canvas, Done and Cancel. It turns orange with "Scroll slower" when the scroll is too fast to follow, and says so
 * when the maximum height is reached. Enter finishes and Esc cancels too (the backend watches the keys).
 */
export function ScrollPill() {
  const { t } = useT();
  const [height, setHeight] = useState(0);
  const [n, setN] = useState(0);
  const [state, setState] = useState<State>("ok");

  useEffect(() => {
    const progress = ipc.onScrollProgress((p) => {
      setHeight(p.height);
      setN(p.n);
      setState(p.state as State);
    });
    return () => void progress.then((fn) => fn());
  }, []);

  return (
    <div className={`scrollpill scrollpill--${state}`} role="status" aria-live="polite">
      <div className="scrollpill__thumb">{n > 0 && <img src={`${convertFileSrc("scroll", "snipmunk-cam")}?n=${n}`} alt="" />}</div>
      <div className="scrollpill__text">
        <strong>
          {t("scroll.title")} · <span dir="ltr">{t("scroll.px", { height })}</span>
        </strong>
        {state === "slow" && <span className="scrollpill__note">{t("scroll.slow")}</span>}
        {state === "max" && <span className="scrollpill__note">{t("scroll.maxReached")}</span>}
        <span className="scrollpill__buttons">
          <button type="button" className="scrollpill__done" title="Enter" onClick={() => void ipc.scrollDone()}>
            {t("scroll.done")}
          </button>
          <button type="button" className="scrollpill__cancel" title="Esc" onClick={() => void ipc.scrollCancel()}>
            {t("scroll.cancel")}
          </button>
        </span>
      </div>
    </div>
  );
}
