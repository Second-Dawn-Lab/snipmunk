import { Button, Dialog } from "@seconddawn/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { ipc, projectCapture, type Capture, type OpenProject, type RecentProject, type Session } from "../ipc";
import { formatTime } from "../recording/timeline";
import type { Settings } from "../settings/defaults";
import { AppIcon } from "./AppIcons";
import { MenuItem } from "./MenuItem";
import { Pop } from "./Pop";
import { sessionStore } from "../sessionStore";

const LAST_FOLDER = "snipmunk.projectFolder";

const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

/** One step of a question before something replaces what is there: first the edits of a project, then the current recording. */
interface Ask {
  current: boolean;
  project: boolean;
  then: () => void;
}

/**
 * The recording mode: it shows ONE thing, the current recording (in the temp folder) or an opened project (.snpr). This keeps which
 * one, and everything around it: Save as project, Open, Save (Ctrl+S), Close, the questions before a new recording replaces the
 * current one, before Quit, and the restoring of unsaved edits after a crash. It returns what the window shows.
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
  const [project, setProject] = useState<OpenProject | null>(null);
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [quitAsk, setQuitAsk] = useState(false);
  const [restore, setRestore] = useState<string[] | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [defaults, setDefaults] = useState("");
  const [busy, setBusy] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Which recording is the current one (the one in the temp folder): asked again when the session changes.
  useEffect(() => {
    void ipc.currentRecording().then(setCurrentId).catch(() => undefined);
  }, [rawSession]);
  useEffect(() => {
    void ipc.defaultFolders().then((f) => setDefaults(f.recordings)).catch(() => undefined);
  }, []);
  const refreshRecent = useCallback(() => void ipc.projectRecent().then(setRecent).catch(() => undefined), []);
  useEffect(() => {
    if (recMode && !project) refreshRecent();
  }, [recMode, project, refreshRecent]);

  const current: Capture | null = useMemo(
    () => (currentId && rawSession ? rawSession.groups.flatMap((g) => g.captures).find((c) => c.id === currentId) ?? null : null),
    [currentId, rawSession],
  );
  const currentUnsaved = !!current && !current.savedPath;
  const shown: Capture | null = project ? projectCapture(project) : current;

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

  const guard = useCallback(
    (then: () => void) => {
      if (currentUnsaved || dirty) setAsk({ current: currentUnsaved, project: dirty, then });
      else then();
    },
    [currentUnsaved, dirty],
  );

  const openPath = useCallback(
    async (path: string) => {
      try {
        const p = await ipc.projectOpen(path);
        remember(path);
        if (project && project.id !== p.id) await ipc.projectClose(project.id, true).catch(() => undefined);
        setProject(p);
        setDirty(p.dirty);
        void ipc.setUnsaved(p.dirty).catch(() => undefined);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [project, setError, errorText],
  );

  const open = useCallback(
    () =>
      void ipc
        .pickProjectOpen(folder())
        .then((path) => path && guard(() => void openPath(path)))
        .catch((e) => setError(errorText(e))),
    [folder, guard, openPath, setError, errorText],
  );

  /** Save the current recording as a project (asks where) and show the project. False when cancelled. */
  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!current) return true;
    try {
      const path = await ipc.pickProjectSave(folder(), current.name);
      if (!path) return false;
      setBusy(true);
      await ipc.projectSave(current.id, path);
      remember(path);
      const p = await ipc.projectOpen(path);
      setProject(p);
      setDirty(false);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [current, folder, setError, errorText]);

  const saveEdits = useCallback(async (): Promise<boolean> => {
    if (!project) return true;
    try {
      setBusy(true);
      await ipc.projectCommit(project.id);
      setDirty(false);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [project, setError, errorText]);

  const saveAs = useCallback(async () => {
    if (!project) return;
    try {
      const path = await ipc.pickProjectSave(folder(), project.name);
      if (!path) return;
      setBusy(true);
      await ipc.projectSaveCopy(project.id, path);
      remember(path);
      await openPath(path);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [project, folder, openPath, setError, errorText]);

  const closeProject = useCallback(() => {
    if (!project) return;
    const close = () => {
      void ipc.projectClose(project.id, true).catch(() => undefined);
      setProject(null);
      setDirty(false);
    };
    if (dirty) setAsk({ current: false, project: true, then: close });
    else close();
  }, [project, dirty]);

  /** Something changed in the open project: it has unsaved edits (the backend keeps them in its journal). */
  const edited = useCallback(() => {
    if (project) setDirty(true);
  }, [project]);

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
    const p = ipc.onSaveFirst((what) => setAsk({ ...what, then: () => startRecording(settingsRef.current.recMode) }));
    return () => void p.then((fn) => fn());
  }, [startRecording]);

  // A recording starts: an open project (its edits were asked about before) is closed, so what is recorded is what is shown.
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    const closeIt = () => {
      const p = projectRef.current;
      if (!p) return;
      void ipc.projectClose(p.id, true).catch(() => undefined);
      setProject(null);
      setDirty(false);
    };
    const a = ipc.onRecordingState((s) => s.recording && closeIt());
    const b = ipc.onCaptureAdded(closeIt);
    return () => {
      void a.then((fn) => fn());
      void b.then((fn) => fn());
    };
  }, []);

  // Quit: one dialog that lists what is not saved.
  useEffect(() => {
    const p = ipc.onQuitRequested(() => setQuitAsk(true));
    return () => void p.then((fn) => fn());
  }, []);

  // A project file from Explorer (double-click, "Open with"), also when Snipmunk was already running.
  const openRef = useRef(openPath);
  openRef.current = openPath;
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    const go = (path: string) => guardRef.current(() => void openRef.current(path));
    void ipc.takePendingOpen().then((p) => p && go(p)).catch(() => undefined);
    const p = ipc.onOpenProject(go);
    return () => void p.then((fn) => fn());
  }, []);

  // Unsaved edits that a crash left: offered once at the start.
  useEffect(() => {
    void ipc.projectJournal().then((list) => list.length > 0 && setRestore(list)).catch(() => undefined);
  }, []);

  // Ctrl+S saves the open project, Ctrl+O opens one (in the recording mode).
  useEffect(() => {
    if (!recMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "s" && project) {
        e.preventDefault();
        void saveEdits();
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recMode, project, saveEdits, open]);

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
          setProject((p) => (p ? { ...p, name: stored } : p));
          setDirty(true);
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
  const header: ReactNode = shown && (
    <div className="recheader" role="group" aria-label={t("proj.header")}>
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
      <span className="recheader__spacer" />
      <Pop
        open={menuOpen}
        onClose={close}
        kind="menu"
        label={t("proj.file")}
        align="end"
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
        {project && <MenuItem label={t("proj.close")} onSelect={() => (close(), closeProject())} />}
        {!project && current && <MenuItem label={t("proj.discard")} danger onSelect={() => (close(), setDiscardAsk(true))} />}
        {project && <MenuItem label={t("ctx.showInExplorer")} onSelect={() => (close(), void ipc.openFolder(project.path).catch((e) => setError(errorText(e))))} />}
        {recent.length > 0 && (
          <>
            <div className="menuitem__heading">{t("proj.recent")}</div>
            {recent.slice(0, 6).map((r) => (
              <MenuItem key={r.path} label={r.name} disabled={!r.exists} onSelect={() => (close(), guard(() => void openPath(r.path)))} />
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
    </div>
  );

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
                <button type="button" disabled={!r.exists} className="recempty__card" onClick={() => guard(() => void openPath(r.path))} title={r.path}>
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

  // The questions run in order: the edits of an open project first, then the current recording.
  const step = ask?.project ? "project" : ask?.current ? "current" : null;
  const proceed = (after: () => void) => {
    if (!ask) return;
    const next = step === "project" && ask.current ? { ...ask, project: false } : null;
    if (next) setAsk(next);
    else {
      setAsk(null);
      after();
    }
  };
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
        open={ask !== null && step === "project"}
        title={t("proj.editsTitle", { name: project?.name ?? "" })}
        onClose={() => setAsk(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              {t("session.cancel")}
            </Button>
            <Button
              onClick={() => {
                // The edits are thrown away with the journal; the project goes on from its file.
                if (project) void ipc.projectClose(project.id, true);
                setProject(null);
                setDirty(false);
                proceed(ask?.then ?? (() => undefined));
              }}
            >
              {t("proj.editsDiscard")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveEdits().then((ok) => ok && proceed(ask?.then ?? (() => undefined)))}
            >
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
                    proceed(ask?.then ?? (() => undefined));
                  })
                  .catch((e) => setError(errorText(e)))
              }
            >
              {t("proj.askDiscard")}
            </Button>
            <Button variant="primary" onClick={() => void saveCurrent().then((ok) => ok && proceed(ask?.then ?? (() => undefined)))}>
              {t("proj.askSave")}
            </Button>
          </>
        }
      >
        <p>{t("proj.askBody")}</p>
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
                  if (dirty && !(await saveEdits())) return;
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
          {dirty && project && <li>{t("proj.quitItemProject", { name: project.name })}</li>}
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
                // Discard: the project is opened and closed at once, which removes its journal.
                const path = restore?.[0];
                setRestore(null);
                if (path) void ipc.projectOpen(path).then((p) => ipc.projectClose(p.id, true)).catch(() => undefined);
              }}
            >
              {t("proj.restoreDiscard")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const path = restore?.[0];
                setRestore(null);
                if (path) void openPath(path);
              }}
            >
              {t("proj.restore")}
            </Button>
          </>
        }
      >
        <p>{t("proj.restoreBody", { name: (restore?.[0] ?? "").replace(/^.*[\\/]/, "").replace(/\.snpr$/i, "") })}</p>
      </Dialog>
    </>
  );

  return { shown, project, dirty, header, empty, dialogs, edited, startRecording, open, folder };
}
