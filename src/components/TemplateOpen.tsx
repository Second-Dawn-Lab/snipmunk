import { Button, Dialog } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ipc } from "../ipc";
import { notify } from "../notify";

/** The file name of a path, for a message about it. */
export const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);

/**
 * Template files opened from outside (a double-click on a `.snpt` file): each is asked about before it is added to the own
 * templates, one after the other. A file that is not a template only gets a message.
 */
export function TemplateOpen() {
  const { t } = useT();
  const [waiting, setWaiting] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ path: string; name: string } | null>(null);
  useEffect(() => {
    const take = () => void ipc.takePendingTemplates().then((more) => more.length && setWaiting((w) => [...w, ...more])).catch(() => undefined);
    const listening = ipc.onOpenTemplate(take);
    void listening.then(take);
    return () => void listening.then((stop) => stop());
  }, []);
  const next = waiting[0];
  useEffect(() => {
    if (!next || asking) return;
    let alive = true;
    void ipc.templatesPeek(next).then(
      (name) => alive && setAsking({ path: next, name }),
      () => {
        if (!alive) return;
        notify(t("template.openBad", { file: fileName(next) }), true);
        setWaiting((w) => w.slice(1));
      },
    );
    return () => {
      alive = false;
    };
  }, [next, asking]);
  const done = () => {
    setAsking(null);
    setWaiting((w) => w.slice(1));
  };
  const add = () => {
    const chosen = asking;
    done();
    if (!chosen) return;
    void ipc.templatesImport(chosen.path).then(
      () => notify(t("template.imported", { count: 1 })),
      (e: unknown) => notify(String((e as { message?: string })?.message ?? e), true),
    );
  };
  return (
    <Dialog
      open={asking !== null}
      title={t("template.openTitle")}
      onClose={done}
      footer={
        <>
          <Button variant="ghost" onClick={done}>
            {t("session.cancel")}
          </Button>
          <Button variant="primary" onClick={add}>
            {t("template.openImport")}
          </Button>
        </>
      }
    >
      <p>
        <bdi>{t("template.openAsk", { name: asking?.name ?? "" })}</bdi>
      </p>
    </Dialog>
  );
}
