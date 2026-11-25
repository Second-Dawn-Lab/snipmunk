// The top of the "Step" tab: the tool grid, and under it the options of the callout, spotlight and magnifier (of the selected
// mark, else of the next one drawn).

import { useT } from "../../i18n";
import type { GuideStep } from "../../ipc";
import { applyArea } from "../areas";
import { calloutStyle, canvasMeasure, magnifyStyle, restyleCallout, spotStyle, type SpotShape } from "../marks";
import type { Annotation, GuideDoc, StepBlock } from "../model";
import { framing, templateOf } from "../template/apply";
import { colorsOf } from "../template/model";
import type { Choices, rememberChoice } from "./choices";
import { CalloutOptions, MagnifyOptions, SpotOptions } from "./MarkOptions";
import { ToolGrid, type ToolLimits } from "./ToolGrid";
import type { Tool } from "../StepPicture";

/** What the editor knows about the tools: they act on the one selected step. */
export interface ToolsApi {
  /** The one selected step and its recorded data; `null`: no step (or several) is selected. */
  active: { block: StepBlock; step: GuideStep } | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  limits: ToolLimits;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  /** The selected mark of the step (a redaction: `redact:<n>`). */
  selected: string | null;
  deleteSelected: () => void;
  choices: Choices;
  remember: (change: Parameters<typeof rememberChoice>[0]) => void;
}

type Change = (fn: (d: GuideDoc) => GuideDoc, key?: string) => void;

export function StepTools({ doc, tools, change }: { doc: GuideDoc; tools: ToolsApi; change: Change }) {
  const { t } = useT();
  const { active, tool } = tools;
  const colors = colorsOf(templateOf(doc));
  const palette = [colors.main, colors.accent, colors.dark, colors.light, colors.text, colors.background];
  const mark = active?.block.annotations?.find((a) => a.id === tools.selected);
  const kind = mark?.kind === "callout" || mark?.kind === "spot" || mark?.kind === "magnify" ? mark.kind : tool === "callout" || tool === "spot" || tool === "magnify" ? tool : null;
  const picked = mark && mark.kind === kind ? mark : undefined;
  const patch = (c: Partial<StepBlock>, key = "") => active && change((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === active.block.id ? ({ ...b, ...c } as StepBlock) : b)) }), key);
  const replace = (a: Annotation, key: string) => patch({ annotations: (active?.block.annotations ?? []).map((x) => (x.id === a.id ? a : x)) }, key);
  return (
    <div className="steptools">
      <ToolGrid
        disabled={!active}
        tool={tool}
        setTool={tools.setTool}
        limits={tools.limits}
        color={tools.color}
        setColor={tools.setColor}
        width={tools.width}
        setWidth={tools.setWidth}
        markerHidden={!!active?.block.markerHidden}
        onToggleMarker={() => patch({ markerHidden: !active?.block.markerHidden })}
        canDelete={tools.selected !== null}
        onDelete={tools.deleteSelected}
        onExpand={(how) => active && applyArea(active.step, active.block, how, (c) => patch({ ...c, frame: undefined }))}
      />
      {!active && <p className="fxpanel__note">{t("panel.noStepTools")}</p>}
      {active && kind === "callout" && (
        <CalloutOptions
          value={picked ? calloutStyle(picked) : tools.choices.callout}
          palette={palette}
          onChange={(c) => {
            tools.remember({ callout: c });
            if (picked) replace(restyleCallout(picked, c, framing(active.step, active.block, doc).view, canvasMeasure), `callout:${picked.id}:${Object.keys(c).join()}`);
          }}
        />
      )}
      {active && kind === "spot" && (
        <SpotOptions
          shape={picked ? ((picked.shape as SpotShape) ?? "rect") : tools.choices.spotShape}
          style={spotStyle(doc, active.block)}
          onShape={(shape) => {
            tools.remember({ spotShape: shape });
            if (picked) replace({ ...picked, shape }, "");
          }}
          onStyle={(c) => patch({ spotlight: { ...spotStyle(doc, active.block), ...c } }, `spot:${active.block.id}:${Object.keys(c).join()}`)}
          onApplyAll={() => {
            // The style becomes the guide's; no step keeps one of its own.
            const style = spotStyle(doc, active.block);
            change((d) => ({ ...d, spotlight: style, blocks: d.blocks.map((b) => (b.type === "step" && b.spotlight ? { ...b, spotlight: undefined } : b)) }));
          }}
        />
      )}
      {active && kind === "magnify" && (
        <MagnifyOptions
          value={picked ? magnifyStyle(picked) : tools.choices.magnify}
          palette={palette}
          onChange={(c) => {
            tools.remember({ magnify: c });
            if (picked) replace({ ...picked, ...c }, `magnify:${picked.id}:${Object.keys(c).join()}`);
          }}
        />
      )}
    </div>
  );
}
