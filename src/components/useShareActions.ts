// Copy, save, share, print, edit in Paint, open file and open folder: what the buttons of the top bar, the bottom bar and the
// card menu do. The work itself is in src/share.
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc, type Capture, type CmdError, type Group, type Session } from "../ipc";
import type { CopyMode, Settings } from "../settings/defaults";
import { copyCaptures, editInPaint, saveCaptures, shareCaptures, type SaveOptions } from "../share/exporter";
import { printCaptures } from "../share/print";

const messageOf = (e: unknown) => (e as Partial<CmdError> | undefined)?.message ?? String(e);

export interface SavedInfo {
  folder: string;
  /** The first saved file (shown selected in Explorer). */
  first: string;
}

export interface ShareDeps {
  session: Session | null;
  group: Group | null;
  settings: Settings;
  patch: (change: Partial<Settings>) => void;
  notify: (text: string, saved?: SavedInfo) => void;
  fail: (text: string) => void;
  /** Import files the user picked with Ctrl+O into the active group. */
  importFiles: (files: File[], skipped: number, groupId: string) => Promise<void>;
}

export interface TooLarge {
  captures: Capture[];
  width: number;
  height: number;
}

/** The share actions and the state of their dialogs. */
export function useShareActions(d: ShareDeps) {
  const { t } = useT();
  const deps = useRef(d);
  deps.current = d;
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<Capture[] | null>(null);
  const [tooLarge, setTooLarge] = useState<TooLarge | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    void ipc.shareSupported().then(setCanShare).catch(() => setCanShare(false));
  }, []);

  /** Run a job; one at a time, and every failure becomes a message. */
  const job = useCallback(async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      deps.current.fail(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const copy = useCallback(
    (captures: Capture[], mode: CopyMode) =>
      job(async () => {
        const { session } = deps.current;
        if (!session || captures.length === 0) return;
        const r = await copyCaptures(session, captures, mode);
        if (r.status === "tooLarge") setTooLarge({ captures, width: r.width, height: r.height });
        else if (r.limited) deps.current.notify(t("copy.tallLimited"));
        else deps.current.notify(t("copy.done", { count: captures.length }));
      }),
    [job, t],
  );

  const save = useCallback((captures: Capture[]) => captures.length > 0 && setSaving(captures), []);

  const doSave = useCallback(
    (captures: Capture[], o: Omit<SaveOptions, "dateTimePrefix">) =>
      job(async () => {
        const { session, group, patch } = deps.current;
        if (!session || !group) return;
        const folder = o.folder;
        setSaving(null);
        const paths = await saveCaptures(session, group, captures, { ...o, dateTimePrefix: t("save.prefix") });
        patch({ saveFormat: o.format, saveNaming: o.naming, saveQuality: o.quality, lastSaveFolder: folder });
        deps.current.notify(t("save.done", { count: paths.length }), { folder, first: paths[0] ?? folder });
      }),
    [job, t],
  );

  const paint = useCallback(
    (c: Capture) =>
      job(async () => {
        if (deps.current.session) await editInPaint(deps.current.session, c);
      }),
    [job],
  );

  const share = useCallback(
    (captures: Capture[]) =>
      job(async () => {
        if (deps.current.session && captures.length > 0) await shareCaptures(deps.current.session, captures);
      }),
    [job],
  );

  const print = useCallback(
    (captures: Capture[]) =>
      job(async () => {
        if (deps.current.session && captures.length > 0) await printCaptures(deps.current.session, captures);
      }),
    [job],
  );

  const openFile = useCallback(
    () =>
      job(async () => {
        const { group, importFiles } = deps.current;
        if (!group) return;
        const paths = await ipc.pickImages();
        if (paths.length === 0) return;
        const files: File[] = [];
        let skipped = 0;
        for (const p of paths) {
          try {
            files.push(await ipc.readPickedFile(p));
          } catch {
            skipped++;
          }
        }
        await importFiles(files, skipped, group.id);
      }),
    [job],
  );

  const openFolder = useCallback(
    () =>
      job(async () => {
        const folder = deps.current.settings.exportFolder || (await ipc.sessionImagesFolder());
        await ipc.openFolder(folder);
      }),
    [job],
  );

  return { busy, canShare, saving, setSaving, tooLarge, setTooLarge, copy, save, doSave, paint, share, print, openFile, openFolder };
}
