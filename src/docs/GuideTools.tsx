import { useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "../components/AppIcons";
import { PALETTE, PALETTE_COLUMNS, SIZE_RANGE } from "../components/palettes";
import { Pop } from "../components/Pop";
import { useT } from "../i18n";
import type { GuideStep } from "../ipc";
import { applyArea, areaOf, type Area } from "./areas";
import type { GuideDoc, StepBlock } from "./model";
import type { Tool } from "./StepPicture";

type Item = { tool: Tool; icon: AppIconName; label: Parameters<ReturnType<typeof useT>["t"]>[0]; key: string };

/** The tools in groups, with the letter that chooses each one while the step is being edited (like the screenshot tools). */
const DRAW: Item[] = [
  { tool: "arrow", icon: "arrow", label: "guide.tool.arrow", key: "A" },
  { tool: "line", icon: "line", label: "guide.tool.line", key: "L" },
  { tool: "rect", icon: "square", label: "guide.tool.rect", key: "R" },
  { tool: "ellipse", icon: "circle", label: "guide.tool.ellipse", key: "E" },
  { tool: "highlight", icon: "highlighter", label: "guide.tool.highlight", key: "H" },
  { tool: "pen", icon: "pen", label: "guide.tool.pen", key: "P" },
];
const TEXT: Item[] = [
  { tool: "text", icon: "text", label: "guide.tool.text", key: "T" },
  { tool: "callout", icon: "callout", label: "guide.tool.callout", key: "O" },
  { tool: "badge", icon: "badge", label: "guide.tool.badge", key: "N" },
];
const HIDE: Item[] = [
  { tool: "blur", icon: "blur", label: "guide.tool.blur", key: "B" },
  { tool: "pixelate", icon: "pixelate", label: "guide.tool.pixelate", key: "X" },
  { tool: "black", icon: "blackbox", label: "guide.tool.black", key: "K" },
];
const PICTURE: Item[] = [
  { tool: "crop", icon: "crop", label: "guide.tool.crop", key: "C" },
  { tool: "zoom", icon: "zoomarea", label: "guide.tool.zoom", key: "Z" },
  { tool: "expand", icon: "expand", label: "guide.tool.expand", key: "W" },
  { tool: "marker", icon: "marker", label: "guide.tool.marker", key: "M" },
];

export const TOOL_LETTERS: Record<string, Tool> = Object.fromEntries([...DRAW, ...TEXT, ...HIDE, ...PICTURE].map((i) => [i.key.toLowerCase(), i.tool]));

/** The icon toolbar of the selected step (one at a time), in the style of the screenshot annotator. */
export function GuideTools(props: {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  step: GuideStep;
  block: StepBlock;
  doc: Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault">;
  hasClick: boolean;
  canExpand: boolean;
  hasSelectedAnnotation: boolean;
  onDeleteSelected: () => void;
  patch: (c: Partial<StepBlock>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<"color" | "size" | "expand" | null>(null);
  const { tool, block, step } = props;
  const area = areaOf(step, block);
  // Letters choose the tools while the toolbar is there (not while typing in a field or a text editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest(".ProseMirror") || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key === "Escape") return props.setTool("none");
      const next = TOOL_LETTERS[e.key.toLowerCase()];
      if (!next || (next === "marker" && !props.hasClick) || (next === "expand" && !props.canExpand)) return;
      e.preventDefault();
      props.setTool(tool === next ? "none" : next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, props.hasClick, props.canExpand, props.setTool]);

  const btn = (i: Item) => {
    const off = (i.tool === "marker" && !props.hasClick) || (i.tool === "expand" && !props.canExpand);
    const label = i.tool === "expand" && !props.canExpand ? `${t(i.label)} – ${t("guide.noFullFrame")}` : t(i.label);
    return (
      <button key={i.tool} type="button" className="tool" aria-pressed={tool === i.tool} aria-disabled={off || undefined} aria-label={t(i.label)} title={t("tools.tip", { tool: label, key: i.key })} onClick={() => !off && props.setTool(tool === i.tool ? "none" : i.tool)}>
        <AppIcon name={i.icon} />
      </button>
    );
  };
  const sep = <span className="annobar__sep" aria-hidden="true" />;
  const areas: { value: Area; label: string }[] = [
    { value: "default", label: t("guide.areaDefault") },
    { value: "window", label: t("settings.docPictureWindow") },
    { value: "screen", label: t("settings.docPictureScreen") },
    ...(area === "custom" ? [{ value: "custom" as Area, label: t("guide.areaCustom") }] : []),
  ];

  return (
    <div className="annobar gtoolbar" role="toolbar" aria-label={t("guide.editPicture")} onPointerDown={(e) => e.stopPropagation()}>
      <div className="annobar__row">
        {DRAW.map(btn)}
        {sep}
        {TEXT.map(btn)}
        {sep}
        {HIDE.map(btn)}
        {sep}
        {PICTURE.map(btn)}
        {props.hasClick && (
          <button
            type="button"
            className="tool"
            aria-pressed={!!block.markerHidden}
            aria-label={block.markerHidden ? t("guide.markerShow") : t("guide.markerHide")}
            title={block.markerHidden ? t("guide.markerShow") : t("guide.markerHide")}
            onClick={() => props.patch({ markerHidden: !block.markerHidden })}
          >
            <AppIcon name="markeroff" />
          </button>
        )}
        {sep}
        <Pop
          open={open === "color"}
          onClose={() => setOpen(null)}
          label={t("tools.color")}
          trigger={
            <button type="button" className="tool" aria-expanded={open === "color"} aria-label={t("tools.color")} title={t("tools.color")} onClick={() => setOpen((o) => (o === "color" ? null : "color"))}>
              <span className="gtoolbar__swatch" style={{ background: props.color }} />
            </button>
          }
        >
          <div className="colorpanel">
            <div className="swatches" style={{ gridTemplateColumns: `repeat(${PALETTE_COLUMNS}, 1fr)` }}>
              {PALETTE.map((c) => (
                <button key={c} type="button" className={`swatch${c.toLowerCase() === props.color.toLowerCase() ? " swatch--on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => props.setColor(c)} />
              ))}
            </div>
            <label className="gtoolbar__custom">
              {t("guide.customColor")}
              <input type="color" value={props.color} onChange={(e) => props.setColor(e.target.value.toUpperCase())} />
            </label>
          </div>
        </Pop>
        <Pop
          open={open === "size"}
          onClose={() => setOpen(null)}
          label={t("tools.size")}
          trigger={
            <button type="button" className="tool" aria-expanded={open === "size"} aria-label={t("tools.size")} title={t("tools.size")} onClick={() => setOpen((o) => (o === "size" ? null : "size"))}>
              <span className="gtoolbar__stroke" style={{ height: Math.max(1, Math.min(10, props.width)) }} />
            </button>
          }
        >
          <div className="colorpanel">
            <label className="gtoolbar__range">
              {t("tools.size")}
              <input type="range" min={SIZE_RANGE.min} max={SIZE_RANGE.max} value={props.width} onChange={(e) => props.setWidth(Number(e.target.value))} />
              <span>{t("tools.sizeValue", { size: props.width })}</span>
            </label>
          </div>
        </Pop>
        <button type="button" className="tool" disabled={!props.hasSelectedAnnotation} aria-disabled={!props.hasSelectedAnnotation || undefined} aria-label={t("guide.deleteSelected")} title={t("guide.deleteSelected")} onClick={props.onDeleteSelected}>
          <AppIcon name="trash" />
        </button>
        <span className="annobar__end">
          <select className="gtoolbar__area" value={area} aria-label={t("guide.stepArea")} title={t("guide.stepArea")} onChange={(e) => applyArea(step, block, e.target.value as Area, props.patch)}>
            {areas.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {tool === "expand" && (
            <Pop
              open={open === "expand"}
              onClose={() => setOpen(null)}
              label={t("guide.tool.expand")}
              kind="menu"
              trigger={
                <button type="button" className="tool" aria-expanded={open === "expand"} onClick={() => setOpen((o) => (o === "expand" ? null : "expand"))} title={t("guide.expandQuick")} aria-label={t("guide.expandQuick")}>
                  <AppIcon name="chevron" size={14} />
                </button>
              }
            >
              <div className="gtoolbar__quick">
                {([["grow25", "+25%"], ["grow50", "+50%"], ["window", t("settings.docPictureWindow")], ["screen", t("settings.docPictureScreen")]] as const).map(([k, label]) => (
                  <button key={k} type="button" className="gtools__btn" onClick={() => (applyArea(step, block, k, props.patch), setOpen(null))}>
                    {label}
                  </button>
                ))}
              </div>
            </Pop>
          )}
          <button type="button" className="tool" disabled={!props.canUndo} aria-label={t("docs.undo")} title={`${t("docs.undo")} (Ctrl+Z)`} onClick={props.undo}>
            <AppIcon name="undo" />
          </button>
          <button type="button" className="tool" disabled={!props.canRedo} aria-label={t("guide.redo")} title={`${t("guide.redo")} (Ctrl+Y)`} onClick={props.redo}>
            <AppIcon name="redo" />
          </button>
        </span>
      </div>
    </div>
  );
}
