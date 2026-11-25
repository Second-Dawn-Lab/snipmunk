// The options of the callout, spotlight and magnifier tools, under the tool grid of the "Step" tab: for the selected mark, or
// for the next one that is drawn.

import { Button, Select, Switch } from "@seconddawn/ui";
import { useState, type ReactNode } from "react";
import { Pop } from "../../components/Pop";
import { useT } from "../../i18n";
import { CALLOUT_LIMITS, CALLOUT_SHAPES, MAGNIFY_LIMITS, SPOT_LIMITS, SPOT_SHAPES, calloutPath, type CalloutStyle, type MagnifyStyle, type SpotShape, type SpotStyle } from "../marks";

export const row = (label: string, control: ReactNode) => (
  <div className="fxrow" key={label}>
    <span className="fxrow__label">{label}</span>
    <span className="fxrow__control">{control}</span>
  </div>
);

/** A colour: the template's colours, black and white, or any other. */
export function ColorField(props: { label: string; value: string; palette: readonly string[]; onChange: (color: string) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const colors = [...new Set([...props.palette, "#FFFFFF", "#111111", "#FFE066"].map((c) => c.toUpperCase()))];
  return row(
    props.label,
    <Pop
      open={open}
      onClose={() => setOpen(false)}
      label={props.label}
      align="end"
      trigger={
        <button type="button" className="tool markopt__color" aria-expanded={open} aria-label={props.label} title={props.label} onClick={() => setOpen((o) => !o)}>
          <span className="gtoolbar__swatch" style={{ background: props.value }} />
        </button>
      }
    >
      <div className="colorpanel">
        <div className="swatches" style={{ gridTemplateColumns: "repeat(5, 26px)" }}>
          {colors.map((c) => (
            <button key={c} type="button" className={`swatch${c === props.value.toUpperCase() ? " swatch--on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => (props.onChange(c), setOpen(false))} />
          ))}
        </div>
        <label className="gtoolbar__custom">
          {t("guide.customColor")}
          <input type="color" value={props.value.slice(0, 7)} onChange={(e) => props.onChange(e.target.value.toUpperCase())} />
        </label>
      </div>
    </Pop>,
  );
}

const range = (label: string, value: number, min: number, max: number, step: number, shown: string, onChange: (v: number) => void) =>
  row(
    label,
    <span className="markopt__range">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={shown} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{shown}</output>
    </span>,
  );

/** The shapes of a callout as small pictures of themselves. */
function Shapes(props: { value: string; onChange: (shape: CalloutStyle["shape"]) => void }) {
  const { t } = useT();
  return (
    <div className="markopt__shapes" role="radiogroup" aria-label={t("mark.shape")}>
      {CALLOUT_SHAPES.map((shape) => {
        const p = calloutPath(shape, { x: 6, y: 4, w: 48, h: 26 }, [8, 46], 2);
        return (
          <button key={shape} type="button" role="radio" aria-checked={props.value === shape} className="markopt__shape" aria-label={t(`mark.shape.${shape}`)} title={t(`mark.shape.${shape}`)} onClick={() => props.onChange(shape)}>
            <svg viewBox="-6 -10 72 60" aria-hidden="true">
              <path d={p.body} />
              {p.leader && <line x1={p.leader[0][0]} y1={p.leader[0][1]} x2={p.leader[1][0]} y2={p.leader[1][1]} />}
              {p.head && <path d={p.head} className="markopt__head" />}
              {p.dots?.map(([x, y, r]) => <circle key={`${x}`} cx={x} cy={y} r={r * 0.7} />)}
            </svg>
          </button>
        );
      })}
    </div>
  );
}

export function CalloutOptions(props: { value: CalloutStyle; palette: readonly string[]; onChange: (change: Partial<CalloutStyle>) => void }) {
  const { t } = useT();
  const { value, palette, onChange } = props;
  return (
    <section className="fxpanel__group markopt" aria-label={t("guide.tool.callout")}>
      <h4>{t("guide.tool.callout")}</h4>
      <Shapes value={value.shape} onChange={(shape) => onChange({ shape })} />
      <ColorField label={t("mark.fill")} value={value.fill} palette={palette} onChange={(fill) => onChange({ fill })} />
      <ColorField label={t("mark.border")} value={value.color} palette={palette} onChange={(color) => onChange({ color })} />
      {range(t("mark.borderWidth"), value.width, CALLOUT_LIMITS.width.min, CALLOUT_LIMITS.width.max, 0.5, String(Math.round(value.width * 10) / 10), (width) => onChange({ width }))}
      <ColorField label={t("mark.textColor")} value={value.textColor} palette={palette} onChange={(textColor) => onChange({ textColor })} />
      {range(t("mark.fontSize"), value.size, CALLOUT_LIMITS.size.min, CALLOUT_LIMITS.size.max, 1, String(Math.round(value.size)), (size) => onChange({ size }))}
      {row(t("mark.bold"), <Switch label={t("mark.bold")} checked={value.bold} onChange={(bold) => onChange({ bold })} />)}
    </section>
  );
}

/** The dimming around spotlights (a step's, or the guide's default). */
export function SpotStyleFields(props: { style: SpotStyle; onChange: (change: Partial<SpotStyle>) => void }) {
  const { t } = useT();
  const { style, onChange } = props;
  return (
    <>
      {range(t("spot.dim"), style.dim, SPOT_LIMITS.min, SPOT_LIMITS.max, 5, `${style.dim}%`, (dim) => onChange({ dim }))}
      {row(
        t("spot.tone"),
        <Select
          label={t("spot.tone")}
          value={style.tone}
          onChange={(tone) => onChange({ tone })}
          options={[
            { value: "dark", label: t("spot.dark") },
            { value: "light", label: t("spot.light") },
          ]}
        />,
      )}
      {row(t("spot.soft"), <Switch label={t("spot.soft")} checked={style.soft} onChange={(soft) => onChange({ soft })} />)}
    </>
  );
}

export function SpotOptions(props: { shape: SpotShape; style: SpotStyle; onShape: (shape: SpotShape) => void; onStyle: (change: Partial<SpotStyle>) => void; onApplyAll: () => void }) {
  const { t } = useT();
  return (
    <section className="fxpanel__group markopt" aria-label={t("guide.tool.spot")}>
      <h4>{t("guide.tool.spot")}</h4>
      {row(t("mark.shape"), <Select label={t("mark.shape")} value={props.shape} onChange={props.onShape} options={SPOT_SHAPES.map((s) => ({ value: s, label: t(`mark.shape.${s}`) }))} />)}
      <SpotStyleFields style={props.style} onChange={props.onStyle} />
      <Button onClick={props.onApplyAll}>{t("spot.applyAll")}</Button>
    </section>
  );
}

export function MagnifyOptions(props: { value: MagnifyStyle; palette: readonly string[]; onChange: (change: Partial<MagnifyStyle>) => void }) {
  const { t } = useT();
  const { value, palette, onChange } = props;
  return (
    <section className="fxpanel__group markopt" aria-label={t("guide.tool.magnify")}>
      <h4>{t("guide.tool.magnify")}</h4>
      {row(
        t("mark.shape"),
        <Select
          label={t("mark.shape")}
          value={value.shape}
          onChange={(shape) => onChange({ shape })}
          options={[
            { value: "circle", label: t("mark.shape.circle") },
            { value: "square", label: t("mark.shape.square") },
          ]}
        />,
      )}
      {range(t("magnify.zoom"), value.zoom, MAGNIFY_LIMITS.zoom.min, MAGNIFY_LIMITS.zoom.max, 0.25, `${value.zoom}×`, (zoom) => onChange({ zoom }))}
      {row(t("magnify.line"), <Switch label={t("magnify.line")} checked={value.line} onChange={(line) => onChange({ line })} />)}
      <ColorField label={t("mark.border")} value={value.color} palette={palette} onChange={(color) => onChange({ color })} />
      {range(t("mark.borderWidth"), value.width, MAGNIFY_LIMITS.width.min, MAGNIFY_LIMITS.width.max, 0.5, String(Math.round(value.width * 10) / 10), (width) => onChange({ width }))}
    </section>
  );
}
