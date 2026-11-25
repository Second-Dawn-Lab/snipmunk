// The tabbed panel beside the guide, as docked panels work in a drawing program: "Guide", "Step" and "Steps" tabs. It folds to a
// narrow strip of tabs, and its width is changed by dragging its inner edge (both are remembered).

import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { AppIcon } from "../../components/AppIcons";
import { useT } from "../../i18n";

export const PANEL_TABS = ["guide", "step", "steps"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export const PANEL_MIN = 240;
export const PANEL_MAX = 560;
export const clampPanel = (w: number): number => Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, Number.isFinite(w) ? w : 300)));

/** The width after dragging the inner edge from `from` to `to` (screen x): the panel stands at the end of the line, so in a
 * left-to-right window it grows to the left, in a right-to-left one to the right. */
export const draggedWidth = (width: number, from: number, to: number, rtl: boolean): number => clampPanel(width + (rtl ? to - from : from - to));

export function SidePanel(props: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  collapsed: boolean;
  width: number;
  onLayout: (change: { collapsed?: boolean; width?: number }) => void;
  children: Record<PanelTab, ReactNode>;
}) {
  const { t } = useT();
  const [dragging, setDragging] = useState<number | null>(null);
  const aside = useRef<HTMLElement>(null);
  const width = dragging ?? clampPanel(props.width);
  const rtl = () => document.documentElement.dir === "rtl";
  const label: Record<PanelTab, string> = { guide: t("guide.header"), step: t("panel.step"), steps: t("panel.tree") };
  const startDrag = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const x0 = e.clientX;
    let last = width;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      last = draggedWidth(clampPanel(props.width), x0, ev.clientX, rtl());
      setDragging(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragging(null);
      props.onLayout({ width: last });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const resizeKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    // The arrow that points away from the panel makes it wider.
    const wider = (e.key === "ArrowLeft") !== rtl();
    props.onLayout({ width: clampPanel(width + (wider ? 16 : -16)) });
  };
  const tabKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const i = PANEL_TABS.indexOf(props.tab);
    const next = PANEL_TABS[(i + (rtl() && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? -step : step) + PANEL_TABS.length) % PANEL_TABS.length];
    props.onTab(next);
    aside.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };
  const tabs = PANEL_TABS.map((tab) => (
    <button
      key={tab}
      type="button"
      role="tab"
      data-tab={tab}
      id={`gpanel-tab-${tab}`}
      aria-selected={!props.collapsed && props.tab === tab}
      aria-controls={`gpanel-${tab}`}
      tabIndex={props.tab === tab ? 0 : -1}
      className="gpanel__tab"
      onClick={() => {
        props.onTab(tab);
        if (props.collapsed) props.onLayout({ collapsed: false });
      }}
      onKeyDown={tabKey}
    >
      {label[tab]}
    </button>
  ));
  const fold = (
    <button type="button" className="gpanel__fold" aria-expanded={!props.collapsed} aria-label={t(props.collapsed ? "panel.open" : "panel.close")} title={t(props.collapsed ? "panel.open" : "panel.close")} onClick={() => props.onLayout({ collapsed: !props.collapsed })}>
      <AppIcon name="chevron" size={13} />
    </button>
  );
  return (
    <aside ref={aside} className={`gpanel${props.collapsed ? " gpanel--closed" : ""}`} style={props.collapsed ? undefined : { width }} aria-label={t("panel.label")}>
      {!props.collapsed && <div role="separator" aria-orientation="vertical" aria-label={t("panel.resize")} aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={width} tabIndex={0} className={`gpanel__edge${dragging !== null ? " gpanel__edge--on" : ""}`} onPointerDown={startDrag} onKeyDown={resizeKey} />}
      <div className="gpanel__bar">
        {fold}
        <div className="gpanel__tabs" role="tablist" aria-label={t("panel.label")} aria-orientation={props.collapsed ? "vertical" : "horizontal"}>
          {tabs}
        </div>
      </div>
      {/* All three stay in place when hidden, so an opened section or a scrolled list is as it was. */}
      {PANEL_TABS.map((tab) => (
        <div key={tab} id={`gpanel-${tab}`} role="tabpanel" aria-labelledby={`gpanel-tab-${tab}`} className="gpanel__body" hidden={props.collapsed || props.tab !== tab}>
          {props.children[tab]}
        </div>
      ))}
    </aside>
  );
}
