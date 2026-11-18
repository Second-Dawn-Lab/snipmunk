import { Icon } from "@seconddawn/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fadeEdges, type FadeState } from "../gallery/tabsOverflow";
import { beginPointerDrag } from "../gallery/pointerDrag";
import { moveOne, tabSlot } from "../gallery/reorder";
import { canDeleteGroup, GROUP_COLORS, GROUP_EMOJIS, isGroupColor } from "../groupRules";
import { useT } from "../i18n";
import type { Group } from "../ipc";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { MenuItem } from "./MenuItem";
import { Pop } from "./Pop";

const NO_FADE: FadeState = { start: false, end: false, overflow: false };

/**
 * The tabs of the groups. Double-click or F2 renames, right-click opens the menu (rename, colour, emoji, delete), a tab
 * can be dragged to a new place, and tabs that do not fit scroll, with fading edges and a list of all groups.
 * `dropTargetId` is the tab a drag of captures or files is over.
 */
export function GroupTabs(props: {
  groups: Group[];
  activeId: string;
  dropTargetId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (group: Group) => void;
  onReorder: (ids: string[]) => void;
  onColor: (id: string, color: string | null) => void;
  onEmoji: (id: string, emoji: string | null) => void;
}) {
  const { t } = useT();
  const { groups } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [fade, setFade] = useState<FadeState>(NO_FADE);
  const [dragging, setDragging] = useState<{ id: string; mark: { x: number; top: number; height: number } | null } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const canDelete = canDeleteGroup(groups);

  // Fade edges and the list button follow the size and the scroll position of the strip.
  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const next = fadeEdges({ scrollStart: el.scrollLeft, client: el.clientWidth, scroll: el.scrollWidth });
    setFade((f) => (f.start === next.start && f.end === next.end && f.overflow === next.overflow ? f : next));
  }, []);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, groups]);

  // The mouse wheel scrolls the tabs sideways.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The shown tab is scrolled into view (also when it is chosen from the list).
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [props.activeId, groups.length]);

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || !e.isPrimary || groups.length < 2 || (e.target as HTMLElement).closest("button, input")) return;
    const rtl = document.documentElement.dir === "rtl";
    const slotAt = (x: number) => {
      const rects = tabRects();
      const slot = tabSlot(rects, x, rtl);
      const edge = slot < rects.length ? rects[slot] : rects[rects.length - 1];
      const at = slot < rects.length ? (rtl ? edge.right : edge.left) : rtl ? edge.left : edge.right;
      return { slot, mark: { x: at, top: edge.top, height: edge.bottom - edge.top } };
    };
    beginPointerDrag(
      { x: e.clientX, y: e.clientY },
      {
        onStart: () => setDragging({ id, mark: null }),
        onMove: (p) => setDragging({ id, mark: slotAt(p.x).mark }),
        onEnd: (p, completed) => {
          setDragging(null);
          if (!completed) return;
          const ids = groups.map((g) => g.id);
          const next = moveOne(ids, id, slotAt(p.x).slot);
          if (next.some((v, i) => v !== ids[i])) props.onReorder(next);
        },
      },
    );
  };

  const target = menu ? groups.find((g) => g.id === menu.id) : null;
  const entries: MenuEntry[] = target
    ? [
        { kind: "item", id: "rename", label: t("groups.rename"), icon: "rename", onSelect: () => setEditing(target.id) },
        {
          kind: "sub",
          id: "color",
          label: t("groupmenu.colour"),
          children: (
            <div className="swatches" role="group" aria-label={t("groupmenu.colour")}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!target.color}
                className="swatch swatch--none"
                title={t("groupmenu.none")}
                aria-label={t("groupmenu.none")}
                onClick={() => {
                  setMenu(null);
                  props.onColor(target.id, null);
                }}
              >
                <Icon name="close" size={12} />
              </button>
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemradio"
                  aria-checked={target.color === c}
                  className={`swatch gc-${c}${target.color === c ? " swatch--on" : ""}`}
                  title={t(`color.${c}`)}
                  aria-label={t(`color.${c}`)}
                  onClick={() => {
                    setMenu(null);
                    props.onColor(target.id, c);
                  }}
                />
              ))}
            </div>
          ),
        },
        {
          kind: "sub",
          id: "emoji",
          label: t("groupmenu.emoji"),
          children: (
            <div className="emojis" role="group" aria-label={t("groupmenu.emoji")}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!target.emoji}
                className="emojis__item emojis__none"
                title={t("groupmenu.none")}
                aria-label={t("groupmenu.none")}
                onClick={() => {
                  setMenu(null);
                  props.onEmoji(target.id, null);
                }}
              >
                <Icon name="close" size={13} />
              </button>
              {GROUP_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  role="menuitemradio"
                  aria-checked={target.emoji === em}
                  className={`emojis__item${target.emoji === em ? " emojis__item--on" : ""}`}
                  aria-label={em}
                  onClick={() => {
                    setMenu(null);
                    props.onEmoji(target.id, em);
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          ),
        },
        { kind: "separator", id: "sep" },
        {
          kind: "item",
          id: "delete",
          label: t("groups.delete"),
          icon: "trash",
          danger: true,
          disabled: !canDelete,
          tip: canDelete ? undefined : t("groupmenu.lastTip"),
          onSelect: () => props.onDelete(target),
        },
      ]
    : [];

  return (
    <div className="grouptabs">
      <div className="grouptabs__scroll">
        <div ref={strip} data-tab-strip className="grouptabs__strip" role="tablist" aria-label={t("groups.label")} onScroll={measure}>
          {groups.map((g) =>
            editing === g.id ? (
              <RenameInput
                key={g.id}
                initial={g.name}
                label={t("groups.rename")}
                emptyTip={t("rename.empty")}
                onDone={(name) => {
                  setEditing(null);
                  if (name && name !== g.name) props.onRename(g.id, name);
                }}
              />
            ) : (
              <div
                key={g.id}
                role="tab"
                data-tab-id={g.id}
                aria-selected={g.id === props.activeId}
                tabIndex={0}
                className={
                  "grouptab" +
                  (g.id === props.activeId ? " grouptab--active" : "") +
                  (isGroupColor(g.color) ? ` grouptab--colored gc-${g.color}` : "") +
                  (props.dropTargetId === g.id ? " grouptab--drop" : "") +
                  (dragging?.id === g.id ? " grouptab--dragging" : "")
                }
                title={t("groups.rename")}
                onClick={() => props.onSelect(g.id)}
                onDoubleClick={() => setEditing(g.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: g.id, x: e.clientX, y: e.clientY });
                }}
                onPointerDown={(e) => startDrag(e, g.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") props.onSelect(g.id);
                  if (e.key === "F2") setEditing(g.id);
                  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: g.id, x: r.left + r.width / 2, y: r.bottom });
                  }
                }}
              >
                {g.emoji && (
                  <span className="grouptab__emoji" aria-hidden="true">
                    {g.emoji}
                  </span>
                )}
                <span className="grouptab__name">{g.name}</span>
                {canDelete && (
                  <button
                    type="button"
                    className="grouptab__close"
                    aria-label={t("groups.delete")}
                    title={t("groups.delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDelete(g);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            ),
          )}
        </div>
        {fade.start && <span className="grouptabs__fade grouptabs__fade--start" aria-hidden="true" />}
        {fade.end && <span className="grouptabs__fade grouptabs__fade--end" aria-hidden="true" />}
      </div>

      <button type="button" className="grouptab grouptab--add" aria-label={t("groups.add")} title={t("groups.add")} onClick={props.onAdd}>
        <Icon name="plus" size={14} />
      </button>

      {fade.overflow && (
        <Pop
          open={listOpen}
          onClose={() => setListOpen(false)}
          kind="menu"
          align="end"
          label={t("groups.list")}
          trigger={
            <button
              type="button"
              className="grouptab grouptab--add"
              aria-haspopup="menu"
              aria-expanded={listOpen}
              aria-label={t("groups.list")}
              title={t("groups.list")}
              onClick={() => setListOpen((o) => !o)}
            >
              <Icon name="chevron" size={14} />
            </button>
          }
        >
          <div className="grouplist">
            {groups.map((g) => (
              <MenuItem
                key={g.id}
                role="menuitemradio"
                checked={g.id === props.activeId}
                label={`${g.emoji ? `${g.emoji} ` : ""}${g.name}`}
                hint={String(g.captures.length)}
                onSelect={() => {
                  setListOpen(false);
                  props.onSelect(g.id);
                }}
              />
            ))}
          </div>
        </Pop>
      )}

      {dragging?.mark && (
        <span
          className="tabmark"
          style={{ left: dragging.mark.x - 1, top: dragging.mark.top, height: dragging.mark.height }}
          aria-hidden="true"
        />
      )}

      {menu && target && <ContextMenu x={menu.x} y={menu.y} label={target.name} entries={entries} onClose={() => setMenu(null)} />}
    </div>
  );
}

function tabRects() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-tab-id]")).map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

/**
 * A text box that selects its content, saves on Enter or when it loses the focus, and cancels on Esc. An empty name is
 * not accepted: Enter keeps the box open and says so; leaving the box empty cancels.
 */
export function RenameInput(props: {
  initial: string;
  label: string;
  /** Shown when Enter is pressed with nothing typed. */
  emptyTip?: string;
  /** The new name, or `null` when cancelled. */
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(props.initial);
  const [invalid, setInvalid] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    props.onDone(name);
  };

  return (
    <input
      ref={ref}
      className={`${props.className ?? "grouptab grouptab--input"}${invalid ? " is-invalid" : ""}`}
      aria-label={props.label}
      aria-invalid={invalid || undefined}
      title={invalid ? props.emptyTip : undefined}
      value={value}
      maxLength={80}
      onChange={(e) => {
        setValue(e.target.value);
        setInvalid(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          const name = value.trim();
          if (name) finish(name);
          else setInvalid(true);
        }
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}
