import { Icon } from "@seconddawn/ui";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { contentHeight, dropSlot, gridSpec, itemPosition, pageRows, scrollToShow, slotMark, visibleRange, type GalleryView } from "../gallery/layout";
import { beginPointerDrag, type DragPoint } from "../gallery/pointerDrag";
import { autoScrollDelta, draggedIds, hitTest, insideRect, isNoopMove } from "../gallery/reorder";
import { navStep, type ClickMods } from "../gallery/selection";
import { useT } from "../i18n";
import { thumbUrl, type Capture, type Session } from "../ipc";
import { formatTime } from "../sessionModel";
import { RenameInput } from "./GroupTabs";

/** What the list asks the window to do. The object never changes; its functions always run the latest code. */
export interface GalleryActions {
  select(id: string, mods: ClickMods): void;
  toggle(id: string): void;
  /** An arrow key, Page Up / Down, Home or End. */
  navigate(step: number | "first" | "last", extend: boolean): void;
  contextMenu(id: string, x: number, y: number): void;
  rename(id: string): void;
  /** `null` cancels. */
  commitRename(id: string, name: string | null): void;
  trash(id: string): void;
  /** Captures were dropped at a place of the list. */
  reorder(ids: string[], slot: number): void;
  /** Captures were dropped on a group tab. */
  moveToGroup(ids: string[], groupId: string): void;
  /** The group tab a drag is over (to highlight it), or `null`. */
  dragTarget(groupId: string | null): void;
  /** A card drag began: render these captures into temp files now, so a native drag out can start at once. */
  prepareDrag(ids: string[]): void;
  /** The pointer left the window during a card drag: start the native drag of these captures (files) into other apps. */
  dragOut(ids: string[]): void;
}

type DragTarget = { kind: "slot"; slot: number } | { kind: "tab"; groupId: string };

const PAD = 8; // the horizontal padding of .gallery, see app.css

/**
 * The captures of a group as a list or a grid. Only the items that are on screen (and a few rows around them) exist,
 * so 300 or 3000 captures cost the same; items are memoised, so a selection change renders only the cards that changed.
 */
