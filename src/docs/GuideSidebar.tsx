import { Button, Select, Switch } from "@seconddawn/ui";
import { useT } from "../i18n";
import type { GuideStep } from "../ipc";
import { applyArea, areaOf, type Area } from "./areas";
import type { GuideDoc, MarkerShape, MarkerSize, StepBlock } from "./model";

const SHAPES: MarkerShape[] = ["circle", "ring", "arrow", "hand", "box"];
const SIZES: MarkerSize[] = ["small", "medium", "large"];

const row = (id: string, label: string, control: React.ReactNode) => (
  <div className="fxrow" key={id}>
    <span className="fxrow__label">{label}</span>
    <span className="fxrow__control">{control}</span>
  </div>
);

/**
 * The right sidebar of a guide, like the Effects panel of a recording (same width, headers and rows): "Guide" (marker, step numbers,
 * picture area, zoom, files) and, when one step is selected, "Step".
 */
export function GuideSidebar(props: {
  doc: GuideDoc;
  set: (c: Partial<GuideDoc>) => void;
  setMarker: (c: Partial<GuideDoc["marker"]>) => void;
  block: StepBlock | undefined;
  step: GuideStep | undefined;
  patch: (c: Partial<StepBlock>) => void;
  /** Start a tool of the step's picture editor (the zoom area). */
  requestTool: (tool: "zoom") => void;
}) {
  const { t } = useT();
  const { doc, block, step } = props;
  const hasClick = !!step && step.click !== null && step.kind !== "type" && step.kind !== "key";
  const area = block && step?.image ? areaOf(step, block) : "default";
  return (
    <aside className="fxpanel gsidebar" aria-label={t("guide.header")}>
      <h3 className="fxpanel__title">{t("guide.header")}</h3>
      <section className="fxpanel__group">
        <h4>{t("guide.sectionMarker")}</h4>
        {row("shape", t("guide.markerShape"), <Select label={t("guide.markerShape")} value={doc.marker.shape} onChange={(v) => props.setMarker({ shape: v as MarkerShape })} options={SHAPES.map((s) => ({ value: s, label: t(`guide.shape.${s}`) }))} />)}
        {row("size", t("guide.markerSize"), <Select label={t("guide.markerSize")} value={doc.marker.size} onChange={(v) => props.setMarker({ size: v as MarkerSize })} options={SIZES.map((s) => ({ value: s, label: t(`guide.size.${s}`) }))} />)}
        {row("left", t("guide.markerLeft"), <input type="color" className="fxcolor" aria-label={t("guide.markerLeft")} value={doc.marker.left} onChange={(e) => props.setMarker({ left: e.target.value.toUpperCase() })} />)}
        {row("right", t("guide.markerRight"), <input type="color" className="fxcolor" aria-label={t("guide.markerRight")} value={doc.marker.right} onChange={(e) => props.setMarker({ right: e.target.value.toUpperCase() })} />)}
        {row("badge", t("guide.badge"), <Select label={t("guide.badge")} value={doc.badge} onChange={(v) => props.set({ badge: v as GuideDoc["badge"] })} options={(["circle", "square", "none"] as const).map((s) => ({ value: s, label: t(`guide.badge.${s}`) }))} />)}
      </section>
      <section className="fxpanel__group">
        <h4>{t("guide.sectionPicture")}</h4>
        {row(
          "picture",
          t("guide.picture"),
          <Select
            label={t("guide.picture")}
            value={doc.picture}
            onChange={(v) => props.set({ picture: v as GuideDoc["picture"] })}
            options={[
              { value: "window", label: t("settings.docPictureWindow") },
              { value: "screen", label: t("settings.docPictureScreen") },
            ]}
          />,
        )}
        {row("zoom", t("settings.docZoom"), <Switch label={t("settings.docZoom")} checked={doc.zoomDefault} onChange={(zoomDefault) => props.set({ zoomDefault })} />)}
        {row("keep", t("settings.docKeepFull"), <Switch label={t("settings.docKeepFull")} checked={doc.keepFull} onChange={(keepFull) => props.set({ keepFull })} />)}
        <p className="fxpanel__note">{t("guide.redactNote")}</p>
      </section>
      {block && step && (
        <section className="fxpanel__group">
          <h4>{t("guide.sectionStep")}</h4>
          {step.image && (
            <>
              {row(
                "area",
                t("guide.stepArea"),
                <Select
                  label={t("guide.stepArea")}
                  value={area}
                  onChange={(v) => applyArea(step, block, v as Area, props.patch)}
                  options={[
                    { value: "default", label: t("guide.areaDefault") },
                    { value: "window", label: t("settings.docPictureWindow") },
                    { value: "screen", label: t("settings.docPictureScreen") },
                    ...(area === "custom" ? [{ value: "custom", label: t("guide.areaCustom") }] : []),
                  ]}
                />,
              )}
              {hasClick && row("zoomOn", t("guide.zoomOn"), <Switch label={t("guide.zoomOn")} checked={block.zoom ?? doc.zoomDefault} onChange={(zoom) => props.patch({ zoom })} />)}
              {hasClick && (
                <Button onClick={() => props.requestTool("zoom")}>{t("guide.zoomAdjust")}</Button>
              )}
              {hasClick && row("marker", t("guide.markerVisible"), <Switch label={t("guide.markerVisible")} checked={!block.markerHidden} onChange={(show) => props.patch({ markerHidden: !show })} />)}
            </>
          )}
          {block.text && <Button onClick={() => props.patch({ text: undefined })}>{t("guide.resetText")}</Button>}
        </section>
      )}
    </aside>
  );
}
