// The tools of a step picture as a panel of square buttons in the "Step" tab (like the tool panel of a drawing program), their
// letter keys, and the colour, size and "Delete selected" controls under them.

import { useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "../../components/AppIcons";
import { PALETTE, PALETTE_COLUMNS, SIZE_RANGE } from "../../components/palettes";
import { Pop } from "../../components/Pop";
import { useT } from "../../i18n";
import type { Tool } from "../StepPicture";

type Words = Parameters<ReturnType<typeof useT>["t"]>[0];
type Item = { tool: Exclude<Tool, "none">; icon: AppIconName; label: Words; key: string };

/** The tools in groups, with the letter that chooses each one for the selected step (like the screenshot tools). */
export const TOOL_GROUPS: { label: Words; items: Item[] }[] = [
  {
    label: "panel.group.draw",
    items: [
      { tool: "arrow", icon: "arrow", label: "guide.tool.arrow", key: "A" },
      { tool: "line", icon: "line", label: "guide.tool.line", key: "L" },
      { tool: "rect", icon: "square", label: "guide.tool.rect", key: "R" },
      { tool: "ellipse", icon: "circle", label: "guide.tool.ellipse", key: "E" },
      { tool: "highlight", icon: "highlighter", label: "guide.tool.highlight", key: "H" },
      { tool: "pen", icon: "pen", label: "guide.tool.pen", key: "P" },
    ],
  },
  {
    label: "panel.group.text",
    items: [
      { tool: "text", icon: "text", label: "guide.tool.text", key: "T" },
      { tool: "callout", icon: "callout", label: "guide.tool.callout", key: "O" },
      { tool: "badge", icon: "badge", label: "guide.tool.badge", key: "N" },
    ],
  },
  {
    label: "panel.group.hide",
    items: [
      { tool: "blur", icon: "blur", label: "guide.tool.blur", key: "B" },
      { tool: "pixelate", icon: "pixelate", label: "guide.tool.pixelate", key: "X" },
      { tool: "black", icon: "blackbox", label: "guide.tool.black", key: "K" },
    ],
  },
  {
    label: "panel.group.picture",
    items: [
      { tool: "crop", icon: "crop", label: "guide.tool.crop", key: "C" },
      { tool: "zoom", icon: "zoomarea", label: "guide.tool.zoom", key: "Z" },
      { tool: "expand", icon: "expand", label: "guide.tool.expand", key: "W" },
      { tool: "spot", icon: "spotlight", label: "guide.tool.spot", key: "S" },
      { tool: "magnify", icon: "magnify", label: "guide.tool.magnify", key: "G" },
      { tool: "marker", icon: "marker", label: "guide.tool.marker", key: "M" },
    ],
  },
];

export const TOOL_LETTERS: Record<string, Tool> = Object.fromEntries(TOOL_GROUPS.flatMap((g) => g.items).map((i) => [i.key.toLowerCase(), i.tool]));

/** What the picture of a step allows. */
export interface ToolLimits {
  /** There is a click marker to move or hide. */
  hasClick: boolean;
  /** The full screenshot is there, so the shown area can be made larger. */
  canExpand: boolean;
}

export const toolAllowed = (tool: Tool, limits: ToolLimits): boolean => (tool === "marker" ? limits.hasClick : tool === "expand" ? limits.canExpand : true);

/** The tool a key press chooses for the selected step, or `null`: never while something is typed, nor with Ctrl or Alt. */
export function toolForKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "target">, limits: ToolLimits): Tool | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const el = e.target as HTMLElement | null;
  if (el?.closest && (el.closest(".ProseMirror, .dw-dialog") || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return null;
  const tool = TOOL_LETTERS[e.key.toLowerCase()];
  return tool && toolAllowed(tool, limits) ? tool : null;
}

/** The letter keys work on the selected step, whether the sidebar is open or not. */
export function useToolKeys(on: boolean, tool: Tool, setTool: (t: Tool) => void, limits: ToolLimits) {
  const { hasClick, canExpand } = limits;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const next = toolForKey(e, { hasClick, canExpand });
      if (!next) return;
      e.preventDefault();
      setTool(tool === next ? "none" : next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, tool, setTool, hasClick, canExpand]);
}

