import { Button, Dialog } from "@seconddawn/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { ipc, projectCapture, type Capture, type OpenProject, type RecentProject, type Session } from "../ipc";
import { formatTime } from "../recording/timeline";
import { sessionStore } from "../sessionStore";
import type { Settings } from "../settings/defaults";
import { AppIcon } from "./AppIcons";
import { MenuItem } from "./MenuItem";
import { Pop } from "./Pop";

const LAST_FOLDER = "snipmunk.projectFolder";
/** The key of the tab of the current recording; project tabs have the id of their project. */
const CURRENT = "current";

const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

/**
 * A question before something happens: the current recording is not saved (`current`), or a project tab with unsaved edits is
 * closed (`tab`). `then` is what goes on when it is answered.
 */
interface Ask {
  current: boolean;
  tab: string | null;
  then: () => void;
}

/**
 * The recording mode: tabs above the player. The first tab is the current recording (kept in the temp folder), then one tab for
 * every opened project (.snpr). Only the active tab has a player and media; the others keep only their state (the effects are in
 * their journal in the temp folder). This keeps the tabs, and everything around them: Save as project, Open, Save (Ctrl+S), Close
 * (Ctrl+W), switching (Ctrl+Tab), the question before a new recording replaces an unsaved current one, before Quit, and the
 * restoring of unsaved edits after a crash. It returns what the window shows.
 */
