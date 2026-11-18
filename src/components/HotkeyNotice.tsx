import { Button, Icon } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc, type HotkeyStatus } from "../ipc";

/** The state of the capture shortcut, kept up to date. Null while it works. */
export function useHotkeyStatus(): HotkeyStatus | null {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void ipc.getHotkeyStatus().then((s) => alive && setStatus(s));
    const unlisten = ipc.onHotkeyStatus(setStatus);
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);
  return status && status.state !== "ok" ? status : null;
}

/** A notice that the capture shortcut does not work (it cannot be used, or the keyboard hook could not be installed). */
export function HotkeyNotice(props: { onOpenSettings?: () => void }) {
  const { t } = useT();
  const status = useHotkeyStatus();
  if (!status) return null;
  return (
    <div className="notice" role="alert">
      <Icon name="alert" size={16} />
      <span>
        {status.state === "hook" ? t("hotkey.hookFailed") : t("hotkey.invalid", { shortcut: status.shortcut })}
        {status.message && <small> {status.message}</small>}
      </span>
      {props.onOpenSettings && (
        <Button variant="ghost" onClick={props.onOpenSettings}>
          {t("hotkey.openSettings")}
        </Button>
      )}
    </div>
  );
}
