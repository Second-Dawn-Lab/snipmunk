import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Icon } from "@seconddawn/ui";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: "notice" | "error";
  text: string;
  action?: ToastAction;
}

/** How long a notice stays (errors stay until they are closed). */
export const TOAST_MS = 4000;
const MAX_TOASTS = 5;

/** The toasts of a window: `push` adds one (a notice goes by itself after about 4 seconds, an error stays), `close` removes one. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, number>());

  const close = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((all) => [...all.filter((x) => !(x.kind === t.kind && x.text === t.text)), { ...t, id }].slice(-MAX_TOASTS));
      if (t.kind === "notice") timers.current.set(id, window.setTimeout(() => close(id), TOAST_MS));
    },
    [close],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((h) => window.clearTimeout(h));
  }, []);

  return { toasts, push, close };
}

/**
 * Floating notices in the bottom corner (bottom left in a right-to-left layout). They lie over the content, so nothing moves, and
 * never take the focus. Notices are announced politely, errors at once.
 */
export function Toasts(props: { toasts: Toast[]; onClose: (id: number) => void }) {
  const { t } = useT();
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <Icon name={toast.kind === "error" ? "alert" : "check"} size={16} />
          <span className="toast__text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
             
              onClick={() => {
                toast.action?.run();
                props.onClose(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast__close" aria-label={t("session.dismiss")} title={t("session.dismiss")} onClick={() => props.onClose(toast.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