export function useRecordingMode(args: {
  rawSession: Session | null;
  settings: Settings;
  recMode: boolean;
  setError: (message: string | null) => void;
  setNotice: (text: string | null) => void;
  errorText: (e: unknown) => string;
}) {
  const { rawSession, settings, recMode, setError, errorText } = args;
  const { t } = useT();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenProject[]>([]);
  const [activeKey, setActiveKey] = useState<string>(CURRENT);
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [quitAsk, setQuitAsk] = useState(false);
  const [restore, setRestore] = useState<string[] | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [defaults, setDefaults] = useState("");
  const [busy, setBusy] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Which recording is the current one (the one in the temp folder): asked again when the session changes.
  useEffect(() => {
    void ipc.currentRecording().then(setCurrentId).catch(() => undefined);
  }, [rawSession]);
  useEffect(() => {
    void ipc.defaultFolders().then((f) => setDefaults(f.recordings)).catch(() => undefined);
  }, []);
  const refreshRecent = useCallback(() => void ipc.projectRecent().then(setRecent).catch(() => undefined), []);
  useEffect(() => {
    if (recMode) refreshRecent();
  }, [recMode, tabs.length, refreshRecent]);

  const current: Capture | null = useMemo(
    () => (currentId && rawSession ? rawSession.groups.flatMap((g) => g.captures).find((c) => c.id === currentId) ?? null : null),
    [currentId, rawSession],
  );
  const currentUnsaved = !!current && !current.savedPath;

  // A new recording becomes the active tab (it replaces the old current one).
  const lastCurrent = useRef<string | null>(null);
  useEffect(() => {
    if (currentId && currentId !== lastCurrent.current) setActiveKey(CURRENT);
    lastCurrent.current = currentId;
  }, [currentId]);

  // The active tab: the current recording, or a project; when the active one is gone, the first that exists.
  const activeProject = activeKey !== CURRENT ? tabs.find((p) => p.id === activeKey) ?? null : null;
  const project = activeProject ?? (activeKey === CURRENT && current ? null : current ? null : tabs[0] ?? null);
  const dirty = project ? dirtyIds.includes(project.id) : false;
  const shown: Capture | null = project ? projectCapture(project) : current;
  const setDirtyFor = useCallback((id: string, on: boolean) => setDirtyIds((d) => (on ? (d.includes(id) ? d : [...d, id]) : d.filter((x) => x !== id))), []);

  /** Where a project is saved or opened by default: the last folder used, else the setting, else Videos\Snipmunk. */
  const folder = useCallback((): string => {
    let last = "";
    try {
      last = localStorage.getItem(LAST_FOLDER) ?? "";
    } catch {
      /* no storage */
    }
    return last || settingsRef.current.projectsDir || defaults;
  }, [defaults]);
  const remember = (path: string) => {
    try {
      localStorage.setItem(LAST_FOLDER, dirOf(path));
    } catch {
      /* no storage */
    }
  };

  /** Open a project in a tab and show it; a project that is open already is only shown. */
  const openPath = useCallback(
    async (path: string) => {
      try {
        const key = path.toLowerCase();
        const open = tabsRef.current.find((p) => p.path.toLowerCase() === key);
        if (open) {
          setActiveKey(open.id);
          return;
        }
        const p = await ipc.projectOpen(path);
        remember(path);
        setTabs((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
        setDirtyFor(p.id, p.dirty);
        setActiveKey(p.id);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [setError, errorText, setDirtyFor],
  );

  const open = useCallback(
    () =>
      void ipc
        .pickProjectOpen(folder())
        .then((path) => path && void openPath(path))
        .catch((e) => setError(errorText(e))),
    [folder, openPath, setError, errorText],
  );

  /** Save the current recording as a project (asks where) and show the project in a new tab. False when cancelled. */
  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!current) return true;
    try {
      const path = await ipc.pickProjectSave(folder(), current.name);
      if (!path) return false;
      setBusy(true);
      await ipc.projectSave(current.id, path);
      remember(path);
      await openPath(path);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [current, folder, openPath, setError, errorText]);

  const commit = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        setBusy(true);
        await ipc.projectCommit(id);
        setDirtyFor(id, false);
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [setError, errorText, setDirtyFor],
  );
  const saveEdits = useCallback(() => (project ? commit(project.id) : Promise.resolve(true)), [project, commit]);

  /** Close a tab at once (its edits and cache go). */
  const closeNow = useCallback(
    (id: string) => {
      void ipc.projectClose(id, true).catch(() => undefined);
      setTabs((list) => list.filter((p) => p.id !== id));
      setDirtyFor(id, false);
    },
    [setDirtyFor],
  );

  /** The ×, middle click and Ctrl+W: a tab with unsaved edits asks first. */
  const closeTab = useCallback(
    (id: string) => {
      if (dirtyIds.includes(id)) setAsk({ current: false, tab: id, then: () => closeNow(id) });
      else closeNow(id);
    },
    [dirtyIds, closeNow],
  );

  /** The × of the recording tab: an unsaved recording asks (Save as project / Discard / Cancel); one that is a project already just closes. */
  const [closeCurrentAsk, setCloseCurrentAsk] = useState(false);
  // Quit while a recording runs: "Stop and keep the recording?", then the usual list. A scrolling capture is thrown away on quit.
  const [stopAsk, setStopAsk] = useState(false);
  const [quitScrolling, setQuitScrolling] = useState(false);
  const discardCurrent = useCallback(
    () =>
      ipc
        .discardCurrentRecording()
        .then(() => setCurrentId(null))
        .catch((e) => setError(errorText(e))),
    [setError, errorText],
  );
  const closeCurrent = useCallback(() => {
    if (!current) return;
    if (!current.savedPath) setCloseCurrentAsk(true);
    else void discardCurrent();
  }, [current, discardCurrent]);

  const saveAs = useCallback(async () => {
    if (!project) return;
    try {
      const path = await ipc.pickProjectSave(folder(), project.name);
      if (!path) return;
      setBusy(true);
      await ipc.projectSaveCopy(project.id, path);
      remember(path);
      // The edits live on in the new file; the old tab goes back to its file (its edits are dropped).
      closeNow(project.id);
      await openPath(path);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [project, folder, closeNow, openPath, setError, errorText]);

  /** Something changed in the active project: it has unsaved edits (the backend keeps them in its journal). */
  const edited = useCallback(() => {
    if (project) setDirtyFor(project.id, true);
  }, [project, setDirtyFor]);

  const startRecording = useCallback(
    (area: Settings["recMode"]) =>
      void ipc.startRecording(area).catch((e) => {
        // "save-first": the question is on its way (the backend sent an event).
        if ((e as { code?: string }).code !== "save-first") setError(errorText(e));
      }),
    [setError, errorText],
  );

  // The backend wants a question answered before a recording starts (also from the shortcut and the tray).
  useEffect(() => {
    const p = ipc.onSaveFirst(() => setAsk({ current: true, tab: null, then: () => startRecording(settingsRef.current.recMode) }));
    return () => void p.then((fn) => fn());
  }, [startRecording]);

  // Quit: one dialog that lists what is not saved.
  useEffect(() => {
    const p = ipc.onQuitRequested((what) => {
      setQuitScrolling(what.scrolling);
      // A running recording is asked about first; then the list of what is not saved.
      if (what.recording) setStopAsk(true);
      else setQuitAsk(true);
    });
    return () => void p.then((fn) => fn());
  }, []);

  // A project file from Explorer (double-click, "Open with"), also when Snipmunk was already running.
  const openRef = useRef(openPath);
  openRef.current = openPath;
  useEffect(() => {
    const go = (path: string) => void openRef.current(path);
    void ipc.takePendingOpen().then((p) => p && go(p)).catch(() => undefined);
    const p = ipc.onOpenProject(go);
    return () => void p.then((fn) => fn());
  }, []);

  // Unsaved edits that a crash left (the journals of projects): offered once at the start.
  useEffect(() => {
    void ipc.projectJournal().then((list) => list.length > 0 && setRestore(list)).catch(() => undefined);
  }, []);

  // Keys: Ctrl+S saves the active project, Ctrl+O opens one, Ctrl+W closes the active project tab, Ctrl+Tab switches tabs.
  const keys = [...(current ? [CURRENT] : []), ...tabs.map((p) => p.id)];
  const activeNow = project ? project.id : CURRENT;
  useEffect(() => {
    if (!recMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "tab" && keys.length > 1) {
        e.preventDefault();
        const at = keys.indexOf(activeNow);
        setActiveKey(keys[(at + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
      } else if (e.shiftKey) {
        return;
      } else if (k === "s" && project) {
        e.preventDefault();
        void saveEdits();
      } else if (k === "o") {
        e.preventDefault();
        open();
      } else if (k === "w") {
        e.preventDefault();
        if (project) closeTab(project.id);
        else closeCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- what the window shows -------------------------------------------------------------------------------------------------

  const name = project ? project.name : current?.name ?? "";

  // Rename (click on the name or F2): the current recording is renamed in temp (it is the default file name of a project and of
  // exports); a project's display name inside the package changes (the file on disk keeps its name; saved with the next save).
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const startRename = () => {
    setDraft(name);
    setRenaming(true);
  };
  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === name) return;
    if (project) {
      void ipc
        .projectRename(project.id, next)
        .then((stored) => {
          setTabs((list) => list.map((p) => (p.id === project.id ? { ...p, name: stored } : p)));
          setDirtyFor(project.id, true);
        })
        .catch((e) => setError(errorText(e)));
    } else if (current) {
      void ipc
        .renameCapture(current.id, next)
        .then((s) => sessionStore.apply(s))
        .catch((e) => setError(errorText(e)));
    }
  };

  const status = project ? (dirty ? "edited" : "saved") : currentUnsaved ? "notSaved" : "saved";
  const sizeText = shown ? `${shown.width} × ${shown.height}${shown.durationMs ? ` · ${formatTime(shown.durationMs / 1000)}` : ""}` : "";
  const close = () => setMenuOpen(false);

  // The header: the File menu and the main button on the left, the name, status and size on the right (mirrored in right-to-left).
  const header: ReactNode = shown && (
    <div className="recheader" role="group" aria-label={t("proj.header")}>
      <Pop
        open={menuOpen}
        onClose={close}
        kind="menu"
        label={t("proj.file")}
        align="start"
        trigger={
          <button type="button" className="recheader__file" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {t("proj.file")}
            <AppIcon name="chevron" size={13} />
          </button>
        }
      >
        <MenuItem label={t("proj.open")} hint="Ctrl+O" onSelect={() => (close(), open())} />
        <MenuItem
          label={project ? t("proj.saveAsCopy") : t("proj.saveAs")}
          disabled={busy}
          onSelect={() => (close(), void (project ? saveAs() : saveCurrent()))}
        />
        {project && <MenuItem label={t("ctx.showInExplorer")} onSelect={() => (close(), void ipc.openFolder(project.path).catch((e) => setError(errorText(e))))} />}
        {project && <MenuItem label={t("proj.close")} hint="Ctrl+W" onSelect={() => (close(), closeTab(project.id))} />}
        {!project && current && <MenuItem label={t("proj.discard")} danger onSelect={() => (close(), setDiscardAsk(true))} />}
        {recent.length > 0 && (
          <>
            <div className="menuitem__heading">{t("proj.recent")}</div>
            {recent.slice(0, 6).map((r) => (
              <MenuItem key={r.path} label={r.name} disabled={!r.exists} onSelect={() => (close(), void openPath(r.path))} />
            ))}
          </>
        )}
      </Pop>
      {project ? (
        dirty ? (
          <Button variant="primary" disabled={busy} onClick={() => void saveEdits()} title="Ctrl+S">
            {t("proj.save")}
          </Button>
        ) : (
          <Button disabled>{t("proj.statusSaved")}</Button>
        )
      ) : (
        <Button variant="primary" disabled={busy} onClick={() => void saveCurrent()}>
          {t("proj.saveAs")}
        </Button>
      )}
      <span className="recheader__spacer" />
      <AppIcon name="video" size={18} />
      {renaming ? (
        <input
          className="recheader__input"
          autoFocus
          value={draft}
          maxLength={80}
          aria-label={t("proj.rename")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="recheader__name"
          title={project ? `${project.path}\n${t("proj.rename")}` : t("proj.rename")}
          onClick={startRename}
          onKeyDown={(e) => e.key === "F2" && startRename()}
        >
          <span>{name}</span>
          <AppIcon name="rename" size={13} />
        </button>
      )}
      <span className={`recheader__chip recheader__chip--${status}`}>
        {status === "edited" && <span className="recheader__dot" aria-hidden="true" />}
        {t(status === "edited" ? "proj.statusEdited" : status === "saved" ? "proj.statusSaved" : "proj.notSaved")}
      </span>
      <span className="recheader__size" dir="ltr">
        {sizeText}
      </span>
    </div>
  );

  // The tabs: the current recording first, then the projects (each with a ×; an unsaved one is "Name*"). They shrink, then scroll.
  const strip = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length, current?.id]);
  const scroll = (d: number) => strip.current?.scrollBy({ left: d * 160, behavior: "smooth" });
  const tabsBar: ReactNode =
    current || tabs.length > 0 ? (
      <div className={`rectabs${overflowing ? " rectabs--over" : ""}`} role="tablist" aria-label={t("proj.tabs")}>
        <button type="button" className="rectabs__arrow" aria-label={t("proj.tabsPrev")} onClick={() => scroll(-1)}>
          <AppIcon name="chevron" size={13} />
        </button>
        <div className="rectabs__strip" ref={strip}>
          {current && (
            <span className={`rectab${!project ? " rectab--active" : ""}`} role="presentation" title={current.name}>
              <button
                type="button"
                role="tab"
                aria-selected={!project}
                className="rectab__main"
                onClick={() => setActiveKey(CURRENT)}
                onAuxClick={(e) => e.button === 1 && closeCurrent()}
              >
                <span className="rectab__name">{current.name}</span>
                {currentUnsaved && (
                  <span className="rectab__mark" title={t("proj.unsavedDot")} aria-label={t("proj.unsavedDot")}>
                    *
                  </span>
                )}
              </button>
              <button type="button" className="rectab__close" aria-label={t("proj.closeTab", { name: current.name })} title={t("proj.closeCurrent")} onClick={closeCurrent}>
                <AppIcon name="close" size={11} />
              </button>
            </span>
          )}
          {tabs.map((p) => (
            <span key={p.id} className={`rectab${project?.id === p.id ? " rectab--active" : ""}`} role="presentation" title={`${p.name}\n${p.path}`}>
              <button
                type="button"
                role="tab"
                aria-selected={project?.id === p.id}
                className="rectab__main"
                onClick={() => setActiveKey(p.id)}
                onAuxClick={(e) => e.button === 1 && closeTab(p.id)}
              >
                <span className="rectab__name">{p.name}</span>
                {dirtyIds.includes(p.id) && (
                  <span className="rectab__mark" title={t("proj.unsavedDot")} aria-label={t("proj.unsavedDot")}>
                    *
                  </span>
                )}
              </button>
              <button type="button" className="rectab__close" aria-label={t("proj.closeTab", { name: p.name })} title={t("proj.close")} onClick={() => closeTab(p.id)}>
                <AppIcon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
        <button type="button" className="rectabs__arrow rectabs__arrow--next" aria-label={t("proj.tabsNext")} onClick={() => scroll(1)}>
          <AppIcon name="chevron" size={13} />
        </button>
      </div>
    ) : null;

  const empty = (onRecord: () => void): ReactNode => (
    <div className="recempty">
      <AppIcon name="video" size={44} />
      <h2>{t("proj.emptyTitle")}</h2>
      <p>{t("proj.emptyBody")}</p>
      <div className="recempty__buttons">
        <Button variant="primary" onClick={onRecord}>
          {t("proj.record")}
        </Button>
        <Button onClick={open}>{t("proj.open")}</Button>
      </div>
      {recent.length > 0 && (
        <section className="recempty__recent" aria-label={t("proj.recent")}>
          <h3>{t("proj.recent")}</h3>
          <ul>
            {recent.map((r) => (
              <li key={r.path} className={r.exists ? "" : "recempty__missing"}>
                <button type="button" disabled={!r.exists} className="recempty__card" onClick={() => void openPath(r.path)} title={r.path}>
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span className="recempty__thumb" />}
                  <span className="recempty__text">
                    <strong>{r.name}</strong>
                    <small>
                      {r.exists ? `${new Date(r.openedAt).toLocaleDateString()} · ${formatTime(r.durationMs / 1000)}` : t("proj.missing")}
                    </small>
                  </span>
                </button>
                {!r.exists && (
                  <button type="button" className="recempty__remove" onClick={() => void ipc.projectRecentRemove(r.path).then(refreshRecent)}>
                    {t("proj.removeFromList")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  const askTab = ask?.tab ? tabs.find((p) => p.id === ask.tab) ?? null : null;
  const step = askTab ? "tab" : ask?.current ? "current" : null;
  const finish = () => {
    const then = ask?.then;
    setAsk(null);
    then?.();
  };
  const dirtyTabs = tabs.filter((p) => dirtyIds.includes(p.id));
  const dialogs: ReactNode = (
    <>
      <Dialog
        open={discardAsk}
        title={t("proj.discardTitle")}
        onClose={() => setDiscardAsk(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscardAsk(false)}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscardAsk(false);
                void ipc
                  .discardCurrentRecording()
                  .then(() => setCurrentId(null))
                  .catch((e) => setError(errorText(e)));
              }}
            >
              {t("proj.discard")}
            </Button>
          </>
        }
      >
        <p>{t("proj.discardBody")}</p>
      </Dialog>
      <Dialog
        open={closeCurrentAsk}
        title={t("proj.closeAskTitle")}
        onClose={() => setCloseCurrentAsk(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseCurrentAsk(false)}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setCloseCurrentAsk(false);
                void discardCurrent();
              }}
            >
              {t("proj.askDiscard")}
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void saveCurrent().then((ok) => {
                  if (!ok) return;
                  setCloseCurrentAsk(false);
                  void discardCurrent();
                })
              }
            >
              {t("proj.askSave")}
            </Button>
          </>
        }
      >
        <p>{t("proj.closeAskBody")}</p>
      </Dialog>
      <Dialog
        open={ask !== null && step === "tab"}
        title={t("proj.editsTitle", { name: askTab?.name ?? "" })}
        onClose={() => setAsk(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              {t("session.cancel")}
            </Button>
            <Button onClick={finish}>{t("proj.editsDiscard")}</Button>
            <Button variant="primary" onClick={() => askTab && void commit(askTab.id).then((ok) => ok && finish())}>
              {t("proj.save")}
            </Button>
          </>
        }
      >
        <p>{t("proj.editsBody")}</p>
      </Dialog>
      <Dialog
        open={ask !== null && step === "current"}
        title={t("proj.askTitle")}
        onClose={() => setAsk(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                void ipc
                  .discardCurrentRecording()
                  .then(() => {
                    setCurrentId(null);
                    finish();
                  })
                  .catch((e) => setError(errorText(e)))
              }
            >
              {t("proj.askDiscard")}
            </Button>
            <Button variant="primary" onClick={() => void saveCurrent().then((ok) => ok && finish())}>
              {t("proj.askSave")}
            </Button>
          </>
        }
      >
        <p>{t("proj.askBody")}</p>
      </Dialog>
      <Dialog
        open={stopAsk}
        title={t("proj.stopAskTitle")}
        onClose={() => (setStopAsk(false), void ipc.cancelQuit())}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setStopAsk(false), void ipc.cancelQuit())}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setStopAsk(false);
                // The recording is stopped and kept as the current recording; then the list of what is not saved.
                void ipc
                  .guideState()
                  .then(async (g) => {
                    if (g.recording) await ipc.guideStop();
                    else await ipc.stopRecording();
                  })
                  .then(() => setQuitAsk(true))
                  .catch((e) => {
                    setError(errorText(e));
                    void ipc.cancelQuit();
                  });
              }}
            >
              {t("proj.stopKeep")}
            </Button>
          </>
        }
      >
        <p>{t("proj.stopAskBody")}</p>
      </Dialog>
      <Dialog
        open={quitAsk}
        title={t("proj.quitTitle")}
        onClose={() => (setQuitAsk(false), void ipc.cancelQuit())}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setQuitAsk(false), void ipc.cancelQuit())}>
              {t("session.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void ipc.quitApp()}>
              {t("proj.quitDont")}
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void (async () => {
                  for (const p of dirtyTabs) if (!(await commit(p.id))) return;
                  if (currentUnsaved && !(await saveCurrent())) return;
                  await ipc.quitApp();
                })()
              }
            >
              {t("proj.quitSave")}
            </Button>
          </>
        }
      >
        <p>{t("proj.quitBody")}</p>
        <ul>
          {currentUnsaved && current && <li>{t("proj.quitItemCurrent", { name: current.name })}</li>}
          {dirtyTabs.map((p) => (
            <li key={p.id}>{t("proj.quitItemProject", { name: p.name })}</li>
          ))}
          {quitScrolling && <li>{t("proj.quitItemScrolling")}</li>}
        </ul>
      </Dialog>
      <Dialog
        open={restore !== null && restore.length > 0}
        title={t("proj.restoreTitle")}
        onClose={() => setRestore(null)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                // Discard: each project is opened and closed at once, which removes its journal.
                const paths = restore ?? [];
                setRestore(null);
                for (const path of paths) void ipc.projectOpen(path).then((p) => ipc.projectClose(p.id, true)).catch(() => undefined);
              }}
            >
              {t("proj.restoreDiscard")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                // Restore: every project comes back as a tab with its unsaved edits.
                const paths = restore ?? [];
                setRestore(null);
                for (const path of paths) void openPath(path);
              }}
            >
              {t("proj.restore")}
            </Button>
          </>
        }
      >
        <p>{t("proj.restoreBody", { name: (restore ?? []).map((p) => p.replace(/^.*[\\/]/, "").replace(/\.snpr$/i, "")).join(", ") })}</p>
      </Dialog>
    </>
  );

  return { shown, project, dirty, header, tabsBar, empty, dialogs, edited, startRecording, open, folder };
}