export function ToolGrid(props: {
  /** No single step with a picture is selected: nothing can be chosen. */
  disabled: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  limits: ToolLimits;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  /** The click marker of the step is hidden. */
  markerHidden: boolean;
  onToggleMarker: () => void;
  canDelete: boolean;
  onDelete: () => void;
  /** The quick sizes of "Expand area", while that tool is chosen. */
  onExpand: (how: "grow25" | "grow50" | "window" | "screen") => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const { tool, disabled, limits } = props;
  const button = (i: Item) => {
    const allowed = toolAllowed(i.tool, limits);
    const label = i.tool === "expand" && !limits.canExpand && !disabled ? `${t(i.label)} – ${t("guide.noFullFrame")}` : t(i.label);
    return (
      <button key={i.tool} type="button" className="toolgrid__btn" data-tool={i.tool} aria-pressed={tool === i.tool} disabled={disabled} aria-disabled={disabled || !allowed || undefined} aria-label={t(i.label)} title={t("tools.tip", { tool: label, key: i.key })} onClick={() => allowed && props.setTool(tool === i.tool ? "none" : i.tool)}>
        <AppIcon name={i.icon} />
      </button>
    );
  };
  const markerLabel = props.markerHidden ? t("guide.markerShow") : t("guide.markerHide");
  return (
    <div className="toolgrid" role="toolbar" aria-label={t("guide.editPicture")} aria-disabled={disabled || undefined}>
      {TOOL_GROUPS.map((g) => (
        <div key={g.label} className="toolgrid__group" role="group" aria-label={t(g.label)}>
          <h4>{t(g.label)}</h4>
          <div className="toolgrid__buttons">
            {g.items.map(button)}
            {g.label === "panel.group.picture" && (
              <button type="button" className="toolgrid__btn" data-tool="hideMarker" aria-pressed={!disabled && props.markerHidden} disabled={disabled || !limits.hasClick} aria-label={markerLabel} title={markerLabel} onClick={props.onToggleMarker}>
                <AppIcon name="markeroff" />
              </button>
            )}
          </div>
        </div>
      ))}
      {tool === "expand" && (
        <div className="toolgrid__quick" role="group" aria-label={t("guide.expandQuick")}>
          {([["grow25", "+25%"], ["grow50", "+50%"], ["window", t("settings.docPictureWindow")], ["screen", t("settings.docPictureScreen")]] as const).map(([how, label]) => (
            <button key={how} type="button" className="gtoggle" onClick={() => props.onExpand(how)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="toolgrid__style">
        <Pop
          open={open}
          onClose={() => setOpen(false)}
          label={t("tools.color")}
          trigger={
            <button type="button" className="toolgrid__btn" disabled={disabled} aria-expanded={open} aria-label={t("tools.color")} title={t("tools.color")} onClick={() => setOpen((o) => !o)}>
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
        <label className="toolgrid__size" title={t("tools.size")}>
          <span className="gtoolbar__stroke" style={{ height: Math.max(1, Math.min(10, props.width)) }} />
          <input type="range" min={SIZE_RANGE.min} max={SIZE_RANGE.max} value={props.width} disabled={disabled} aria-label={t("tools.size")} aria-valuetext={t("tools.sizeValue", { size: props.width })} onChange={(e) => props.setWidth(Number(e.target.value))} />
        </label>
        <button type="button" className="toolgrid__btn" data-tool="delete" disabled={disabled || !props.canDelete} aria-label={t("guide.deleteSelected")} title={t("guide.deleteSelected")} onClick={props.onDelete}>
          <AppIcon name="trash" />
        </button>
      </div>
    </div>
  );
}
