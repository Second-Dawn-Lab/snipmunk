import { useSettings } from "@seconddawn/settings";
import { Button, Dialog, Icon } from "@seconddawn/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DropPlan } from "../gallery/fileTypes";
import { isGalleryView } from "../gallery/layout";
import { moveIds, isNoopMove } from "../gallery/reorder";
import {
  clearSelection,
  clickSelect,
  contextTargets,
  emptySelection,
  keySelect,
  pruneTo,
  selectEvery,
  toggleSelect,
  type SelectionChange,
  type Selection,
} from "../gallery/selection";
import { useFileDrop } from "../gallery/useFileDrop";
import { nextGroupName } from "../groupNames";
import { activeAfterGroupDelete, planGroupDelete, type DeleteChoice } from "../groupRules";
import { dictionaries } from "../i18n";
import { useT } from "../i18n";
import { onNotice } from "../notify";
import { ipc, type Capture, type CmdError, type Group, type Session } from "../ipc";
import { formatTime as formatDuration } from "../recording/timeline";
import { SearchIndex } from "../search";
import { stageAll } from "../share/exporter";
import { SaveDialog } from "./SaveDialog";
import { Toasts, useToasts, type ToastAction } from "./Toasts";
import { SearchResults, type SearchHit } from "./SearchResults";
import { useShareActions } from "./useShareActions";
import {
  activeAfterDeleting,
  deleteTargets,
  groupOrFirst,
  sortCaptures,
  totalCaptures,
  validActive,
  zoomIn,
  zoomOut,
  type SortMode,
} from "../sessionModel";
import { sessionStore, useSession } from "../sessionStore";
import type { CopyMode } from "../settings/defaults";
import { settingsStore } from "../settings/store";
import { useStable } from "../useStable";
import { BottomBar } from "./BottomBar";
import { CaptureList } from "./CaptureList";
import { CloseDialog } from "./CloseDialog";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { DeleteGroupDialog } from "./DeleteGroupDialog";
import type { GalleryActions } from "./Gallery";
import { GroupTabs } from "./GroupTabs";
import { HotkeyNotice } from "./HotkeyNotice";
import { MenuItem } from "./MenuItem";
import { Preview, type ZoomMode } from "./Preview";
import { TitleBar } from "./TitleBar";
import { TopBar } from "./TopBar";

function messageOf(e: unknown): string {
  const err = e as Partial<CmdError> | undefined;
  return err?.message ?? String(e);
}

/** What each group tab remembers: its selection and the capture on show. */
interface GroupView {
  sel: Selection;
  active: string | null;
}
const EMPTY_VIEW: GroupView = { sel: emptySelection, active: null };

interface CardMenu {
  x: number;
  y: number;
  ids: string[];
  canRename: boolean;
}

