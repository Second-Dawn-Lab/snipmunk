import { Button, Dialog } from "@seconddawn/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import { ipc } from "../../ipc";
import { notify } from "../../notify";
import type { GuideDoc } from "../model";
import { applyTemplate, templateOf } from "./apply";
import { normalizeTemplate, type Template } from "./model";

type Change = (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;

const fail = (e: unknown) => notify(String((e as { message?: string })?.message ?? e), true);

export interface Templates {
  /** One's own templates. */
  own: Template[];
  refresh: () => void;
  /** The own template the guide uses, which "Update my template" overwrites; `null` for a built-in one. */
  mine: Template | null;
  use: (t: Template, own: boolean) => void;
  saveAsNew: () => void;
  rename: (t: Template, copy: boolean) => void;
  update: () => void;
  remove: (t: Template) => void;
  /** Choose own templates and write them as files. */
  exportSome: () => void;
  exportOne: (t: Template) => void;
  importSome: () => void;
  /** A question about a name, about which templates to export or about deleting one is open. */
  busy: boolean;
  dialogs: ReactNode;
}

/**
 * Everything that is done with templates, for the menu of the "Template" button and for the template panel: use, save as a new
 * one, update one's own, rename, duplicate, delete, export (one file each) and import (several files at once).
 */
export function useTemplates(doc: GuideDoc, change: Change, onRemoved?: (id: string) => void): Templates {
  const { t } = useT();
  const [own, setOwn] = useState<Template[]>([]);
  const [naming, setNaming] = useState<{ id: string | null; copy: boolean; name: string } | null>(null);
  // The own template that is about to be deleted (asked first).
  const [doomed, setDoomed] = useState<Template | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const current = templateOf(doc);
  const refresh = useCallback(() => void ipc.templatesList().then((l) => setOwn(l.map(normalizeTemplate))).catch(() => undefined), []);
  useEffect(refresh, [refresh]);
  // A template added elsewhere (a file opened from Explorer) appears at once.
  useEffect(() => {
    const listening = ipc.onTemplatesChanged(refresh);
    return () => void listening.then((stop) => stop());
  }, [refresh]);
  const mine = own.find((x) => x.id === current.id) ?? null;

  const use = (tpl: Template, isOwn: boolean) => {
    const done = (x: Template) => change((d) => applyTemplate(d, x));
    if (isOwn) void ipc.templatesUse(tpl.id).then((x) => done(normalizeTemplate(x))).catch(fail);
    else done(tpl);
  };
  const finishName = () => {
    const n = naming;
    if (!n || !n.name.trim()) return;
    setNaming(null);
    if (n.id) void ipc.templatesRename(n.id, n.name.trim(), n.copy).then(refresh).catch(fail);
    else
      void ipc
        .templatesSave({ ...current, id: "", name: n.name.trim() })
        .then((saved) => {
          change((d) => applyTemplate(d, normalizeTemplate(saved)));
          refresh();
        })
        .catch(fail);
  };
  const update = () => {
    if (!mine) return;
    void ipc
      .templatesSave({ ...current, id: mine.id, name: mine.name })
      .then(() => {
        notify(t("template.updated", { name: mine.name }));
        refresh();
      })
      .catch(fail);
  };
  const finishDelete = () => {
    const tpl = doomed;
    if (!tpl) return;
    setDoomed(null);
    void ipc
      .templatesDelete(tpl.id)
      .then(() => {
        onRemoved?.(tpl.id);
        refresh();
      })
      .catch(fail);
  };
  const exportOne = (tpl: Template) =>
    void ipc
      .pickExportSave(null, tpl.name, "snpt")
      .then((p) => (p ? ipc.templatesExport(tpl.id, p).then(() => notify(t("template.exported", { count: 1 }))) : undefined))
      .catch(fail);
  const finishExport = () => {
    const ids = own.filter((x) => chosen?.has(x.id)).map((x) => x.id);
    setChosen(null);
    if (ids.length === 0) return;
    if (ids.length === 1) return exportOne(own.find((x) => x.id === ids[0])!);
    void ipc
      .pickFolder()
      .then((folder) => (folder ? ipc.templatesExportMany(ids, folder).then((count) => notify(t("template.exported", { count }))) : undefined))
      .catch(fail);
  };
  const importSome = () =>
    void ipc
      .pickTemplatesOpen()
      .then(async (paths) => {
        let count = 0;
        for (const p of paths) {
          // A file that is not a template does not stop the others.
          await ipc.templatesImport(p).then(() => count++, fail);
        }
        if (count > 0) notify(t("template.imported", { count }));
        refresh();
      })
      .catch(fail);

  const dialogs = (
    <>
      <Dialog
        open={doomed !== null}
        title={t("template.deleteTitle")}
        onClose={() => setDoomed(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomed(null)}>
              {t("session.cancel")}
            </Button>
            <Button variant="danger" onClick={finishDelete}>
              {t("template.delete")}
            </Button>
          </>
        }
      >
        <p>{t("template.deleteAsk", { name: doomed?.name ?? "" })}</p>
      </Dialog>
      <Dialog
        open={naming !== null}
        title={naming?.id ? t(naming.copy ? "guide.duplicate" : "proj.rename") : t("template.saveOwn")}
        onClose={() => setNaming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              {t("session.cancel")}
            </Button>
            <Button variant="primary" disabled={!naming?.name.trim()} onClick={finishName}>
              {t("guide.save")}
            </Button>
          </>
        }
      >
        <form
          className="tplname"
          onSubmit={(e) => {
            e.preventDefault();
            finishName();
          }}
        >
          <label>
            {t("template.name")}
            <input autoFocus type="text" maxLength={80} value={naming?.name ?? ""} onChange={(e) => naming && setNaming({ ...naming, name: e.target.value })} />
          </label>
        </form>
      </Dialog>
      <Dialog
        open={chosen !== null}
        title={t("template.exportTitle")}
        onClose={() => setChosen(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setChosen(null)}>
              {t("session.cancel")}
            </Button>
            <Button variant="primary" disabled={!chosen?.size} onClick={finishExport}>
              {t("template.export")}
            </Button>
          </>
        }
      >
        <div className="tplexport">
          <p>{t("template.exportNote")}</p>
          {own.map((x) => (
            <label key={x.id} className="redact__item">
              <input
                type="checkbox"
                checked={chosen?.has(x.id) ?? false}
                onChange={() =>
                  setChosen((set) => {
                    const next = new Set(set);
                    if (!next.delete(x.id)) next.add(x.id);
                    return next;
                  })
                }
              />
              <span>
                <bdi>{x.name}</bdi>
              </span>
            </label>
          ))}
        </div>
      </Dialog>
    </>
  );

  return {
    own,
    refresh,
    mine,
    use,
    saveAsNew: () => setNaming({ id: null, copy: false, name: t("template.nameDefault") }),
    rename: (tpl, copy) => setNaming({ id: tpl.id, copy, name: copy ? `${tpl.name} 2` : tpl.name }),
    update,
    remove: setDoomed,
    exportSome: () => setChosen(new Set(mine ? [mine.id] : own.map((x) => x.id))),
    exportOne,
    importSome,
    busy: naming !== null || chosen !== null || doomed !== null,
    dialogs,
  };
}
