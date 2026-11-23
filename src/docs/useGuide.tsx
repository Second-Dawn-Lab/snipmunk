import { Button, Dialog } from "@seconddawn/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { bumpGuideGeneration } from "./urls";
import { ipc, type GuideStep, type DocRecent } from "../ipc";
import { notify } from "../notify";
import type { Settings } from "../settings/defaults";
import { History, createDocument, syncSteps, type Block, type GuideDoc, type MarkerStyle } from "./model";

const LAST_FOLDER = "snipmunk.guides.folder";

/** The defaults for a new guide, from the settings of Documents mode. */
export function defaultsOf(s: Settings): Pick<GuideDoc, "marker" | "badge" | "picture" | "keepFull" | "zoomDefault"> {
  const marker: MarkerStyle = { left: s.docMarkerColor, right: s.docMarkerRight, shape: s.docMarkerShape, size: s.docMarkerSize };
  return { marker, badge: s.docBadgeStyle, picture: s.docStepPicture, keepFull: s.docKeepFull, zoomDefault: s.docZoomDefault };
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

type Then = (() => void) | null;

/**
 * The open guide of Documents mode: ONE guide at a time, a working copy in temp that is saved to a `.snpd` file on request. Holds the
 * document, its steps, the document-level undo history, the save/open/close flows with their questions, and recording more steps.
 */
export function useGuide(settings: Settings) {
  const { t } = useT();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [doc, setDoc] = useState<GuideDoc | null>(null);
  const [steps, setSteps] = useState<Map<number, GuideStep>>(new Map());
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<DocRecent[]>([]);
  const [tick, setTick] = useState(0);
  const [lost, setLost] = useState<{ title: string; steps: number } | null>(null);
  const history = useRef(new History());
  const docRef = useRef<GuideDoc | null>(null);
  docRef.current = doc;
  const pendingWrite = useRef(0);
  const [ask, setAsk] = useState<{ then: () => void } | null>(null);
  /** After which block new steps are inserted when a recording into the open guide ends. */
  const insertAfter = useRef<string | undefined>(undefined);
  const recording = useRef(false);

  const bump = () => setTick((n) => n + 1);

  const folder = useCallback((): string => {
    let last = "";
    try {
      last = localStorage.getItem(LAST_FOLDER) ?? "";
    } catch {
      /* no storage */
    }
    return last || settingsRef.current.docGuidesDir || defaultFolder.current;
  }, []);
  const defaultFolder = useRef("");
  useEffect(() => {
    void ipc.defaultFolders().then((f) => (defaultFolder.current = f.guides)).catch(() => undefined);
  }, []);
  const remember = (path: string) => {
    try {
      localStorage.setItem(LAST_FOLDER, dirOf(path));
    } catch {
      /* no storage */
    }
  };

  const refreshRecent = useCallback(() => void ipc.docRecent().then(setRecent).catch(() => undefined), []);
  useEffect(refreshRecent, [refreshRecent, doc === null]);

  /** Take the working copy from the backend (also after a recording ended). */
  const load = useCallback(
    async (opts: { insertAfter?: string } = {}) => {
      const all = await ipc.docRead();
      bumpGuideGeneration();
      if (!all.info) {
        setDoc(null);
        return;
      }
      const map = new Map<number, GuideStep>();
      for (const s of all.steps) map.set(s.n, s);
      let d = all.document as GuideDoc | null;
      if (!d || !Array.isArray(d.blocks)) {
        d = createDocument(all.info.title, all.info.created, all.steps, defaultsOf(settingsRef.current));
      } else {
        d = syncSteps(d, all.steps, opts.insertAfter);
      }
      setSteps(map);
      setSavedPath(all.savedPath);
      setDirty(all.dirty || all.info.state === "recording" || d !== all.document);
      setDoc(d);
      if (d !== all.document) void ipc.docWrite(d).catch(() => undefined);
      history.current.clear();
      bump();
    },
    [],
  );

  // At the start: a working copy that is still there is a guide that was open when the program died.
  useEffect(() => {
    void ipc
      .docState()
      .then((s) => {
        if (!s.open) return;
        // A guide that was never saved, was being recorded or has unsaved edits: offer to recover it. A saved, clean one just opens again.
        if (s.state === "recording" || s.dirty || !s.savedPath) setLost({ title: s.title ?? "", steps: s.steps ?? 0 });
        else void load();
      })
      .catch(() => undefined);
  }, []);

  // A recording (new guide or more steps) ended: the guide is shown (or grows).
  useEffect(() => {
    const p = ipc.onGuideFinished((id) => {
      if (!id) {
        // Cancelled: a guide that was open stays as it was.
        if (recording.current) void load();
        recording.current = false;
        return;
      }
      const after = insertAfter.current;
      insertAfter.current = undefined;
      recording.current = false;
      void load({ insertAfter: after });
    });
    return () => void p.then((fn) => fn());
  }, [load]);

  // --- changes and the history ---------------------------------------------------------------------------------------------------

  const persist = useCallback((d: GuideDoc) => {
    window.clearTimeout(pendingWrite.current);
    pendingWrite.current = window.setTimeout(() => void ipc.docWrite(d).catch((e) => setError(String(e?.message ?? e))), 350);
  }, []);

  /** Change the document: the old one goes to the history (`key` merges the changes of one typing run). */
  const change = useCallback(
    (fn: (d: GuideDoc) => GuideDoc, key = "") => {
      const cur = docRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      history.current.push(cur, key);
      docRef.current = next;
      setDoc(next);
      setDirty(true);
      persist(next);
    },
    [persist],
  );

  const undo = useCallback(() => {
    const cur = docRef.current;
    const prev = cur && history.current.undo(cur);
    if (prev) {
      docRef.current = prev;
      setDoc(prev);
      setDirty(true);
      persist(prev);
    }
  }, [persist]);
  const redo = useCallback(() => {
    const cur = docRef.current;
    const next = cur && history.current.redo(cur);
    if (next) {
      docRef.current = next;
      setDoc(next);
      setDirty(true);
      persist(next);
    }
  }, [persist]);

  /** Steps added from a picture (file, clipboard, the screenshot list) join the map. */
  const addStep = useCallback((s: GuideStep) => setSteps((m) => new Map(m).set(s.n, s)), []);

  // --- save, open, close ---------------------------------------------------------------------------------------------------------

  const save = useCallback(async (): Promise<boolean> => {
    const d = docRef.current;
    if (!d) return true;
    try {
      setBusy(true);
      window.clearTimeout(pendingWrite.current);
      let target = savedPath;
      if (!target) {
        target = await ipc.pickGuideSave(folder(), d.title);
        if (!target) return false;
      }
      const r = await ipc.docSave(target, !savedPath, d);
      remember(r.path);
      setSavedPath(r.path);
      setDirty(false);
      refreshRecent();
      return true;
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [savedPath, folder, refreshRecent]);

  const saveAs = useCallback(async (): Promise<boolean> => {
    const d = docRef.current;
    if (!d) return true;
    try {
      const target = await ipc.pickGuideSave(folder(), d.title);
      if (!target) return false;
      setBusy(true);
      window.clearTimeout(pendingWrite.current);
      const r = await ipc.docSave(target, true, d);
      remember(r.path);
      setSavedPath(r.path);
      setDirty(false);
      refreshRecent();
      return true;
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [folder, refreshRecent]);

  const closeNow = useCallback(async () => {
    window.clearTimeout(pendingWrite.current);
    await ipc.docClose().catch(() => undefined);
    history.current.clear();
    docRef.current = null;
    setDoc(null);
    setSteps(new Map());
    setSavedPath(null);
    setDirty(false);
    refreshRecent();
  }, [refreshRecent]);

  /** Run `then` when it is safe to replace the open guide: nothing open, saved and unchanged, or the person answered the question. */
  const guard = useCallback(
    (then: Then) => {
      if (!then) return;
      if (!docRef.current) return then();
      if (!dirty) {
        void closeNow().then(then);
        return;
      }
      setAsk({ then });
    },
    [dirty, closeNow],
  );

  const openPath = useCallback(
    async (path: string) => {
      try {
        setBusy(true);
        remember(path);
        await ipc.docOpen(path);
        await load();
        refreshRecent();
      } catch (e) {
        setError(String((e as { message?: string })?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [load, refreshRecent],
  );

  const open = useCallback(() => {
    guard(() => void ipc.pickGuideOpen(folder()).then((p) => p && void openPath(p)));
  }, [guard, folder, openPath]);

  const openRecent = useCallback((path: string) => guard(() => void openPath(path)), [guard, openPath]);

  const newGuide = useCallback(() => {
    guard(() => void ipc.guideStart().catch((e) => setError(String((e as { message?: string })?.message ?? e))));
  }, [guard]);

  const close = useCallback(() => guard(() => undefined), [guard]);

  const recordMore = useCallback(
    (afterBlock?: string) => {
      insertAfter.current = afterBlock;
      recording.current = true;
      void window.clearTimeout(pendingWrite.current);
      const d = docRef.current;
      const go = () => void ipc.guideRecordMore().catch((e) => (recording.current = false, setError(String((e as { message?: string })?.message ?? e))));
      // The document is on disk before the recording appends to the working copy.
      if (d) void ipc.docWrite(d).then(go).catch(go);
      else go();
    },
    [],
  );

  // A .snpd from Explorer (double-click, "Open with"), also when Snipmunk was already running.
  const guardRef = useRef(openRecent);
  guardRef.current = openRecent;
  useEffect(() => {
    const go = (path: string) => guardRef.current(path);
    void ipc.takePendingGuide().then((p) => p && go(p)).catch(() => undefined);
    const p = ipc.onOpenGuide(go);
    return () => void p.then((fn) => fn());
  }, []);

  // Keys: Ctrl+S, Ctrl+Shift+S, Ctrl+O.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!docRef.current || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, saveAs, open]);

  const title = doc?.title ?? "";
  const rename = useCallback((next: string) => change((d) => (next.trim() && next.trim() !== d.title ? { ...d, title: next.trim() } : d)), [change]);

  const dialogs: ReactNode = (
    <>
      <Dialog
        open={ask !== null}
        title={t("guide.saveFirstTitle")}
        onClose={() => setAsk(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const then = ask?.then;
                setAsk(null);
                void closeNow().then(then);
              }}
            >
              {t("guide.dontSave")}
            </Button>
            {savedPath && (
              <Button
                onClick={() =>
                  void saveAs().then((ok) => {
                    if (!ok) return;
                    const then = ask?.then;
                    setAsk(null);
                    void closeNow().then(then);
                  })
                }
              >
                {t("guide.saveAs")}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() =>
                void save().then((ok) => {
                  if (!ok) return;
                  const then = ask?.then;
                  setAsk(null);
                  void closeNow().then(then);
                })
              }
            >
              {savedPath ? t("guide.save") : t("guide.saveAs")}
            </Button>
          </>
        }
      >
        <p>{t("guide.saveFirstBody")}</p>
      </Dialog>
      <Dialog
        open={lost !== null}
        title={t("docs.recoverTitle")}
        onClose={() => setLost(null)}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                setLost(null);
                void closeNow();
              }}
            >
              {t("docs.discard")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setLost(null);
                void ipc.guideRecover("current").then(() => load());
              }}
            >
              {t("docs.recover", { count: lost?.steps ?? 0 })}
            </Button>
          </>
        }
      >
        <p>{t("docs.recoverBody", { title: lost?.title ?? "", count: lost?.steps ?? 0 })}</p>
      </Dialog>
      <Dialog open={error !== null} title={t("guide.errorTitle")} onClose={() => setError(null)} footer={<Button onClick={() => setError(null)}>{t("guide.ok")}</Button>}>
        <p>{error}</p>
      </Dialog>
    </>
  );

  const status: "notSaved" | "edited" | "saved" = !savedPath ? "notSaved" : dirty ? "edited" : "saved";
  const stepList = useMemo(() => steps, [steps]);
  void tick;
  return {
    doc,
    steps: stepList,
    title,
    savedPath,
    dirty,
    status,
    busy,
    recent,
    history: history.current,
    change,
    undo,
    redo,
    save,
    saveAs,
    open,
    openRecent,
    openPath,
    newGuide,
    close,
    recordMore,
    rename,
    addStep,
    dialogs,
    removeRecent: (p: string) => void ipc.docRecentRemove(p).then(refreshRecent),
    /** What the quit dialog needs to know. */
    quitInfo: { dirty: doc !== null && dirty, title, save },
    notify,
  };
}

export type GuideApi = ReturnType<typeof useGuide>;
export type { Block };
