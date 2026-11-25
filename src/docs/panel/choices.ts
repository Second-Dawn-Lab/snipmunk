// The options chosen last for new callouts, magnifiers and spotlights (no React). They stay on this computer; without them
// the defaults are used.

import { CALLOUT_DEFAULT, MAGNIFY_DEFAULT, SPOT_SHAPES, calloutStyle, magnifyStyle, type CalloutStyle, type MagnifyStyle, type SpotShape } from "../marks";

export interface Choices {
  callout: CalloutStyle;
  magnify: MagnifyStyle;
  spotShape: SpotShape;
}

const KEY = "snipmunk.guide.marks";

type Store = Pick<Storage, "getItem" | "setItem">;
const storage = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The choices as they were stored, completed; `accent` is the colour of new marks of the guide's template. */
export function readChoices(accent: string, store: Store | null = storage()): Choices {
  let saved: { callout?: object; magnify?: object; spotShape?: string } = {};
  try {
    saved = JSON.parse(store?.getItem(KEY) ?? "{}") ?? {};
  } catch {
    saved = {};
  }
  return {
    callout: calloutStyle({ ...CALLOUT_DEFAULT, color: accent, ...saved.callout }),
    magnify: magnifyStyle({ ...MAGNIFY_DEFAULT, color: accent, ...saved.magnify }),
    spotShape: SPOT_SHAPES.includes(saved.spotShape as SpotShape) ? (saved.spotShape as SpotShape) : "rect",
  };
}

/** Remember a change: only what was chosen is stored, so the rest keeps following the template. */
export function rememberChoice(change: { callout?: Partial<CalloutStyle>; magnify?: Partial<MagnifyStyle>; spotShape?: SpotShape }, store: Store | null = storage()): void {
  try {
    const saved = JSON.parse(store?.getItem(KEY) ?? "{}") ?? {};
    store?.setItem(
      KEY,
      JSON.stringify({
        callout: { ...saved.callout, ...change.callout },
        magnify: { ...saved.magnify, ...change.magnify },
        spotShape: change.spotShape ?? saved.spotShape,
      }),
    );
  } catch {
    /* no storage */
  }
}
