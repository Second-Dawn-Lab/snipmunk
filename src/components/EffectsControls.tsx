import { Select, Switch } from "@seconddawn/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n";
import type { Effects } from "../recording/effects";

/** How one labelled field is laid out: a row of the settings window, or a compact row of the effects panel. */
export type FieldRow = (props: { id: string; label: string; children: ReactNode }) => ReactNode;

function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      className="fxcolor"
      aria-label={props.label}
      title={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

/** The cursor: shown, size, halo and its colour. */
export function CursorControls(props: { value: Effects["cursor"]; onChange: (v: Effects["cursor"]) => void; row: FieldRow }) {
  const { t } = useT();
  const { value: v, onChange, row } = props;
  return (
    <>
      {row({
        id: "cursorShow",
        label: t("fx.cursorShow"),
        children: <Switch label={t("fx.cursorShow")} checked={v.show} onChange={(show) => onChange({ ...v, show })} />,
      })}
      {v.show && (
        <>
          {row({
            id: "cursorSize",
            label: t("fx.cursorSize"),
            children: (
              <Select
                label={t("fx.cursorSize")}
                value={v.size}
                onChange={(size) => onChange({ ...v, size: size as Effects["cursor"]["size"] })}
                options={[
                  { value: "1", label: "1×" },
                  { value: "1.5", label: "1.5×" },
                  { value: "2", label: "2×" },
                ]}
              />
            ),
          })}
          {row({
            id: "cursorHalo",
            label: t("fx.halo"),
            children: (
              <span className="fxpair">
                <Switch label={t("fx.halo")} checked={v.halo} onChange={(halo) => onChange({ ...v, halo })} />
                {v.halo && <ColorField label={t("fx.haloColor")} value={v.haloColor} onChange={(haloColor) => onChange({ ...v, haloColor })} />}
              </span>
            ),
          })}
        </>
      )}
    </>
  );
}

/** The click effect: kind, the colours of the left and right button, size. */
export function ClickControls(props: { value: Effects["click"]; onChange: (v: Effects["click"]) => void; row: FieldRow }) {
  const { t } = useT();
  const { value: v, onChange, row } = props;
  return (
    <>
      {row({
        id: "clickEffect",
        label: t("fx.click"),
        children: (
          <Select
            label={t("fx.click")}
            value={v.kind}
            onChange={(kind) => onChange({ ...v, kind: kind as Effects["click"]["kind"] })}
            options={[
              { value: "off", label: t("fx.clickOff") },
              { value: "ripple", label: t("fx.clickRipple") },
              { value: "burst", label: t("fx.clickBurst") },
            ]}
          />
        ),
      })}
      {v.kind !== "off" && (
        <>
          {row({
            id: "clickColors",
            label: t("fx.clickColors"),
            children: (
              <span className="fxpair">
                <ColorField label={t("fx.clickLeft")} value={v.left} onChange={(left) => onChange({ ...v, left })} />
                <ColorField label={t("fx.clickRight")} value={v.right} onChange={(right) => onChange({ ...v, right })} />
              </span>
            ),
          })}
          {row({
            id: "clickSize",
            label: t("fx.clickSize"),
            children: (
              <Select
                label={t("fx.clickSize")}
                value={v.size}
                onChange={(size) => onChange({ ...v, size: size as Effects["click"]["size"] })}
                options={[
                  { value: "small", label: t("fx.small") },
                  { value: "medium", label: t("fx.medium") },
                  { value: "large", label: t("fx.large") },
                ]}
              />
            ),
          })}
        </>
      )}
    </>
  );
}

/** The webcam overlay: shape, size, position and a thin border. (Whether the webcam is recorded is a recording option.) */
export function WebcamControls(props: { value: Effects["webcam"]; onChange: (v: Effects["webcam"]) => void; row: FieldRow; free?: boolean }) {
  const { t } = useT();
  const { value: v, onChange, row } = props;
  const positions: Effects["webcam"]["position"][] = ["top-left", "top-right", "bottom-left", "bottom-right"];
  if (props.free) positions.push("free");
  return (
    <>
      {row({
        id: "webcamShape",
        label: t("fx.webcamShape"),
        children: (
          <Select
            label={t("fx.webcamShape")}
            value={v.shape}
            onChange={(shape) => onChange({ ...v, shape: shape as Effects["webcam"]["shape"] })}
            options={[
              { value: "circle", label: t("fx.shapeCircle") },
              { value: "rounded", label: t("fx.shapeRounded") },
              { value: "rect", label: t("fx.shapeRect") },
            ]}
          />
        ),
      })}
      {row({
        id: "webcamSize",
        label: t("fx.webcamSize"),
        children: (
          <Select
            label={t("fx.webcamSize")}
            value={v.size}
            onChange={(size) => onChange({ ...v, size: size as Effects["webcam"]["size"] })}
            options={[
              { value: "s", label: t("fx.small") },
              { value: "m", label: t("fx.medium") },
              { value: "l", label: t("fx.large") },
            ]}
          />
        ),
      })}
      {row({
        id: "webcamPosition",
        label: t("fx.webcamPosition"),
        children: (
          <Select
            label={t("fx.webcamPosition")}
            value={v.position}
            onChange={(position) => onChange({ ...v, position: position as Effects["webcam"]["position"] })}
            options={positions.map((p) => ({
              value: p,
              label: t(`fx.pos.${p}` as "fx.pos.top-left"),
            }))}
          />
        ),
      })}
      {row({
        id: "webcamBorder",
        label: t("fx.webcamBorder"),
        children: (
          <span className="fxpair">
            <Select
              label={t("fx.webcamBorder")}
              value={v.border}
              onChange={(border) => onChange({ ...v, border: border as Effects["webcam"]["border"] })}
              options={(["off", "thin", "medium", "thick"] as const).map((b) => ({ value: b, label: t(`fx.border.${b}` as "fx.border.off") }))}
            />
            {v.border !== "off" && <ColorField label={t("fx.borderColor")} value={v.borderColor} onChange={(borderColor) => onChange({ ...v, borderColor })} />}
          </span>
        ),
      })}
    </>
  );
}
