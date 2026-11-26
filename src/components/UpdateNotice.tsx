import { Button, Icon } from "@seconddawn/ui";
import { useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";
import { dismissKey, showsNotice, updateMessage, useUpdate } from "../update";

/** A small notice in a corner of the main window: a newer version, its download, or that the download failed. It takes no
    focus and covers nothing that is being worked on. */
export function UpdateNotice() {
  const { t } = useT();
  const view = useUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const message = updateMessage(view.phase);
  if (!message || !showsNotice(view, dismissed)) return null;
  const { phase } = view;
  return (
    <aside className="updatenotice" role="status" aria-live="polite">
      <div className="updatenotice__head">
        <Icon name="download" size={18} />
        <strong>{t(message.key, message.vars)}</strong>
      </div>
      {phase.kind === "downloading" && <progress max={100} value={phase.percent ?? undefined} />}
      {phase.kind !== "downloading" && (
        <div className="updatenotice__actions">
          {phase.kind !== "failed" && (
            <Button variant="primary" onClick={() => void ipc.updateInstall()}>
              {t("update.install")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setDismissed(dismissKey(phase))}>
            {t("update.later")}
          </Button>
        </div>
      )}
    </aside>
  );
}
