// What the "Step" tab offers for the selected steps (no React): only what can be done to every one of them.

import type { GuideStep } from "../../ipc";
import type { StepBlock } from "../model";

export interface StepOptions {
  /** Every step has a picture: picture area, zoom and place in the frame. */
  pictures: boolean;
  /** Every step has a click to show and to zoom into. */
  clicks: boolean;
  /** Every step has a text of its own that "Reset to generated text" would drop. */
  reset: boolean;
}

/** What "Zoom into the click" says for the selected steps: they follow the guide ("default"), have a setting of their own
 * ("on" or "off"), or differ ("mixed"). A step with a zoom area of its own and no switch counts as following the guide. */
export function zoomChoice(blocks: readonly StepBlock[]): "default" | "on" | "off" | "mixed" {
  const each = blocks.map((b) => (b.zoom === undefined ? "default" : b.zoom ? "on" : "off"));
  return each.every((c) => c === each[0]) ? (each[0] ?? "default") : "mixed";
}

const clicked =(s: GuideStep): boolean => s.click !== null && s.kind !== "type" && s.kind !== "key";

export function stepOptions(blocks: readonly StepBlock[], steps: ReadonlyMap<number, GuideStep>): StepOptions {
  const all = (test: (b: StepBlock, s: GuideStep | undefined) => boolean) => blocks.length > 0 && blocks.every((b) => test(b, steps.get(b.n)));
  return {
    pictures: all((_, s) => !!s?.image),
    clicks: all((_, s) => !!s?.image && clicked(s)),
    reset: all((b) => !!b.text && !b.masked && !b.maskTyped),
  };
}
