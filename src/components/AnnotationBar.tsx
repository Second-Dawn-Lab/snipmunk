import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
  readableOn,
} from "./palettes";
import { Pop } from "./Pop";

/** The tool values the popovers change (stored in the settings so that the tools of Phase 5 can start from them). */
type ToolValues = Pick<
  Settings,
  | "lastPenColor"
  | "lastPenSize"
  | "lastHighlighterColor"
  | "lastHighlighterSize"
  | "lastFillColor"
  | "lastFillOpacity"
  | "lastOutlineColor"
  | "lastOutlineOpacity"
  | "lastOutlineSize"
>;

const pickValues = (s: Settings): ToolValues => ({
  lastPenColor: s.lastPenColor,
  lastPenSize: s.lastPenSize,
  lastHighlighterColor: s.lastHighlighterColor,
  lastHighlighterSize: s.lastHighlighterSize,
  lastFillColor: s.lastFillColor,
  lastFillOpacity: s.lastFillOpacity,
  lastOutlineColor: s.lastOutlineColor,
  lastOutlineOpacity: s.lastOutlineOpacity,
  lastOutlineSize: s.lastOutlineSize,
});

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
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };
  return [values, change] as const;
}

type Open = "pen" | "highlighter" | "eraser" | "emoji" | "fill" | "outline" | "redact" | null;
type Sub = "shapes" | "ocr" | null;

/** The annotation toolbar above the preview. The tools themselves arrive in Phase 5; their popovers already work. */
export function AnnotationBar(props: { settings: Settings; onPatch: (change: Partial<Settings>) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState<Open>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [redact, setRedact] = useState({ email: true, phone: true });
  const [values, change] = useToolValues(props.settings, props.onPatch);

  const close = () => setOpen(null);
  const soon = (text: string) => `${text} – ${t("soon.label")}`;
  const toggle = (which: Exclude<Open, null>) => setOpen((o) => (o === which ? null : which));

  /** The ▾ button next to a tool. */
  const arrow = (which: Exclude<Open, null>, tool: string) => (
    <button
      type="button"
      className="tool__more"
      aria-haspopup={which === "eraser" || which === "redact" ? "menu" : "dialog"}
      aria-expanded={open === which}
      aria-label={t("tools.options", { tool })}
      title={t("tools.options", { tool })}
      onClick={() => toggle(which)}
    >
      <AppIcon name="chevron" size={12} />
    </button>
  );

  const label = (key: Parameters<typeof t>[0]) => t(key);

  return (
    <div className="annobar" role="toolbar" aria-label={t("tools.label")}>
      <div className="annobar__row">
        <Pop
          open={open === "pen"}
          onClose={close}
          label={label("tools.pen")}
          trigger={
            <span className="tool tool--split">
              <SoonTool icon="pen" label={t("tools.pen")} tip={soon(t("tools.pen"))} />
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
              <SoonTool icon="highlighter" label={t("tools.highlighter")} tip={soon(t("tools.highlighter"))} />
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
              <SoonTool icon="eraser" label={t("tools.eraser")} tip={soon(t("tools.eraser"))} />
              {arrow("eraser", t("tools.eraser"))}
            </span>
          }
        >
          <MenuItem label={t("tools.eraseAll")} icon="eraser" soon={soon(t("tools.eraseAll"))} />
        </Pop>

        <button
          type="button"
          className="tool"
          aria-pressed={sub === "shapes"}
          aria-expanded={sub === "shapes"}
          title={t("tools.shapes")}
          aria-label={t("tools.shapes")}
          onClick={() => setSub((s) => (s === "shapes" ? null : "shapes"))}
        >
          <AppIcon name="shapes" />
        </button>
        <SoonTool icon="text" label={t("tools.text")} tip={soon(t("tools.text"))} />
        <SoonTool icon="crop" label={t("tools.crop")} tip={soon(t("tools.crop"))} />
        <SoonTool icon="rotate" label={t("tools.rotate")} tip={soon(t("tools.rotate"))} />
        <SoonTool icon="blur" label={t("tools.blur")} tip={soon(t("tools.blur"))} />
        <button
          type="button"
          className="tool tool--wide"
          aria-pressed={sub === "ocr"}
          aria-expanded={sub === "ocr"}
          title={soon(t("tools.textActions"))}
          aria-label={t("tools.textActions")}
          onClick={() => setSub((s) => (s === "ocr" ? null : "ocr"))}
        >
          <AppIcon name="textscan" />
          <AppIcon name="chevron" size={12} />
        </button>

        <span className="annobar__end">
          <SoonTool icon="undo" label={t("tools.undo")} tip={soon(t("tools.undo"))} />
          <SoonTool icon="redo" label={t("tools.redo")} tip={soon(t("tools.redo"))} />
        </span>
      </div>

      {sub === "shapes" && (
        <div className="annobar__row annobar__sub" role="toolbar" aria-label={t("tools.shapes")}>
          <button type="button" className="tool" aria-label={t("tools.closeSub")} title={t("tools.closeSub")} onClick={() => setSub(null)}>
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
                  aria-label={t("tools.emoji")}
                  title={soon(t("tools.emoji"))}
                  aria-disabled="true"
                >
                  <span aria-hidden="true">{emoji}</span>
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
                  aria-pressed={e === emoji}
                  onClick={() => {
                    setEmoji(e);
                    close();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </Pop>
          <SoonTool icon="square" label={t("tools.rectangle")} tip={soon(t("tools.rectangle"))} />
          <SoonTool icon="circle" label={t("tools.circle")} tip={soon(t("tools.circle"))} />
          <SoonTool icon="line" label={t("tools.line")} tip={soon(t("tools.line"))} />
          <SoonTool icon="arrow" label={t("tools.arrow")} tip={soon(t("tools.arrow"))} />
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
          <button type="button" className="tool tool--labelled" aria-disabled="true" title={soon(t("ocr.copyAll"))}>
            <AppIcon name="copytext" size={17} />
            <span>{t("ocr.copyAll")}</span>
          </button>
          <button type="button" className="tool tool--labelled" aria-disabled="true" title={soon(t("ocr.copyTable"))}>
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
                title={soon(t("ocr.redact"))}
                onClick={() => toggle("redact")}
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
              onSelect={() => setRedact((r) => ({ ...r, email: !r.email }))}
            />
            <MenuItem
              role="menuitemcheckbox"
              label={t("ocr.redactPhone")}
              checked={redact.phone}
              onSelect={() => setRedact((r) => ({ ...r, phone: !r.phone }))}
            />
            <MenuItem label={t("ocr.redactClear")} soon={soon(t("ocr.redactClear"))} />
          </Pop>
        </div>
      )}
    </div>
  );
}

/** A tool that works in a later version: it keeps its place, icon and tooltip but does nothing yet. */
function SoonTool(props: { icon: AppIconName; label: string; tip: string }) {
  return (
    <button type="button" className="tool" aria-disabled="true" aria-label={props.label} title={props.tip}>
      <AppIcon name={props.icon} />
    </button>
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
