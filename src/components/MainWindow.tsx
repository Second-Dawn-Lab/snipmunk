import { useSettings } from "@seconddawn/settings";
import { Button, Dialog, Icon } from "@seconddawn/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { zoomIn, zoomOut } from "../sessionModel";
import { useT } from "../i18n";
import { ipc, type CmdError, type Group, type Session } from "../ipc";
import {
  activeAfterDeleting,
  deleteTargets,
  groupOrFirst,
  pruneSelection,
  selectAll,
  sortCaptures,
  toggled,
  totalCaptures,
  validActive,
  type SortMode,
} from "../sessionModel";
import { sessionStore, useSession } from "../sessionStore";
import { settingsStore } from "../settings/store";
import type { CopyMode } from "../settings/defaults";
import { BottomBar } from "./BottomBar";
import { CaptureList } from "./CaptureList";
import { CloseDialog } from "./CloseDialog";
import { GroupTabs } from "./GroupTabs";
import { HotkeyNotice } from "./HotkeyNotice";
import { Preview, type ZoomMode } from "./Preview";
import { TitleBar } from "./TitleBar";
import { TopBar } from "./TopBar";

function messageOf(e: unknown): string {
  const err = e as Partial<CmdError> | undefined;
  return err?.message ?? String(e);
}

/** The one page of Snipmunk: title bar, header, the capture list on the left, the preview on the right. */
export function MainWindow() {
  const { t } = useT();
  const { settings, patch } = useSettings(settingsStore);
  const session = useSession();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("newest");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [copyMode, setCopyMode] = useState<CopyMode>(settings.defaultCopyMode);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [effectiveZoom, setEffectiveZoom] = useState(1);

  // The setting is the default; the dropdown changes the mode for now.
  useEffect(() => setCopyMode(settings.defaultCopyMode), [settings.defaultCopyMode]);

  const group = session ? groupOrFirst(session, groupId) : null;
  const shown = useMemo(() => (group ? sortCaptures(group.captures, sort) : []), [group, sort]);
  const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
  const currentId = validActive(shownIds, activeId);
  const capture = shown.find((c) => c.id === currentId) ?? null;

  // Selections of captures that were deleted (here or in another window) go away.
  useEffect(() => {
    if (session) setSelected((s) => pruneSelection(s, session));
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

  // New captures land in the group tab that is shown.
  const shownGroupId = session && group ? group.id : null;
  useEffect(() => {
    void ipc.setActiveGroup(shownGroupId);
  }, [shownGroupId]);

  // A capture was taken (by the shortcut, the button or the tray): show it, in its group.
  useEffect(() => {
    const added = ipc.onCaptureAdded(({ captureId, groupId: gid }) => {
      setGroupId(gid);
      setActiveId(captureId);
      setSelected(new Set());
    });
    const failed = ipc.onCaptureError((message) => setError(message));
    return () => {
      void added.then((fn) => fn());
      void failed.then((fn) => fn());
    };
  }, []);

  // A different capture starts fitted.
  useEffect(() => setZoomMode("fit"), [currentId]);

  // Deleting always asks first: Del and the trash icons only choose what would be deleted.
  const askDelete = useCallback(
    (clicked?: string) => {
      if (!session) return;
      const ids = deleteTargets(session, selected, currentId, clicked);
      if (ids.length > 0) setPendingDelete(ids);
    },
    [session, selected, currentId],
  );

  const confirmDelete = async () => {
    const ids = pendingDelete ?? [];
    setPendingDelete(null);
    const gone = new Set(ids);
    setActiveId(activeAfterDeleting(shownIds, gone, currentId));
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

  // Keyboard: Del deletes, Ctrl+0 / Ctrl++ / Ctrl+- / Ctrl+1 zoom the preview. Not while the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) &&
        !(target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "range"));
      if (typing || pendingDelete) return;
      if (e.key === "Delete") {
        e.preventDefault();
        askDelete();
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
  }, [askDelete, capture, pendingDelete, zoom]);

  if (!session || !group) return null;

  const count = totalCaptures(session);

  const startNewSession = async (discard: boolean) => {
    setConfirmNew(false);
    const next = await run(ipc.newSession(discard));
    if (next) {
      setGroupId(null);
      setActiveId(null);
      setSelected(new Set());
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
    const next = await run(ipc.createGroup());
    if (next) setGroupId(next.groups[next.groups.length - 1].id);
  };

  const askDeleteGroup = (g: Group) => {
    if (g.captures.length === 0) void removeGroup(g.id);
    else setGroupToDelete(g);
  };

  const removeGroup = async (id: string) => {
    setGroupToDelete(null);
    if (id === group.id) setGroupId(null);
    await run(ipc.deleteGroup(id));
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
      />

      <HotkeyNotice onOpenSettings={() => void ipc.openSettings()} />

      {error && (
        <div className="errorbar" role="alert">
          <Icon name="alert" size={16} />
          <span>{t("session.error", { message: error })}</span>
          <button type="button" className="errorbar__close" onClick={() => setError(null)} aria-label={t("session.dismiss")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <main className="panels">
        <div className="panel panel--left">
          <GroupTabs
            groups={session.groups}
            activeId={group.id}
            onSelect={setGroupId}
            onAdd={() => void addGroup()}
            onRename={(id, name) => void run(ipc.renameGroup(id, name))}
            onDelete={askDeleteGroup}
          />
          <CaptureList
            session={session}
            captures={shown}
            activeId={currentId}
            selected={selected}
            sort={sort}
            hotkey={settings.captureHotkey}
            onSort={setSort}
            onActivate={setActiveId}
            onToggle={(id) => setSelected((s) => toggled(s, id))}
            onDelete={askDelete}
            onRename={(id, name) => void run(ipc.renameCapture(id, name))}
            onSelectAll={() => setSelected(selectAll(shown))}
            onClearAll={() => setSelected(new Set())}
          />
        </div>
        <div className="panel panel--right">
          <Preview
            session={session}
            capture={capture}
            zoomMode={zoomMode}
            onZoom={setEffectiveZoom}
            settings={settings}
            onPatch={(change) => void patch(change)}
          />
        </div>
      </main>

      <BottomBar selectedCount={selected.size} copyMode={copyMode} onCopyMode={setCopyMode} />

      <Dialog
        open={confirmNew}
        title={t("session.newTitle")}
        onClose={() => setConfirmNew(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmNew(false)}>
              {t("session.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void startNewSession(true)}>
              {t("session.discard")}
            </Button>
            <Button variant="primary" onClick={() => void startNewSession(false)}>
              {t("session.keep")}
            </Button>
          </>
        }
      >
        <p>
          {settings.retentionDays > 0
            ? t("session.newBody", { count, days: settings.retentionDays })
            : t("session.newBodyForever", { count })}
        </p>
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

      <Dialog
        open={groupToDelete !== null}
        title={t("groups.deleteTitle")}
        onClose={() => setGroupToDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupToDelete(null)}>
              {t("session.cancel")}
            </Button>
            <Button variant="danger" onClick={() => groupToDelete && void removeGroup(groupToDelete.id)}>
              {t("groups.deleteConfirm")}
            </Button>
          </>
        }
      >
        {groupToDelete && (
          <p>
            {t("groups.deleteBody", { name: groupToDelete.name, count: groupToDelete.captures.length })}
          </p>
        )}
      </Dialog>

      <CloseDialog />
    </div>
  );
}
