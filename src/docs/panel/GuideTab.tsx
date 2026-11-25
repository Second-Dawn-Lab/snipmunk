// The "Guide" tab: what holds for the whole guide - the look (the template's settings, in sections that fold), the pictures,
// and Quick redact over everything.

import { Button, Select, Switch } from "@seconddawn/ui";
import { useT } from "../../i18n";
import type { GuideStep } from "../../ipc";
import { spotStyle, type SpotStyle } from "../marks";
import { setZoomDefault, type GuideDoc } from "../model";
import { templateOf } from "../template/apply";
import { SpotStyleFields } from "./MarkOptions";
import { TemplateEditor, useTemplateName } from "../template/TemplatePanel";

type Change = (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;

const row = (label: string, control: React.ReactNode) => (
  <div className="fxrow" key={label}>
    <span className="fxrow__label">{label}</span>
    <span className="fxrow__control">{control}</span>
  </div>
);

export function GuideTab(props: { doc: GuideDoc; steps: ReadonlyMap<number, GuideStep>; change: Change; onRedactGuide: () => void }) {
  const { t } = useT();
  const { doc, steps } = props;
  // How spotlights dim, for every step that has no style of its own.
  const spot = spotStyle(doc, {});
  const setSpot = (c: Partial<SpotStyle>) => props.change((d) => ({ ...d, spotlight: { ...spotStyle(d, {}), ...c } }), "spot:guide");
  const nameOf = useTemplateName();
  const set = (c: Partial<GuideDoc>) => props.change((d) => ({ ...d, ...c }));
  return (
    <>
      <p className="gpanel__template">
        {t("template.title")}: <strong>{nameOf(templateOf(doc))}</strong>
      </p>
      <TemplateEditor doc={doc} change={props.change} />
      <section className="fxpanel__group">
        <h4>{t("panel.pictures")}</h4>
        {row(
          t("guide.picture"),
          <Select
            label={t("guide.picture")}
            value={doc.picture}
            onChange={(v) => set({ picture: v as GuideDoc["picture"] })}
            options={[
              { value: "window", label: t("settings.docPictureWindow") },
              { value: "screen", label: t("settings.docPictureScreen") },
            ]}
          />,
        )}
        {row(t("settings.docZoom"), <Switch label={t("settings.docZoom")} checked={doc.zoomDefault} onChange={(on) => props.change((d) => setZoomDefault(d, on, steps))} />)}
        {row(t("settings.docKeepFull"), <Switch label={t("settings.docKeepFull")} checked={doc.keepFull} onChange={(keepFull) => set({ keepFull })} />)}
        <p className="fxpanel__note">{t("guide.redactNote")}</p>
        <Button onClick={props.onRedactGuide}>{t("redact.whole")}</Button>
      </section>
      <section className="fxpanel__group">
        <h4>{t("guide.tool.spot")}</h4>
        <SpotStyleFields style={spot} onChange={setSpot} />
      </section>
    </>
  );
}
