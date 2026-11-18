import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { editorStore, useEditorUi } from "../annotate/editorStore";
import type { RedactMode } from "../annotate/schema";
import { pickValues, type ToolValues } from "../annotate/styles";
import { keyOf, type ShapeKind, type Tool } from "../annotate/tools";
import { useT } from "../i18n";
import type { Settings } from "../settings/defaults";
import { AppIcon, type AppIconName } from "./AppIcons";
import { MenuItem } from "./MenuItem";
import {
  EMOJI,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_SIZE_RANGE,
  PALETTE,
  PALETTE_COLUMNS,
  SIZE_RANGE,
  TEXT_SIZE_RANGE,
  readableOn,
} from "./palettes";
import { Pop } from "./Pop";

/** The values are shown at once and saved a moment after the last change (a slider fires many). */
function useToolValues(settings: Settings, save: (change: Partial<Settings>) => void) {
  const [values, setValues] = useState<ToolValues>(() => pickValues(settings));
  const pending = useRef<Partial<ToolValues>>({});
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const external = JSON.stringify(pickValues(settings));
  useEffect(() => setValues(pickValues(settings)), [external]);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (Object.keys(pending.current).length > 0) saveRef.current(pending.current);
    pending.current = {};
  };
  useEffect(() => flush, []);

  const change = (patch: Partial<ToolValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    // The selected marks take the new value at once (a colour or a size is also a way to restyle them).
    editorStore.actions.restyle(patch);
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };
  return [values, change] as const;
}

type Open = "pen" | "highlighter" | "eraser" | "emoji" | "fill" | "outline" | "redact" | "text" | "rotate" | "blur" | null;
type Sub = "shapes" | "ocr" | null;

const SHAPES: { kind: Exclude<ShapeKind, "emoji">; icon: AppIconName; label: "tools.rectangle" | "tools.circle" | "tools.line" | "tools.arrow" }[] = [
  { kind: "rect", icon: "square", label: "tools.rectangle" },
  { kind: "ellipse", icon: "circle", label: "tools.circle" },
  { kind: "line", icon: "line", label: "tools.line" },
  { kind: "arrow", icon: "arrow", label: "tools.arrow" },
];