/** The one page of Snipmunk: title bar, header, the capture list on the left, the preview on the right. */
export function MainWindow() {
  const { t, locale } = useT();
  const { settings, patch } = useSettings(settingsStore);
  const session = useSession();
  const shareRef = useRef<ReturnType<typeof useShareActions> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const printTargetsRef = useRef<() => Capture[]>(() => []);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("newest");
  const [views, setViews] = useState<Record<string, GroupView>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState<CopyMode>(settings.defaultCopyMode);
  // Every notice and error is a toast over the content (see Toasts.tsx); nothing pushes the layout down.
  const { toasts, push: pushToast, close: closeToast } = useToasts();
  const setError = useCallback(
    (message: string | null) => {
      if (message) pushToast({ kind: "error", text: t("session.error", { message }) });
    },
    [pushToast, t],
  );
  const setNotice = useCallback(
    (text: string | null, action?: ToastAction) => {
      if (text) pushToast({ kind: "notice", text, action });
    },
    [pushToast],
  );
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [scope, setScope] = useState<"group" | "all">("group");
  const [ixVersion, setIxVersion] = useState(0);
  const [ocrPending, setOcrPending] = useState(0);
  const searchBox = useRef<HTMLInputElement>(null);
  const ix = useRef(new SearchIndex()).current;
  const [confirmNew, setConfirmNew] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [cardDropTab, setCardDropTab] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [effectiveZoom, setEffectiveZoom] = useState(1);

  // The setting is the default; the dropdown changes it (and is remembered).
  useEffect(() => setCopyMode(settings.defaultCopyMode), [settings.defaultCopyMode]);
  const chooseCopyMode = (mode: CopyMode) => {
    setCopyMode(mode);
    void patch({ defaultCopyMode: mode });
  };

  // --- the search index: names, window titles and recognized text, folded once ----------------------------------------
  useEffect(() => {
    const t = setTimeout(() => setApplied(query), 120);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!session) return;
    const ids = new Set<string>();
    for (const g of session.groups) {
      for (const c of g.captures) {
        ids.add(c.id);
        ix.setMeta(c);
      }
    }
    ix.keepOnly(ids);
    setIxVersion((v) => v + 1);
  }, [session, ix]);
  const sessionId = session?.id;
  useEffect(() => {
    let alive = true;
    void ipc
      .ocrTexts()
      .then((all) => {
        if (!alive) return;
        for (const [id, text] of Object.entries(all)) ix.setText(id, text);
        setIxVersion((v) => v + 1);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId, ix]);
  useEffect(() => {
    const ready = ipc.onOcrReady((id) => {
      void ipc.ocrGet(id).then((r) => {
        if (!r) return;
        ix.setText(id, r.lines.map((l) => l.text).join("\n"));
        setIxVersion((v) => v + 1);
      });
    });
    const queue = ipc.onOcrQueue(setOcrPending);
    return () => {
      void ready.then((fn) => fn());
      void queue.then((fn) => fn());
    };
  }, [ix]);

  const group = session ? groupOrFirst(session, groupId) : null;
  const baseShown = useMemo(() => (group ? sortCaptures(group.captures, sort) : []), [group, sort]);
  const searching = applied.trim() !== "";
  // "This group": the list is the matching captures (in the group's order). "All groups": a separate list of results.
  const shown = useMemo(() => {
    if (!searching || scope !== "group") return baseShown;
    const hit = new Set(ix.search(applied, baseShown.map((c) => c.id)));
    return baseShown.filter((c) => hit.has(c.id));
  }, [baseShown, searching, scope, applied, ixVersion]);
  const hits = useMemo<SearchHit[]>(() => {
    if (!searching || scope !== "all" || !session) return [];
    const out: SearchHit[] = [];
    for (const g of session.groups) {
      const byId = new Map(g.captures.map((c) => [c.id, c]));
      for (const id of ix.search(applied, g.captures.map((c) => c.id))) out.push({ group: g, capture: byId.get(id) as Capture });
    }
    return out;
  }, [session, searching, scope, applied, ixVersion]);
  const unread = useMemo(() => {
    if (!searching || !session) return 0;
    const ids = (scope === "all" ? session.groups.flatMap((g) => g.captures) : baseShown).map((c) => c.id);
    return ix.unread(ids);
  }, [session, searching, scope, baseShown, ixVersion]);
  const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
  const gid = group?.id ?? "";
  const view: GroupView = views[gid] ?? EMPTY_VIEW;
  const currentId = validActive(shownIds, view.active);
  const capture = shown.find((c) => c.id === currentId) ?? null;
  const galleryView = isGalleryView(settings.galleryView) ? settings.galleryView : "list";

  /** Change the selection and/or the capture on show of the shown group. */
  const applyChange = useCallback(
    (change: SelectionChange | null) => {
      if (!change || !gid) return;
      setViews((prev) => {
        const v = prev[gid] ?? EMPTY_VIEW;
        return { ...prev, [gid]: { sel: change.selection, active: change.active === undefined ? v.active : change.active } };
      });
    },
    [gid],
  );
  const setView = useCallback((groupKey: string, next: GroupView) => setViews((prev) => ({ ...prev, [groupKey]: next })), []);

  // Captures that are gone (deleted, or moved to another group) leave the selections; so do deleted groups.
  useEffect(() => {
    if (!session) return;
    setViews((prev) => {
      let changed = false;
      const next: Record<string, GroupView> = {};
      for (const [key, v] of Object.entries(prev)) {
        const g = session.groups.find((x) => x.id === key);
        if (!g) {
          changed = true;
          continue;
        }
        const alive = new Set(g.captures.map((c) => c.id));
        const sel = pruneTo(v.sel, alive);
        const active = v.active !== null && !alive.has(v.active) ? null : v.active;
        if (sel !== v.sel || active !== v.active) changed = true;
        next[key] = sel === v.sel && active === v.active ? v : { sel, active };
      }
      return changed ? next : prev;
    });
  }, [session]);

  const run = useCallback(async (work: Promise<Session>): Promise<Session | null> => {
    try {
      const next = await work;
      sessionStore.apply(next);
      setError(null);
      return next;
    } catch (e) {
      setError(messageOf(e));
      return null;
    }
  }, []);

  /** "Group 2" in the user's language: the lowest number no default-named group has (renamed groups do not count). */
  const newGroupName = useCallback(
    (existing: readonly string[]) => {
      const templates = Object.values(dictionaries).map((d) => (d as Record<string, string>)["groups.defaultName"]);
      const own = (dictionaries[locale as keyof typeof dictionaries] as Record<string, string>)["groups.defaultName"];
      return nextGroupName(existing, own, locale, templates);
    },
    [locale],
  );

  // New captures land in the group tab that is shown.
  const shownGroupId = session && group ? group.id : null;
  useEffect(() => {
    void ipc.setActiveGroup(shownGroupId);
  }, [shownGroupId]);

  // The recorder: a bar with the time and Stop while a recording runs (the floating bar of a later step replaces it).
  const [recStart, setRecStart] = useState(0);
  const [recNow, setRecNow] = useState(0);
  useEffect(() => {
    void ipc.recordingState().then((s) => setRecStart(s.recording ? s.startedAt : 0)).catch(() => undefined);
    const sub = ipc.onRecordingState((s) => setRecStart(s.recording ? s.startedAt : 0));
    return () => {
      void sub.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    if (!recStart) return;
    setRecNow(Date.now());
    const timer = setInterval(() => setRecNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recStart]);
  const stopRecording = () => void ipc.stopRecording().then((s) => sessionStore.apply(s)).catch((e) => setError(messageOf(e)));

  // "Start recording" from the tray: the recording mode starts the same way as the Record button.
  useEffect(() => {
    const started = ipc.onStartRecording(() => {
      void patch({ captureKind: "video" });
      void ipc.startRecording(settingsRef.current.recMode).catch((e) => setError(messageOf(e)));
    });
    return () => {
      void started.then((fn) => fn());
    };
  }, [patch, setError]);

  // A capture was taken (by the shortcut, the button or the tray): show it, in its group.
  useEffect(() => {
    const added = ipc.onCaptureAdded(({ captureId, groupId: target }) => {
      setGroupId(target);
      setViews((prev) => ({ ...prev, [target]: { sel: emptySelection, active: captureId } }));
    });
    const failed = ipc.onCaptureError((message) => setError(message));
    return () => {
      void added.then((fn) => fn());
      void failed.then((fn) => fn());
    };
  }, []);

  // Messages from the editor (text copied, redactions made, recognition failed).
  useEffect(
    () =>
      onNotice((n) => {
        if (n.error) setError(n.text);
        else setNotice(n.text);
      }),
    [],
  );


  // A different capture starts fitted.
  useEffect(() => setZoomMode("fit"), [currentId]);

  // Deleting always asks first: Del and the trash icons only choose what would be deleted.
  const askDelete = useCallback(
    (clicked?: string) => {
      if (!session) return;
      const ids = deleteTargets(session, view.sel.ids, currentId, clicked);
      if (ids.length > 0) setPendingDelete(ids);
    },
    [session, view.sel, currentId],
  );

  const confirmDelete = async () => {
    const ids = pendingDelete ?? [];
    setPendingDelete(null);
    const gone = new Set(ids);
    applyChange({ selection: view.sel, active: activeAfterDeleting(shownIds, gone, currentId) });
    for (const id of ids) {
      if ((await run(ipc.deleteCapture(id))) === null) break;
    }
  };

  const zoom = useMemo(
    () => ({
      percent: Math.round(effectiveZoom * 100),
      enabled: capture !== null,
      actual: () => setZoomMode(1),
      fit: () => setZoomMode("fit"),
      zoomIn: () => setZoomMode(zoomIn(effectiveZoom)),
      zoomOut: () => setZoomMode(zoomOut(effectiveZoom)),
    }),
    [effectiveZoom, capture],
  );

  const dialogOpen = pendingDelete !== null || confirmNew || groupToDelete !== null;

  // Keyboard: Del deletes, Ctrl+A selects all, Esc clears the selection, F2 renames, Ctrl+0 / Ctrl++ / Ctrl+- / Ctrl+1
  // zoom the preview. Not while the user is typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) &&
        !(target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "range" || target.type === "radio"));
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !dialogOpen && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
        return;
      }
      if (typing || dialogOpen) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        void shareRef.current?.openFile();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        void shareRef.current?.print(printTargetsRef.current());
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        askDelete();
        return;
      }
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && view.sel.ids.size > 0) {
        e.preventDefault();
        applyChange({ selection: clearSelection(), active: undefined });
        return;
      }
      if (e.key === "F2" && currentId && !menu) {
        e.preventDefault();
        setRenamingId(currentId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        applyChange(selectEvery(view.sel, shownIds, currentId));
        return;
      }
      if (!e.ctrlKey || e.altKey || !capture) return;
      const step =
        e.key === "0" || e.code === "Numpad0"
          ? zoom.actual
          : e.key === "1" || e.code === "Numpad1"
            ? zoom.fit
            : e.key === "+" || e.key === "=" || e.code === "NumpadAdd"
              ? zoom.zoomIn
              : e.key === "-" || e.code === "NumpadSubtract"
                ? zoom.zoomOut
                : null;
      if (step) {
        e.preventDefault();
        step();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askDelete, applyChange, capture, currentId, dialogOpen, menu, shownIds, view.sel, zoom]);

  // --- actions on captures ---------------------------------------------------------------------------------------

  const duplicate = async (ids: string[]) => {
    try {
      const result = await ipc.duplicateCaptures(ids, t("captures.copySuffix"));
      sessionStore.apply(result.session);
      if (result.ids.length > 0) {
        setView(gid, { sel: { ids: new Set(result.ids), anchor: result.ids[0] }, active: result.ids[0] });
      }
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const moveToGroup = async (ids: string[], target: string) => {
    if (target === gid) return;
    const next = activeAfterDeleting(shownIds, new Set(ids), currentId);
    if (await run(ipc.moveCaptures(ids, target))) {
      setView(gid, { sel: emptySelection, active: next });
    }
  };

  const moveToNewGroup = async (ids: string[]) => {
    const made = await run(ipc.createGroup(newGroupName(session?.groups.map((g) => g.name) ?? [])));
    if (made) await moveToGroup(ids, made.groups[made.groups.length - 1].id);
  };

  const reorder = async (ids: string[], slot: number) => {
    if (searching) return;
    if (isNoopMove(shownIds, ids, slot)) return;
    // Dropping always makes the order the user's own: the list is saved as it now looks.
    const order = moveIds(shownIds, ids, slot);
    setSort("custom");
    await run(ipc.reorderCaptures(gid, order));
  };

  const dragFiles = useRef<{ ids: string[]; promise: Promise<string[]> } | null>(null);
  const byIdsInList = (ids: readonly string[]): Capture[] => {
    const want = new Set(ids);
    return baseShown.filter((c) => want.has(c.id));
  };

  const actions: GalleryActions = useStable({
    select: (id: string, mods: { ctrl: boolean; shift: boolean }) =>
      applyChange(clickSelect(view.sel, shownIds, id, mods, currentId)),
    toggle: (id: string) => applyChange(toggleSelect(view.sel, id)),
    navigate: (step: number | "first" | "last", extend: boolean) =>
      applyChange(keySelect(view.sel, shownIds, currentId, step, extend)),
    contextMenu: (id: string, x: number, y: number) => {
      const targets = contextTargets(view.sel, shownIds, id);
      applyChange({ selection: targets.selection, active: targets.selection === view.sel ? undefined : id });
      setMenu({ x, y, ids: targets.ids, canRename: targets.canRename });
    },
    rename: (id: string) => setRenamingId(id),
    commitRename: (id: string, name: string | null) => {
      setRenamingId(null);
      const current = shown.find((c) => c.id === id);
      if (name && current && name !== current.name) void run(ipc.renameCapture(id, name));
    },
    trash: (id: string) => askDelete(id),
    reorder: (ids: string[], slot: number) => void reorder(ids, slot),
    moveToGroup: (ids: string[], target: string) => void moveToGroup(ids, target),
    dragTarget: (target: string | null) => setCardDropTab(target),
    prepareDrag: (ids: string[]) => {
      if (!session) return;
      const promise = stageAll("drag", session, byIdsInList(ids));
      promise.catch(() => undefined);
      dragFiles.current = { ids, promise };
    },
    dragOut: (ids: string[]) => {
      if (!session) return;
      void (async () => {
        try {
          const prepared = dragFiles.current;
          const same = prepared && prepared.ids.length === ids.length && prepared.ids.every((id, i) => id === ids[i]);
          const files = await (same ? prepared.promise : stageAll("drag", session, byIdsInList(ids)));
          if (files.length > 0) await ipc.exportDrag(files, files[0]);
        } catch (e) {
          setError(messageOf(e));
        }
      })();
    },
  });

  // --- files dropped into the window ----------------------------------------------------------------------------

  const importFiles = async (files: File[], skipped: number, target: string) => {
    let added = 0;
    for (const file of files) {
      try {
        sessionStore.apply(await ipc.importImage(target, file));
        added++;
      } catch (e) {
        if ((e as Partial<CmdError>).code === "unsupported") skipped++;
        else {
          setError(messageOf(e));
          break;
        }
      }
    }
    const parts: string[] = [];
    if (added > 0) parts.push(t("drop.added", { count: added }));
    if (skipped > 0) parts.push(t("drop.skipped", { count: skipped }));
    if (parts.length > 0) setNotice(parts.join(" "));
  };

  const share = useShareActions({
    session,
    group,
    settings,
    patch: (change) => void patch(change),
    notify: (text, saved) =>
      setNotice(text, saved ? { label: t("save.openFolder"), run: () => void ipc.openFolder(saved.first).catch((e) => setError(messageOf(e))) } : undefined),
    fail: setError,
    importFiles,
  });
  shareRef.current = share;

  const fileDrag = useFileDrop((plan: DropPlan<File>, tab) => {
    if (!session || !group) return;
    if (plan.kind === "url") return setNotice(t("drop.saveFirst"));
    if (plan.kind !== "files") return;
    void importFiles(plan.accepted, plan.skipped, tab ?? group.id);
  });
  const dropGroup = fileDrag ? (session?.groups.find((g) => g.id === (fileDrag.target ?? group?.id)) ?? null) : null;

  if (!session || !group) return null;

  const count = totalCaptures(session);

  /** The captures with these ids, in the order of the list (the group's current order). */
  const byIds = (ids: readonly string[]): Capture[] => {
    const want = new Set(ids);
    return baseShown.filter((c) => want.has(c.id));
  };
  /** The selection, or the capture shown in the preview when nothing is selected (Select all selects everything). */
  const selectionOrCurrent = (): Capture[] => (view.sel.ids.size > 0 ? byIds([...view.sel.ids]) : capture ? [capture] : []);
  printTargetsRef.current = () => (view.sel.ids.size > 0 ? byIds([...view.sel.ids]) : capture ? [capture] : []);
  const clearSearch = () => {
    setQuery("");
    setApplied("");
  };
  const openHit = (h: SearchHit) => {
    setGroupId(h.group.id);
    setViews((prev) => ({ ...prev, [h.group.id]: { sel: emptySelection, active: h.capture.id } }));
  };

  const startNewSession = async (discard: boolean) => {
    setConfirmNew(false);
    const next = await run(ipc.newSession(discard, newGroupName([])));
    if (next) {
      setGroupId(null);
      setViews({});
    }
  };

  const onNewSession = () => {
    if (count === 0) return void startNewSession(false);
    // "autoExport" needs the export feature (a later version): until then it keeps the captures, like "ask" -> keep.
    if (settings.newSessionAction === "clear") return void startNewSession(true);
    if (settings.newSessionAction === "autoExport") return void startNewSession(false);
    setConfirmNew(true);
  };

  const addGroup = async () => {
    const next = await run(ipc.createGroup(newGroupName(session.groups.map((g) => g.name))));
    if (next) setGroupId(next.groups[next.groups.length - 1].id);
  };

  const askDeleteGroup = (g: Group) => {
    if (!planGroupDelete(session.groups, g.id, { mode: "delete" }).ok) return;
    if (g.captures.length === 0) void removeGroup(g, { mode: "delete" });
    else setGroupToDelete(g);
  };

  const removeGroup = async (g: Group, choice: DeleteChoice) => {
    setGroupToDelete(null);
    const plan = planGroupDelete(session.groups, g.id, choice);
    if (!plan.ok) return;
    setGroupId(activeAfterGroupDelete(session.groups, g.id, group.id, plan.moveTo));
    await run(ipc.deleteGroup(g.id, plan.moveTo ?? undefined));
  };

  // --- the card menu ---------------------------------------------------------------------------------------------

  const closeMenu = () => setMenu(null);
  const cardMenuEntries = (m: CardMenu): MenuEntry[] => {
    const others = session.groups.filter((g) => g.id !== group.id);
    return [
      {
        kind: "item",
        id: "rename",
        label: t("ctx.rename"),
        icon: "rename",
        disabled: !m.canRename,
        onSelect: () => setRenamingId(m.ids[0]),
      },
      { kind: "item", id: "duplicate", label: t("ctx.duplicate"), icon: "duplicate", onSelect: () => void duplicate(m.ids) },
      {
        kind: "sub",
        id: "move",
        label: t("ctx.moveTo"),
        icon: "folder",
        children: (
          <div className="ctxmenu__list">
            {others.map((g) => (
              <MenuItem
                key={g.id}
                label={`${g.emoji ? `${g.emoji} ` : ""}${g.name}`}
                onSelect={() => {
                  closeMenu();
                  void moveToGroup(m.ids, g.id);
                }}
              />
            ))}
            <MenuItem
              label={t("ctx.newGroup")}
              icon="plus"
              onSelect={() => {
                closeMenu();
                void moveToNewGroup(m.ids);
              }}
            />
          </div>
        ),
      },
      { kind: "separator", id: "sep1" },
      { kind: "item", id: "copy", label: t("ctx.copy"), icon: "copy", onSelect: () => void share.copy(byIds(m.ids), copyMode) },
      { kind: "item", id: "save", label: t("ctx.save"), icon: "save", onSelect: () => share.save(byIds(m.ids)) },
      { kind: "separator", id: "sep2" },
      { kind: "item", id: "delete", label: t("ctx.delete"), icon: "trash", danger: true, onSelect: () => setPendingDelete(m.ids) },
    ];
  };

  return (
    <div className="shell">
      <TitleBar />

      <TopBar
        settings={settings}
        onPatch={(change) => void patch(change)}
        onNewSession={onNewSession}
        onOpenSettings={() => void ipc.openSettings()}
        onCapture={(mode) => void ipc.startCapture(mode).catch((e) => setError(messageOf(e)))}
        zoom={zoom}
        onRecord={(area) => void ipc.startRecording(area).catch((e) => setError(messageOf(e)))}
        share={{
          hasCapture: capture !== null,
          busy: share.busy,
          canShare: share.canShare,
          onPaint: () => capture && void share.paint(capture),
          onSave: () => capture && share.save([capture]),
          onCopy: () => capture && void share.copy([capture], copyMode),
          onShare: () => capture && void share.share(view.sel.ids.size > 0 ? byIds([...view.sel.ids]) : [capture]),
          onOpenFile: () => void share.openFile(),
          onOpenFolder: () => void share.openFolder(),
          onPrint: () => void share.print(printTargetsRef.current()),
        }}
      />

      <HotkeyNotice onOpenSettings={() => void ipc.openSettings()} />

      <Toasts toasts={toasts} onClose={closeToast} />
      {recStart > 0 && (
        <div className="recbar" role="status">
          <span className="recdot recdot--live" aria-hidden="true" />
          <span dir="ltr">{formatDuration(Math.max(0, recNow - recStart) / 1000)}</span>
          <button type="button" className="dw-btn dw-btn--danger" onClick={stopRecording}>
            {t("rec.stop")}
          </button>
        </div>
      )}

      <main className="panels">
        <div className={`panel panel--left panel--${galleryView}`}>
          <GroupTabs
            groups={session.groups}
            activeId={group.id}
            dropTargetId={fileDrag ? (fileDrag.target ?? null) : cardDropTab}
            onSelect={setGroupId}
            onAdd={() => void addGroup()}
            onRename={(id, name) => void run(ipc.renameGroup(id, name))}
            onDelete={askDeleteGroup}
            onReorder={(ids) => void run(ipc.reorderGroups(ids))}
            onColor={(id, color) => void run(ipc.setGroupColor(id, color))}
            onEmoji={(id, emoji) => void run(ipc.setGroupEmoji(id, emoji))}
          />
          <div className="searchbar" role="search">
            <input
              ref={searchBox}
              className="searchbar__input"
              type="search"
              value={query}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  clearSearch();
                }
              }}
            />
            {query && (
              <button type="button" className="searchbar__clear" aria-label={t("search.clear")} title={t("search.clear")} onClick={clearSearch}>
                <Icon name="close" size={14} />
              </button>
            )}
            <span className="segmented" role="group" aria-label={t("search.scope")}>
              <button type="button" className="segmented__btn" aria-pressed={scope === "group"} onClick={() => setScope("group")}>
                {t("search.scopeGroup")}
              </button>
              <button type="button" className="segmented__btn" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                {t("search.scopeAll")}
              </button>
            </span>
          </div>
          {searching && unread > 0 && ocrPending > 0 && (
            <p className="searchbar__hint" role="status">
              {t("search.reading")}
            </p>
          )}
          {searching && scope === "all" ? (
            hits.length > 0 ? (
              <SearchResults session={session} hits={hits} activeId={currentId} onOpen={openHit} />
            ) : (
              <p className="searchbar__none">{t("search.none", { query: applied.trim() })}</p>
            )
          ) : searching && shown.length === 0 ? (
            <p className="searchbar__none">{t("search.none", { query: applied.trim() })}</p>
          ) : (
          <CaptureList
            session={session}
            groupId={group.id}
            captures={shown}
            view={galleryView}
            activeId={currentId}
            selected={view.sel.ids}
            renamingId={renamingId}
            sort={sort}
            hotkey={settings.captureHotkey}
            actions={actions}
            onSort={setSort}
            onView={(next) => void patch({ galleryView: next })}
            onSelectAll={() => applyChange(selectEvery(view.sel, shownIds, currentId))}
            onClearAll={() => applyChange({ selection: clearSelection(), active: undefined })}
          />
          )}
        </div>
        <div className="panel panel--right">
          <Preview
            session={session}
            capture={capture}
            zoomMode={zoomMode}
            onZoom={setEffectiveZoom}
            onZoomMode={setZoomMode}
            zoom={effectiveZoom}
            onError={(e) => setError(messageOf(e))}
            settings={settings}
            onPatch={(change) => void patch(change)}
            searchQuery={searching ? applied : ""}
          />
        </div>
        {dropGroup && (
          <div className={`dropoverlay${dropGroup.color ? ` gc-${dropGroup.color}` : ""}`} aria-hidden="true">
            <div className="dropoverlay__msg">
              {t("drop.overlay", { group: `${dropGroup.emoji ? `${dropGroup.emoji} ` : ""}${dropGroup.name}` })}
            </div>
          </div>
        )}
      </main>

      <BottomBar
        selectedCount={view.sel.ids.size}
        hasCapture={capture !== null}
        copyMode={copyMode}
        onCopyMode={chooseCopyMode}
        busy={share.busy}
        onCopy={() => void share.copy(selectionOrCurrent(), copyMode)}
        onSave={() => share.save(selectionOrCurrent())}
      />

      <SaveDialog
        captures={share.saving}
        settings={settings}
        onCancel={() => share.setSaving(null)}
        onSave={(captures, o) => void share.doSave(captures, o)}
      />

      <Dialog
        open={share.tooLarge !== null}
        title={t("bottom.copyMode")}
        onClose={() => share.setTooLarge(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => share.setTooLarge(null)}>
              {t("session.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const big = share.tooLarge;
                share.setTooLarge(null);
                if (big) void share.copy(big.captures, "separate");
              }}
            >
              {t("copy.separateInstead")}
            </Button>
          </>
        }
      >
        <p>{share.tooLarge ? t("copy.tooLarge", { width: share.tooLarge.width, height: share.tooLarge.height }) : ""}</p>
      </Dialog>

      {menu && <ContextMenu x={menu.x} y={menu.y} label={t("captures.title", { count: menu.ids.length })} entries={cardMenuEntries(menu)} onClose={closeMenu} />}

      <Dialog
        open={confirmNew}
        title={t("session.newTitle")}
        onClose={() => setConfirmNew(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmNew(false)}>
              {t("session.keepCurrent")}
            </Button>
            <Button variant="primary" onClick={() => void startNewSession(false)}>
              {t("session.startFresh")}
            </Button>
          </>
        }
      >
        <p>
          {settings.retentionDays > 0
            ? t("session.freshBody", { count, days: settings.retentionDays })
            : t("session.freshBodyForever", { count })}
        </p>
        <p className="dialog__hint">{t("session.exportHint")}</p>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        title={t("delete.title", { count: pendingDelete?.length ?? 0 })}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {t("session.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {t("delete.confirm")}
            </Button>
          </>
        }
      >
        <p>{t("delete.body", { count: pendingDelete?.length ?? 0 })}</p>
      </Dialog>

      <DeleteGroupDialog
        group={groupToDelete}
        groups={session.groups}
        onCancel={() => setGroupToDelete(null)}
        onConfirm={(g, choice) => void removeGroup(g, choice)}
      />

      <CloseDialog />
    </div>
  );
}