export function Gallery(props: {
  session: Session;
  groupId: string;
  captures: Capture[];
  view: GalleryView;
  activeId: string | null;
  selected: ReadonlySet<string>;
  renamingId: string | null;
  actions: GalleryActions;
  label: string;
  rtl: boolean;
}) {
  const { captures, view, activeId, selected, renamingId, actions, rtl } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [drag, setDrag] = useState<{ ids: string[]; target: DragTarget | null } | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const pointer = useRef<DragPoint | null>(null);
  const targetRef = useRef<DragTarget | null>(null);

  const latest = useRef(props);
  latest.current = props;

  // Size of the list (without padding and scroll bar).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth - 2 * PAD, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spec = useMemo(() => gridSpec(view, box.width), [view, box.width]);
  const specRef = useRef(spec);
  specRef.current = spec;

  const count = captures.length;
  const range = visibleRange(scrollTop, box.height, count, spec);
  const order = useMemo(() => captures.map((c) => c.id), [captures]);
  const byId = useMemo(() => new Map(captures.map((c) => [c.id, c])), [captures]);

  // Scrolling: one state update per frame.
  const frame = useRef(0);
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (scroller.current) setScrollTop(scroller.current.scrollTop);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The capture on show stays visible: a key moved it, a capture was added, or the view changed its size.
  const activeIndex = activeId === null ? -1 : order.indexOf(activeId);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || activeIndex < 0 || box.height <= 0) return;
    const next = scrollToShow(activeIndex, el.scrollTop, box.height, spec);
    if (next !== el.scrollTop) {
      el.scrollTop = next;
      setScrollTop(next);
    }
    // Only when the capture or the layout changes, not on every scroll.
  }, [activeIndex, spec.rowHeight, spec.columns, box.height]);

  // --- keyboard ---------------------------------------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLInputElement;
    if (renamingId !== null || e.ctrlKey || e.altKey || e.metaKey) return;
    if (target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && target.type === "text")) return;
    // Enter shows the capture on show (and selects only it).
    if (e.key === "Enter" && target === e.currentTarget) {
      e.preventDefault();
      actions.navigate(0, false);
      return;
    }
    // The Menu key (or Shift+F10) opens the menu of the capture on show, next to it.
    if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && activeId !== null && activeIndex >= 0 && space.current) {
      e.preventDefault();
      const r = space.current.getBoundingClientRect();
      const pos = itemPosition(activeIndex, spec);
      actions.contextMenu(activeId, rtl ? r.right - pos.start - 24 : r.left + pos.start + 24, r.top + pos.top + 24);
      return;
    }
    const step = navStep(e.key, { columns: spec.columns, pageRows: pageRows(box.height, spec), rtl });
    if (step !== null) {
      e.preventDefault();
      actions.navigate(step, e.shiftKey);
    }
  };

  // --- dragging captures --------------------------------------------------------------------------------------------
  const updateTarget = useCallback(() => {
    const p = pointer.current;
    const sc = scroller.current;
    const sp = space.current;
    if (!p || !sc || !sp) return;
    const L = latest.current;
    const tabs = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-id]")).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.tabId as string, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const tabId = hitTest(tabs, p.x, p.y);
    let target: DragTarget | null = null;
    if (tabId !== null) {
      if (tabId !== L.groupId) target = { kind: "tab", groupId: tabId };
    } else if (insideRect(sc.getBoundingClientRect(), p.x, p.y)) {
      const r = sp.getBoundingClientRect();
      const x = L.rtl ? r.right - p.x : p.x - r.left;
      target = { kind: "slot", slot: dropSlot(x, p.y - r.top, L.captures.length, specRef.current) };
    }
    const prev = targetRef.current;
    const same =
      prev === target ||
      (prev && target && prev.kind === target.kind && (prev.kind === "slot" ? prev.slot === (target as { slot: number }).slot : prev.groupId === (target as { groupId: string }).groupId));
    if (same) return;
    targetRef.current = target;
    setDrag((d) => (d ? { ...d, target } : d));
    L.actions.dragTarget(target?.kind === "tab" ? target.groupId : null);
  }, []);

  const autoScroll = useRef(0);
  const tick = useCallback(() => {
    const p = pointer.current;
    const sc = scroller.current;
    if (p && sc) {
      const sr = sc.getBoundingClientRect();
      if (p.x >= sr.left && p.x <= sr.right) {
        const dy = autoScrollDelta(p.y, sr.top, sr.bottom);
        if (dy !== 0) {
          sc.scrollTop += dy;
          updateTarget();
        }
      }
      // Dragging along the group tabs scrolls them.
      const strip = document.querySelector<HTMLElement>("[data-tab-strip]");
      if (strip) {
        const r = strip.getBoundingClientRect();
        if (p.y >= r.top - 12 && p.y <= r.bottom + 12) strip.scrollLeft += autoScrollDelta(p.x, r.left, r.right, 40, 14);
      }
    }
    autoScroll.current = requestAnimationFrame(tick);
  }, [updateTarget]);

  const moveGhost = (p: DragPoint) => {
    if (ghost.current) ghost.current.style.transform = `translate(${p.x + 14}px, ${p.y + 14}px)`;
  };
  useLayoutEffect(() => {
    if (drag && pointer.current) moveGhost(pointer.current);
  }, [drag === null]);

  const onCardPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.button !== 0 || !e.isPrimary || (e.target as HTMLElement).closest("input, button, textarea")) return;
      const L = latest.current;
      const ids = draggedIds(
        L.captures.map((c) => c.id),
        L.selected,
        id,
      );
      if (ids.length === 0) return;
      targetRef.current = null;
      let leftWindow = false;
      const cancelDrag = beginPointerDrag(
        { x: e.clientX, y: e.clientY },
        {
          onStart: (p) => {
            pointer.current = p;
            setDrag({ ids, target: null });
            latest.current.actions.prepareDrag(ids);
            autoScroll.current = requestAnimationFrame(tick);
            updateTarget();
          },
          onMove: (p) => {
            pointer.current = p;
            if (p.outside && !leftWindow) {
              // Out of the window: the internal drag ends and the system takes over (the files go to the app under the pointer).
              leftWindow = true;
              cancelDrag();
              latest.current.actions.dragOut(ids);
              return;
            }
            moveGhost(p);
            updateTarget();
          },
          onEnd: (_p, completed) => {
            cancelAnimationFrame(autoScroll.current);
            const target = targetRef.current;
            targetRef.current = null;
            pointer.current = null;
            setDrag(null);
            latest.current.actions.dragTarget(null);
            if (!completed || !target) return;
            if (target.kind === "slot") latest.current.actions.reorder(ids, target.slot);
            else latest.current.actions.moveToGroup(ids, target.groupId);
          },
        },
      );
    },
    [tick, updateTarget],
  );
  useEffect(() => () => cancelAnimationFrame(autoScroll.current), []);

  // --- render ------------------------------------------------------------------------------------------------------
  const items: ReactNode[] = [];
  for (let i = range.start; i < range.end; i++) {
    const c = captures[i];
    const pos = itemPosition(i, spec);
    items.push(
      <Card
        key={c.id}
        capture={c}
        thumb={thumbUrl(props.session, c)}
        view={view}
        top={pos.top}
        start={pos.start}
        width={spec.itemWidth}
        height={spec.itemHeight}
        active={c.id === activeId}
        checked={selected.has(c.id)}
        trashCount={selected.has(c.id) ? selected.size : 0}
        dragging={drag !== null && drag.ids.includes(c.id)}
        renaming={c.id === renamingId}
        actions={actions}
        onPointerDown={onCardPointerDown}
      />,
    );
  }

  const mark =
    drag?.target?.kind === "slot" && !isNoopMove(order, drag.ids, drag.target.slot)
      ? slotMark(drag.target.slot, count, spec)
      : null;
  const markStyle: CSSProperties | undefined = mark
    ? mark.direction === "horizontal"
      ? { top: mark.top - 1, insetInlineStart: 0, width: mark.length, height: 3 }
      : { top: mark.top, insetInlineStart: mark.start - 1, width: 3, height: mark.length }
    : undefined;

  return (
    <div
      ref={scroller}
      className={`gallery gallery--${view}`}
      role="listbox"
      aria-label={props.label}
      aria-multiselectable="true"
      aria-activedescendant={activeId ? `cap-${activeId}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div ref={space} className="gallery__space" style={{ height: contentHeight(count, spec) }}>
        {items}
        {markStyle && <div className="dropmark" style={markStyle} aria-hidden="true" />}
      </div>
      {drag && (
        <div ref={ghost} className="draghost" aria-hidden="true">
          {drag.ids.slice(0, 3).map((id, i) => {
            const c = byId.get(id);
            return c ? (
              <img key={id} className="draghost__img" style={{ insetInlineStart: i * 6, top: i * 6 }} src={thumbUrl(props.session, c)} alt="" draggable={false} />
            ) : null;
          })}
          {drag.ids.length > 1 && <span className="draghost__count">{drag.ids.length}</span>}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  capture: Capture;
  thumb: string;
  view: GalleryView;
  top: number;
  start: number;
  width: number;
  height: number;
  active: boolean;
  checked: boolean;
  /** The size of the selection when this card is part of it (its trash icon deletes all of them), else 0. */
  trashCount: number;
  dragging: boolean;
  renaming: boolean;
  actions: GalleryActions;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

const Card = memo(function Card(p: CardProps) {
  const { t, locale } = useT();
  const { capture: c, actions } = p;
  const tile = p.view !== "list";
  const trashLabel =
    p.trashCount > 1 ? t("captures.deleteSelected", { count: p.trashCount }) : t("captures.delete", { name: c.name });
  const cls =
    `card card--${p.view}` +
    (p.active ? " card--active" : "") +
    (p.checked ? " card--checked" : "") +
    (p.dragging ? " card--dragging" : "");

  return (
    <div
      id={`cap-${c.id}`}
      role="option"
      aria-selected={p.checked}
      className={cls}
      style={{ top: p.top, insetInlineStart: p.start, width: p.width, height: p.height }}
      onClick={(e) => actions.select(c.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
      onContextMenu={(e) => {
        e.preventDefault();
        actions.contextMenu(c.id, e.clientX, e.clientY);
      }}
      onPointerDown={(e) => p.onPointerDown(e, c.id)}
      onDragStart={(e) => e.preventDefault()}
    >
      <img className="card__thumb" src={p.thumb} alt="" decoding="async" draggable={false} />
      <div className="card__text">
        {p.renaming ? (
          <RenameInput
            className="card__rename"
            initial={c.name}
            label={t("captures.rename")}
            emptyTip={t("rename.empty")}
            onDone={(name) => actions.commitRename(c.id, name)}
          />
        ) : (
          <div
            className="card__name"
            title={c.name}
            onDoubleClick={(e) => {
              e.stopPropagation();
              actions.rename(c.id);
            }}
          >
            {c.name}
          </div>
        )}
        {(p.view === "list" || p.view === "large") && <div className="card__time">{formatTime(c.createdAt, locale)}</div>}
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={p.checked}
        aria-label={t("captures.select", { name: c.name })}
        onClick={(e) => e.stopPropagation()}
        onChange={() => actions.toggle(c.id)}
      />
      <button
        type="button"
        className="card__trash"
        aria-label={trashLabel}
        title={trashLabel}
        onClick={(e) => {
          e.stopPropagation();
          actions.trash(c.id);
        }}
      >
        <Icon name="trash" size={tile ? 14 : 15} />
      </button>
    </div>
  );
});
