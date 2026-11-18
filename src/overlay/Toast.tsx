import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc, toastImageUrl, type ToastInfo } from "../ipc";

/** The small notification in the corner after a capture while Snipmunk stays in the background. */
export function Toast() {
  const { t } = useT();
  const [info, setInfo] = useState<ToastInfo | null>(null);

  useEffect(() => {
    const unlisten = ipc.onToast(setInfo);
    return () => void unlisten.then((fn) => fn());
  }, []);

  if (!info) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <img className="toast__thumb" src={toastImageUrl(info)} alt="" draggable={false} />
      <div className="toast__text">
        <div className="toast__title">{t("toast.added", { group: info.groupName })}</div>
        {info.copied && <div className="toast__sub">{t("toast.copied")}</div>}
      </div>
      <button type="button" className="toast__open" onClick={() => void ipc.toastOpen()}>
        {t("toast.open")}
      </button>
    </div>
  );
}
