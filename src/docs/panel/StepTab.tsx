// The "Step" tab: everything about the selected step - its picture area, zoom, place in the frame, click marker, number, text and
// Quick redact. With several steps selected, only what can be done to all of them.

import { Button, Select, Switch } from "@seconddawn/ui";
import { Suspense, lazy, useState } from "react";
import { useT } from "../../i18n";
import type { GuideStep } from "../../ipc";
import type { Settings } from "../../settings/defaults";
import { applyArea, areaOf, type Area } from "../areas";
import type { GuideDoc, StepBlock } from "../model";
import { QuickRedactButton, type QuickRedact } from "../RedactTools";
import { framing } from "../template/apply";
import { sliderOf, widthAt, zoomPercent } from "../template/frame";
import { stepOptions, zoomChoice } from "./stepOptions";
import { StepTools, type ToolsApi } from "./StepTools";

// (a development tool: a release build does not even include it)
const OcrDebug = import.meta.env.DEV ? lazy(() => import("../OcrDebug")) : null;

const row = (label: string, control: React.ReactNode) => (
  <div className="fxrow" key={label}>
    <span className="fxrow__label">{label}</span>
    <span className="fxrow__control">{control}</span>
  </div>
);

export function StepTab(props: {
  doc: GuideDoc;
  steps: ReadonlyMap<number, GuideStep>;
  /** The selected steps, in the order of the guide. */
  blocks: StepBlock[];
  /** Change some of these steps, as one undo step. */
  patch: (change: (block: StepBlock) => Partial<StepBlock> | null, key?: string) => void;
  /** Choose the zoom area on the picture of the (single) step. */
  onAdjustZoom: () => void;
  quick: QuickRedact;
  settings: Settings;
  /** The tools of the step picture, and the guide (they change it). */
  tools: ToolsApi;
  change: (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;
}) {
  const { t } = useT();
  const [debug, setDebug] = useState(false);
  const { blocks, doc, patch } = props;
  const tools = <StepTools doc={doc} tools={props.tools} change={props.change} />;
  if (blocks.length === 0) return tools;
  const stepOf = (b: StepBlock) => props.steps.get(b.n);
  const can = stepOptions(blocks, props.steps);
  const one = blocks.length === 1 ? blocks[0] : null;
  const oneStep = one ? stepOf(one) : undefined;

  const areas = can.pictures ? blocks.map((b) => areaOf(stepOf(b)!, b)) : [];
  const area = areas.every((a) => a === areas[0]) ? areas[0] : "mixed";
  const areaOptions = [
    ...(area === "mixed" ? [{ value: "mixed", label: "–" }] : []),
    { value: "default", label: t("guide.areaDefault") },
    { value: "window", label: t("settings.docPictureWindow") },
    { value: "screen", label: t("settings.docPictureScreen") },
    ...(area === "custom" ? [{ value: "custom", label: t("guide.areaCustom") }] : []),
  ];
  const setArea = (v: Area) =>
    patch((b) => {
      let change: Partial<StepBlock> | null = null;
      // (a new area starts with its whole self in view)
      applyArea(stepOf(b)!, b, v, (c) => (change = { ...c, frame: undefined }));
      return change;
    });

  const first = one && oneStep?.image ? framing(oneStep, one, doc) : null;
  // "Fit" and "Fill" for one step or each of several: without a frame, "Fit" takes the zoom away.
  const place = (which: "fit" | "fill") =>
    patch((b) => {
      const f = framing(stepOf(b)!, b, doc);
      return { frame: f.ratio === null ? null : which === "fit" ? f.fit : f.fill };
    });
  const unframed = can.pictures && framing(stepOf(blocks[0])!, blocks[0], doc).ratio === null;

  // "Zoom into the click": the guide's default, or a setting of this step's own (which always wins).
  const choice = zoomChoice(blocks);
  const own = blocks.some((b) => b.zoom !== undefined || b.zoomRect !== undefined);
  const followGuide = () => patch(() => ({ zoom: undefined, zoomRect: undefined, frame: undefined }));

  return (
    <>
      {tools}
      {blocks.length > 1 && <p className="gpanel__template">{t("guide.selected", { count: blocks.length })}</p>}
      {can.pictures && (
        <section className="fxpanel__group">
          {row(t("guide.stepArea"), <Select label={t("guide.stepArea")} value={area} onChange={(v) => v !== "mixed" && setArea(v as Area)} options={areaOptions} />)}
          {can.clicks &&
            row(
              t("guide.zoomOn"),
              <Select
                label={t("guide.zoomOn")}
                value={choice}
                onChange={(v) => (v === "default" ? followGuide() : v !== "mixed" && patch(() => ({ zoom: v === "on", frame: undefined })))}
                options={[
                  ...(choice === "mixed" ? [{ value: "mixed", label: "–" }] : []),
                  { value: "default", label: t(doc.zoomDefault ? "guide.zoomGuideOn" : "guide.zoomGuideOff") },
                  { value: "on", label: t("guide.zoomStepOn") },
                  { value: "off", label: t("guide.zoomStepOff") },
                ]}
              />,
            )}
          {can.clicks && (
            <p className="fxpanel__note" data-zoom={own ? "own" : "guide"}>
              {t(own ? "panel.ownZoom" : "panel.followsGuide")}
            </p>
          )}
          {can.clicks && own && <Button onClick={followGuide}>{t("panel.useGuideDefault")}</Button>}
          {can.clicks && one && <Button onClick={props.onAdjustZoom}>{t("guide.zoomAdjust")}</Button>}
        </section>
      )}
      {can.pictures && (
        <section className="fxpanel__group">
          <h4>{t("panel.view")}</h4>
          <div className="gpanel__buttons">
            <Button title={t("guide.frameFit")} onClick={() => place("fit")}>
              {t("guide.fit")}
            </Button>
            <Button title={unframed ? t("panel.fillNeedsFrame") : t("guide.frameFill")} disabled={unframed} onClick={() => place("fill")}>
              {t("guide.fill")}
            </Button>
          </div>
          {first && (
            <label className="gpanel__zoom">
              <span>{t("guide.frameZoom")}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderOf(first.now.w, first.range)}
                aria-label={t("guide.frameZoom")}
                aria-valuetext={`${zoomPercent(first.now.w, first.range)}%`}
                onChange={(e) => {
                  const w = widthAt(Number(e.target.value), first.range);
                  patch(() => ({ frame: first.ratio === null && w >= first.range.widest ? null : { ...first.now, w } }), `frame:${one!.id}`);
                }}
              />
              <output>{zoomPercent(first.now.w, first.range)}%</output>
            </label>
          )}
          <p className="fxpanel__note">{t("panel.viewHint")}</p>
        </section>
      )}
      <section className="fxpanel__group">
        {can.clicks && row(t("guide.markerVisible"), <Switch label={t("guide.markerVisible")} checked={blocks.every((b) => !b.markerHidden)} onChange={(show) => patch(() => ({ markerHidden: !show }))} />)}
        {doc.badge !== "none" && row(t("panel.showNumber"), <Switch label={t("panel.showNumber")} checked={blocks.every((b) => !b.numberHidden)} onChange={(show) => patch(() => ({ numberHidden: show ? undefined : true }))} />)}
        {can.reset && <Button onClick={() => patch(() => ({ text: undefined }))}>{t("guide.resetText")}</Button>}
      </section>
      <section className="fxpanel__group">
        <QuickRedactButton quick={props.quick} ids={() => new Set(blocks.map((b) => b.id))} text={one ? t("panel.redactStep") : t("panel.redactSteps")} />
        {OcrDebug && one && oneStep?.image && <Button onClick={() => setDebug(true)}>{t("ocr.debug")}</Button>}
      </section>
      {OcrDebug && debug && one && oneStep && (
        <Suspense fallback={null}>
          <OcrDebug step={oneStep} block={one} doc={doc} settings={props.settings} onClose={() => setDebug(false)} />
        </Suspense>
      )}
    </>
  );
}