/** The annotation toolbar above the preview: the tools, their popovers (colour, size, ...) and undo / redo. */
export function AnnotationBar(props: { settings: Settings; onPatch: (change: Partial<Settings>) => void }) {
  const { t } = useT();
  const ui = useEditorUi();
  const [open, setOpen] = useState<Open>(null);
  const [sub, setSub] = useState<Sub>(null);
  const redact = { email: props.settings.quickRedactEmail, phone: props.settings.quickRedactPhone };
  const [values, change] = useToolValues(props.settings, props.onPatch);
  const on = ui.enabled;
  // The text layer lies over the picture while the Text actions toolbar is open.
  useEffect(() => {
    editorStore.set({ textMode: sub === "ocr" });
    return () => editorStore.set({ textMode: false });
  }, [sub]);

  const close = () => setOpen(null);
  const toggle = (which: Exclude<Open, null>) => setOpen((o) => (o === which ? null : which));
  const tip = (tool: string, key?: string) => (key ? t("tools.tip", { tool, key }) : tool);
  /** A disabled tool says why in its tooltip. */
  const title = (text: string) => (on ? text : `${text} – ${t("tools.noCapture")}`);

  /** A tool button: pressed when it is the tool in use. */
  const tool = (which: Tool, icon: AppIconName, label: string, shortcut: string | null, extra?: () => void) => (
    <button
      type="button"
      className="tool"
      aria-pressed={on && ui.tool === which}
      aria-disabled={!on || undefined}
      aria-label={label}
      title={title(tip(label, shortcut ?? undefined))}
      onClick={() => {
        if (!on) return;
        // Choosing the tool again goes back to selecting (crop and shapes are modes you leave the same way).
        editorStore.setTool(ui.tool === which && which !== "select" ? "select" : which);
        extra?.();
      }}
    >
      <AppIcon name={icon} />
    </button>
  );

  /** The ▾ button next to a tool. */
  const arrow = (which: Exclude<Open, null>, label: string) => (
    <button
      type="button"
      className="tool__more"
      aria-haspopup={which === "eraser" || which === "redact" || which === "rotate" || which === "blur" ? "menu" : "dialog"}
      aria-expanded={open === which}
      aria-disabled={!on || undefined}
      aria-label={t("tools.options", { tool: label })}
      title={t("tools.options", { tool: label })}
      onClick={() => on && toggle(which)}
    >
      <AppIcon name="chevron" size={12} />
    </button>
  );

  const label = (key: Parameters<typeof t>[0]) => t(key);
  const redactModes: { mode: RedactMode; text: string }[] = [
    { mode: "pixelate", text: t("tools.redactPixelate") },
    { mode: "blur", text: t("tools.redactBlur") },
    { mode: "box", text: t("tools.redactBox") },
  ];

  return (
    <div className="annobar" role="toolbar" aria-label={t("tools.label")}>
      <div className="annobar__row">
        {tool("select", "select", t("tools.select"), keyOf("select"))}

        <Pop
          open={open === "pen"}
          onClose={close}
          label={label("tools.pen")}
          trigger={
            <span className="tool tool--split">
              {tool("pen", "pen", t("tools.pen"), keyOf("pen"))}
              {arrow("pen", t("tools.pen"))}
            </span>
          }
        >
          <ColorPanel
            colors={PALETTE}
            value={values.lastPenColor}
            onColor={(c) => change({ lastPenColor: c })}
            size={{ ...SIZE_RANGE, value: values.lastPenSize, onChange: (v) => change({ lastPenSize: v }) }}
            preview={<StrokePreview color={values.lastPenColor} size={values.lastPenSize} />}
          />
        </Pop>

        <Pop
          open={open === "highlighter"}
          onClose={close}
          label={label("tools.highlighter")}
          trigger={
            <span className="tool tool--split">
              {tool("highlighter", "highlighter", t("tools.highlighter"), keyOf("highlighter"))}
              {arrow("highlighter", t("tools.highlighter"))}
            </span>
          }
        >
          <ColorPanel
            colors={HIGHLIGHTER_COLORS}
            columns={6}
            value={values.lastHighlighterColor}
            onColor={(c) => change({ lastHighlighterColor: c })}
            size={{
              ...HIGHLIGHTER_SIZE_RANGE,
              value: values.lastHighlighterSize,
              onChange: (v) => change({ lastHighlighterSize: v }),
            }}
            preview={
              <StrokePreview color={values.lastHighlighterColor} size={values.lastHighlighterSize} highlighter />
            }
          />
        </Pop>

        <Pop
          open={open === "eraser"}
          onClose={close}
          kind="menu"
          label={label("tools.eraser")}
          trigger={
            <span className="tool tool--split">
              {tool("eraser", "eraser", t("tools.eraser"), keyOf("eraser"))}
              {arrow("eraser", t("tools.eraser"))}
            </span>
          }
        >
          <MenuItem
            label={t("tools.eraseAll")}
            icon="eraser"
            disabled={!ui.hasMarks}
            onSelect={() => {
              close();
              editorStore.actions.eraseAll();
            }}
          />
        </Pop>

        <button
          type="button"
          className="tool"
          aria-pressed={on && ui.tool === "shapes"}
          aria-expanded={sub === "shapes"}
          aria-disabled={!on || undefined}
          title={title(tip(t("tools.shapes"), keyOf("shapes")))}
          aria-label={t("tools.shapes")}
          onClick={() => {
            if (!on) return;
            const next = sub === "shapes" ? null : "shapes";
            setSub(next);
            editorStore.setTool(next ? "shapes" : "select");
          }}
        >
          <AppIcon name="shapes" />
        </button>

        <Pop
          open={open === "text"}
          onClose={close}
          label={label("tools.text")}
          trigger={
            <span className="tool tool--split">
              {tool("text", "text", t("tools.text"), keyOf("text"))}
              {arrow("text", t("tools.text"))}
            </span>
          }
        >
          <ColorPanel
            colors={PALETTE}
            value={values.lastTextColor}
            onColor={(c) => change({ lastTextColor: c })}
            size={{ ...TEXT_SIZE_RANGE, value: values.lastTextSize, onChange: (v) => change({ lastTextSize: v }) }}
            preview={<TextPreview color={values.lastTextColor} size={values.lastTextSize} background={values.lastTextBackground} />}
          >
            <label className="toggle">
              <input type="checkbox" checked={values.lastTextBackground} onChange={(e) => change({ lastTextBackground: e.target.checked })} />
              <span>{t("tools.textBackground")}</span>
            </label>
          </ColorPanel>
        </Pop>

        {tool("crop", "crop", t("tools.crop"), keyOf("crop"))}

        <Pop
          open={open === "rotate"}
          onClose={close}
          kind="menu"
          label={label("tools.rotate")}
          trigger={
            <span className="tool tool--split">
              <button
                type="button"
                className="tool"
                aria-disabled={!on || undefined}
                aria-label={t("tools.rotateRight")}
                title={title(tip(t("tools.rotateRight"), keyOf("rotate")))}
                onClick={() => on && editorStore.actions.rotate(1)}
              >
                <AppIcon name="rotate" />
              </button>
              {arrow("rotate", t("tools.rotate"))}
            </span>
          }
        >
          <MenuItem label={t("tools.rotateRight")} icon="rotate" hint={keyOf("rotate")} onSelect={() => { close(); editorStore.actions.rotate(1); }} />
          <MenuItem label={t("tools.rotateLeft")} icon="undo" onSelect={() => { close(); editorStore.actions.rotate(-1); }} />
          <MenuItem label={t("tools.flipH")} onSelect={() => { close(); editorStore.actions.flip("h"); }} />
          <MenuItem label={t("tools.flipV")} onSelect={() => { close(); editorStore.actions.flip("v"); }} />
        </Pop>

        <Pop
          open={open === "blur"}
          onClose={close}
          kind="menu"
          label={label("tools.blur")}
          trigger={
            <span className="tool tool--split">
              {tool("blur", "blur", t("tools.blur"), keyOf("blur"))}
              {arrow("blur", t("tools.blur"))}
            </span>
          }
        >
          {redactModes.map((m) => (
            <MenuItem
              key={m.mode}
              role="menuitemradio"
              label={m.text}
              checked={ui.redactMode === m.mode}
              onSelect={() => {
                close();
                editorStore.set({ redactMode: m.mode });
                if (on) editorStore.setTool("blur");
              }}
            />
          ))}
          <MenuItem
            label={t("tools.redactBake")}
            disabled={!ui.hasRedactions}
            soon={ui.hasRedactions ? undefined : t("tools.redactBakeNone")}
            onSelect={() => {
              close();
              editorStore.actions.askBake();
            }}
          />
        </Pop>

        <button
          type="button"
          className="tool tool--wide"
          aria-pressed={sub === "ocr"}
          aria-expanded={sub === "ocr"}
          aria-disabled={!on || undefined}
          aria-busy={ui.ocrBusy || undefined}
          title={title(ui.ocrBusy ? t("ocr.recognizing") : t("tools.textActions"))}
          aria-label={t("tools.textActions")}
          onClick={() => on && setSub((s) => (s === "ocr" ? null : "ocr"))}
        >
          {ui.ocrBusy ? <span className="spinner" aria-hidden="true" /> : <AppIcon name="textscan" />}
          <AppIcon name="chevron" size={12} />
        </button>

        <span className="annobar__end">
          <button
            type="button"
            className="tool"
            aria-disabled={!ui.canUndo || undefined}
            aria-label={t("tools.undo")}
            title={tip(t("tools.undo"), "Ctrl+Z")}
            onClick={() => ui.canUndo && editorStore.actions.undo()}
          >
            <AppIcon name="undo" />
          </button>
          <button
            type="button"
            className="tool"
            aria-disabled={!ui.canRedo || undefined}
            aria-label={t("tools.redo")}
            title={tip(t("tools.redo"), "Ctrl+Y")}
            onClick={() => ui.canRedo && editorStore.actions.redo()}
          >
            <AppIcon name="redo" />
          </button>
        </span>
      </div>

      {sub === "shapes" && (
        <div className="annobar__row annobar__sub" role="toolbar" aria-label={t("tools.shapes")}>
          <button type="button" className="tool" aria-label={t("tools.closeSub")} title={t("tools.closeSub")} onClick={() => { setSub(null); editorStore.setTool("select"); }}>
            <AppIcon name="close" size={16} />
          </button>
          <Pop
            open={open === "emoji"}
            onClose={close}
            label={label("tools.emoji")}
            trigger={
              <span className="tool tool--split">
                <button
                  type="button"
                  className="tool tool--emoji"
                  aria-pressed={on && ui.tool === "shapes" && ui.shape === "emoji"}
                  aria-label={t("tools.emoji")}
                  title={title(t("tools.emoji"))}
                  aria-disabled={!on || undefined}
                  onClick={() => on && editorStore.set({ tool: "shapes", shape: "emoji" })}
                >
                  <span aria-hidden="true">{ui.emoji}</span>
                </button>
                {arrow("emoji", t("tools.emoji"))}
              </span>
            }
          >
            <div className="emojigrid" role="group" aria-label={t("tools.emoji")}>
              {EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="emojigrid__btn"
                  aria-pressed={e === ui.emoji}
                  onClick={() => {
                    editorStore.set({ emoji: e, tool: "shapes", shape: "emoji" });
                    close();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </Pop>
          {SHAPES.map((s) => (
            <button
              key={s.kind}
              type="button"
              className="tool"
              aria-pressed={on && ui.tool === "shapes" && ui.shape === s.kind}
              aria-disabled={!on || undefined}
              aria-label={t(s.label)}
              title={title(t(s.label))}
              onClick={() => on && editorStore.set({ tool: "shapes", shape: s.kind })}
            >
              <AppIcon name={s.icon} />
            </button>
          ))}
          <span className="annobar__sep" aria-hidden="true" />
          <Pop
            open={open === "fill"}
            onClose={close}
            label={label("tools.fill")}
            trigger={
              <button
                type="button"
                className="tool tool--labelled"
                aria-haspopup="dialog"
                aria-expanded={open === "fill"}
                aria-label={t("tools.fill")}
                title={t("tools.fill")}
                onClick={() => toggle("fill")}
              >
                <AppIcon name="fill" size={17} />
                <ColorChip color={values.lastFillColor} />
                <AppIcon name="chevron" size={12} />
              </button>
            }
          >
            <ColorPanel
              colors={PALETTE}
              allowNone
              noneLabel={t("tools.noColor")}
              value={values.lastFillColor}
              onColor={(c) => change({ lastFillColor: c })}
              opacity={{ value: values.lastFillOpacity, onChange: (v) => change({ lastFillOpacity: v }) }}
              preview={<ShapePreview values={values} part="fill" />}
            />
          </Pop>
          <Pop
            open={open === "outline"}
            onClose={close}
            label={label("tools.outline")}
            trigger={
              <button
                type="button"
                className="tool tool--labelled"
                aria-haspopup="dialog"
                aria-expanded={open === "outline"}
                aria-label={t("tools.outline")}
                title={t("tools.outline")}
                onClick={() => toggle("outline")}
              >
                <AppIcon name="outline" size={17} />
                <ColorChip color={values.lastOutlineColor} />
                <AppIcon name="chevron" size={12} />
              </button>
            }
          >
            <ColorPanel
              colors={PALETTE}
              allowNone
              noneLabel={t("tools.noColor")}
              value={values.lastOutlineColor}
              onColor={(c) => change({ lastOutlineColor: c })}
              opacity={{ value: values.lastOutlineOpacity, onChange: (v) => change({ lastOutlineOpacity: v }) }}
              size={{ ...SIZE_RANGE, value: values.lastOutlineSize, onChange: (v) => change({ lastOutlineSize: v }) }}
              preview={<ShapePreview values={values} part="outline" />}
            />
          </Pop>
        </div>
      )}

      {sub === "ocr" && (
        <div className="annobar__row annobar__sub" role="toolbar" aria-label={t("ocr.label")}>
          <button type="button" className="tool" aria-label={t("tools.closeSub")} title={t("tools.closeSub")} onClick={() => setSub(null)}>
            <AppIcon name="close" size={16} />
          </button>
          <button
            type="button"
            className="tool tool--labelled"
            aria-disabled={!on || undefined}
            title={t("ocr.copyAll")}
            onClick={() => on && editorStore.actions.copyAllText()}
          >
            <AppIcon name="copytext" size={17} />
            <span>{t("ocr.copyAll")}</span>
          </button>
          <button
            type="button"
            className="tool tool--labelled"
            aria-disabled={!on || !ui.hasTable || undefined}
            title={ui.hasTable ? t("ocr.copyTable") : `${t("ocr.copyTable")} – ${ui.ocrBusy ? t("ocr.recognizing") : t("ocr.noTable")}`}
            onClick={() => on && ui.hasTable && editorStore.actions.copyTable()}
          >
            <AppIcon name="table" size={17} />
            <span>{t("ocr.copyTable")}</span>
          </button>
          <Pop
            open={open === "redact"}
            onClose={close}
            kind="menu"
            label={label("ocr.redact")}
            trigger={
              <button
                type="button"
                className="tool tool--labelled"
                aria-haspopup="menu"
                aria-expanded={open === "redact"}
                aria-disabled={!on || undefined}
                title={t("ocr.redact")}
                onClick={() => on && toggle("redact")}
              >
                <AppIcon name="redact" size={17} />
                <span>{t("ocr.redact")}</span>
                <AppIcon name="chevron" size={12} />
              </button>
            }
          >
            <MenuItem
              role="menuitemcheckbox"
              label={t("ocr.redactEmail")}
              checked={redact.email}
              onSelect={() => props.onPatch({ quickRedactEmail: !redact.email })}
            />
            <MenuItem
              role="menuitemcheckbox"
              label={t("ocr.redactPhone")}
              checked={redact.phone}
              onSelect={() => props.onPatch({ quickRedactPhone: !redact.phone })}
            />
            <MenuItem
              label={t("ocr.redactRun")}
              icon="redact"
              disabled={!on || (!redact.email && !redact.phone)}
              onSelect={() => {
                close();
                editorStore.actions.quickRedact(redact);
              }}
            />
            <MenuItem
              label={t("ocr.redactClear")}
              disabled={!ui.hasQuickRedactions}
              soon={ui.hasQuickRedactions ? undefined : t("ocr.redactClearNone")}
              onSelect={() => {
                close();
                editorStore.actions.removeQuickRedactions();
              }}
            />
          </Pop>
        </div>
      )}
    </div>
  );
}

/** A text drawn with the chosen colour, size and label. */
function TextPreview(props: { color: string; size: number; background: boolean }) {
  const dark = readableOn(props.color) === "#ffffff";
  return (
    <svg viewBox="0 0 200 56" width="100%" height="56" aria-hidden="true">
      {props.background && <rect x="40" y="8" width="120" height="40" rx="3" fill={dark ? "#ffffff" : "#000000"} />}
      <text x="100" y="36" textAnchor="middle" fontSize={Math.min(34, Math.max(10, props.size * 0.6))} fill={props.color} fontFamily="Segoe UI, sans-serif">
        Abc ۱۲۳
      </text>
    </svg>
  );
}

function ColorChip({ color }: { color: string }) {
  return color === "none" ? (
    <span className="chip chip--none" aria-hidden="true" />
  ) : (
    <span className="chip" style={{ background: color }} aria-hidden="true" />
  );
}

interface Slider {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}

/** The popover of a pen-like tool: a color grid, an optional opacity and size slider, and a live preview. */
function ColorPanel(props: {
  colors: readonly string[];
  columns?: number;
  allowNone?: boolean;
  noneLabel?: string;
  value: string;
  onColor: (color: string) => void;
  opacity?: { value: number; onChange: (v: number) => void };
  size?: Slider;
  preview: ReactNode;
  /** More controls under the sliders (the text tool's label switch). */
  children?: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="colorpanel">
      <Swatches
        colors={props.colors}
        columns={props.columns ?? PALETTE_COLUMNS}
        value={props.value}
        allowNone={props.allowNone}
        noneLabel={props.noneLabel}
        onPick={props.onColor}
      />
      {props.opacity && (
        <RangeRow
          label={t("tools.opacity")}
          min={0}
          max={100}
          value={props.opacity.value}
          text={t("tools.opacityValue", { value: props.opacity.value })}
          onChange={props.opacity.onChange}
        />
      )}
      {props.size && (
        <RangeRow
          label={t("tools.size")}
          min={props.size.min}
          max={props.size.max}
          value={props.size.value}
          text={t("tools.sizeValue", { size: props.size.value })}
          onChange={props.size.onChange}
        />
      )}
      <div className="preview-box" role="img" aria-label={t("tools.preview")}>
        {props.preview}
      </div>
      {props.children}
    </div>
  );
}

function RangeRow(props: {
  label: string;
  min: number;
  max: number;
  value: number;
  text: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rangerow">
      <span className="rangerow__label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        aria-valuetext={props.text}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output className="rangerow__value">{props.text}</output>
    </label>
  );
}

/** A grid of color swatches. Arrow keys move through it (left and right swap in right-to-left layouts). */
function Swatches(props: {
  colors: readonly string[];
  columns: number;
  value: string;
  allowNone?: boolean;
  noneLabel?: string;
  onPick: (color: string) => void;
}) {
  const { t } = useT();
  const grid = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    // The grid has no "none" swatch in some panels, so columns are counted among the buttons.
    const rtl = document.documentElement.dir === "rtl";
    const delta: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: props.columns,
      ArrowUp: -props.columns,
    };
    const step = delta[e.key];
    if (step === undefined) return;
    const next = buttons[at + step];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <div className="swatchgrid" ref={grid} role="radiogroup" aria-label={t("tools.color")} onKeyDown={onKeyDown}>
      {props.allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={props.value === "none"}
          className="swatchgrid__none"
          onClick={() => props.onPick("none")}
        >
          <span className="chip chip--none" aria-hidden="true" />
          {props.noneLabel}
        </button>
      )}
      <div className="swatchgrid__cells" style={{ gridTemplateColumns: `repeat(${props.columns}, 1fr)` }}>
        {props.colors.map((c) => {
          const on = c.toLowerCase() === props.value.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              className="swatchgrid__cell"
              style={{ background: c, color: readableOn(c) }}
              aria-label={t("tools.colorValue", { value: c })}
              title={c}
              onClick={() => props.onPick(c)}
            >
              {on && <AppIcon name="check" size={14} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A curve drawn with the chosen color and size, so the effect of the slider is visible. */
function StrokePreview(props: { color: string; size: number; highlighter?: boolean }) {
  return (
    <svg viewBox="0 0 200 56" width="100%" height="56" aria-hidden="true">
      <path
        d="M14 38 C 44 6, 78 56, 108 28 S 164 14, 186 22"
        fill="none"
        stroke={props.color}
        strokeWidth={props.size}
        strokeLinecap={props.highlighter ? "butt" : "round"}
        strokeOpacity={props.highlighter ? 0.55 : 1}
      />
    </svg>
  );
}

/** A rectangle drawn with the chosen fill and outline. */
function ShapePreview(props: { values: ToolValues; part: "fill" | "outline" }) {
  const v = props.values;
  const fill = v.lastFillColor;
  const line = v.lastOutlineColor;
  return (
    <svg viewBox="0 0 200 56" width="100%" height="56" aria-hidden="true">
      <rect
        x="50"
        y="10"
        width="100"
        height="36"
        rx="4"
        fill={fill === "none" ? "none" : fill}
        fillOpacity={v.lastFillOpacity / 100}
        stroke={line === "none" ? "none" : line}
        strokeOpacity={v.lastOutlineOpacity / 100}
        strokeWidth={Math.min(v.lastOutlineSize, 14)}
      />
    </svg>
  );
}
