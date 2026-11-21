import { Button, Switch } from "@seconddawn/ui";
import { useT } from "../i18n";
import type { Effects } from "../recording/effects";
import { ClickControls, CursorControls, WebcamControls, type FieldRow } from "./EffectsControls";

const row: FieldRow = ({ id, label, children }) => (
  <div className="fxrow" key={id}>
    <span className="fxrow__label">{label}</span>
    <span className="fxrow__control">{children}</span>
  </div>
);

/**
 * The effects of a recording next to its player: the cursor, the click effects and the webcam overlay. A change shows in the player
 * at once and is saved with the recording; "Reset to defaults" goes back to the defaults of the settings.
 */
export function EffectsPanel(props: { effects: Effects; hasWebcam: boolean; onChange: (next: Effects) => void; onReset: () => void }) {
  const { t } = useT();
  const { effects, onChange } = props;
  return (
    <aside className="fxpanel" aria-label={t("fx.panel")}>
      <h3 className="fxpanel__title">{t("fx.panel")}</h3>
      <section className="fxpanel__group">
        <h4>{t("fx.cursor")}</h4>
        <CursorControls row={row} value={effects.cursor} onChange={(cursor) => onChange({ ...effects, cursor })} />
      </section>
      <section className="fxpanel__group">
        <h4>{t("fx.clickGroup")}</h4>
        <ClickControls row={row} value={effects.click} onChange={(click) => onChange({ ...effects, click })} />
      </section>
      {props.hasWebcam && (
        <section className="fxpanel__group">
          <h4>{t("fx.webcam")}</h4>
          {row({
            id: "webcamShow",
            label: t("fx.webcamShow"),
            children: <Switch label={t("fx.webcamShow")} checked={effects.webcam.show} onChange={(show) => onChange({ ...effects, webcam: { ...effects.webcam, show } })} />,
          })}
          {effects.webcam.show && <WebcamControls row={row} free value={effects.webcam} onChange={(webcam) => onChange({ ...effects, webcam })} />}
        </section>
      )}
      <Button onClick={props.onReset}>{t("fx.reset")}</Button>
    </aside>
  );
}
