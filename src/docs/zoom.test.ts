// 7.5-D: "Zoom into the click" happens inside the chosen picture area; a step's own setting wins over the guide's default.
import { describe, expect, it } from "vitest";
import type { GuideStep } from "../ipc";
import { createDocument, setZoomDefault, viewRect, zoomInside, zoomOn, type GuideDoc, type Rect, type StepBlock } from "./model";
import { zoomChoice } from "./panel/stepOptions";
import { framing } from "./template/apply";
import { BASIC } from "./template/model";

const step = (extra: Partial<GuideStep> = {}): GuideStep => ({ n: 1, kind: "click", t: 0, image: "s.png", imageSize: [1920, 1080], click: [500, 300], window: { rect: [200, 100, 800, 500], title: "W", process: "p" }, zoom: [200, 100, 640, 400], text: [], deleted: false, ...extra });
const guide = (extra: Partial<GuideDoc> = {}): GuideDoc => ({ ...createDocument("T", 1, [step()], { marker: BASIC.marker, badge: "circle", picture: "window", keepFull: false, zoomDefault: false }), ...extra });
const first = (d: GuideDoc) => d.blocks[0] as StepBlock;
const within = (r: Rect, area: Rect) => r[0] >= area[0] && r[1] >= area[1] && r[0] + r[2] <= area[0] + area[2] && r[1] + r[3] <= area[1] + area[3];

describe("zoom inside the picture area", () => {
  const window: Rect = [200, 100, 800, 500];
  const screen: Rect = [0, 0, 1920, 1080];
  const custom: Rect = [450, 250, 200, 150];

  it("stays inside the window, the screen or the chosen area, around the click", () => {
    for (const [crop, area] of [[null, window], [screen, screen], [custom, custom]] as [Rect | null, Rect][]) {
      const d = guide();
      const view = viewRect(step(), { ...first(d), crop, zoom: true }, d);
      expect(within(view, area), JSON.stringify(view)).toBe(true);
      // It is a zoom: at most 60 percent of the area, with the click in it.
      expect(view[2]).toBeLessThanOrEqual(Math.round(area[2] * 0.6));
      expect(500 >= view[0] && 500 <= view[0] + view[2] && 300 >= view[1] && 300 <= view[1] + view[3]).toBe(true);
    }
    // On the whole screen the recorded size fits and is centred on the click.
    expect(viewRect(step(), { ...first(guide()), crop: screen, zoom: true }, guide())).toEqual([180, 100, 640, 400]);
  });

  it("moves to the edge of an area that does not hold the click", () => {
    expect(zoomInside([0, 0, 100, 100], false, [50, 50], [500, 400, 400, 300])).toEqual([500, 400, 100, 100]);
  });

  it("uses a drawn zoom area where it was drawn, cut to the picture area", () => {
    expect(zoomInside([300, 200, 100, 80], true, [900, 900], window)).toEqual([300, 200, 100, 80]);
    const wide = zoomInside([0, 0, 1600, 400], true, [500, 300], window);
    expect(within(wide, window)).toBe(true);
    expect(wide[2] / wide[3]).toBeCloseTo(4, 1);
    expect(zoomInside([950, 560, 200, 100], true, [0, 0], window)).toEqual([800, 500, 200, 100]);
  });

  it("has the frame's shape in a picture frame, so filling the frame takes in nothing outside the zoom", () => {
    const framed = guide({ template: { ...BASIC, frame: { ...BASIC.frame, ratio: "1:1" } } });
    for (const crop of [null, custom]) {
      const f = framing(step(), { ...first(framed), crop, zoom: true }, framed);
      expect(within(f.view, crop ?? window), JSON.stringify(f.view)).toBe(true);
      expect(f.view[2]).toBe(f.view[3]);
    }
  });
});

describe("the guide's zoom default and a step's own setting", () => {
  it("follows the guide until the step has a setting of its own, which then wins", () => {
    const b = first(guide());
    expect(zoomOn(b, { zoomDefault: true })).toBe(true);
    expect(zoomOn(b, { zoomDefault: false })).toBe(false);
    expect(zoomOn({ ...b, zoom: false }, { zoomDefault: true })).toBe(false);
    expect(zoomOn({ ...b, zoom: true }, { zoomDefault: false })).toBe(true);
  });

  it("says which of the two the selected steps use", () => {
    const b = first(guide());
    expect(zoomChoice([b])).toBe("default");
    expect(zoomChoice([{ ...b, zoom: true }])).toBe("on");
    expect(zoomChoice([{ ...b, zoom: false }])).toBe("off");
    expect(zoomChoice([b, { ...b, zoom: true }])).toBe("mixed");
  });

  it("changes only the steps without a setting of their own, and makes their place in the frame anew", () => {
    const frame = { cx: 600, cy: 350, w: 800 };
    const base = guide();
    const d: GuideDoc = { ...base, blocks: [{ ...first(base), frame }, { ...first(base), id: "own", zoom: false, frame }, { ...first(base), id: "typing", n: 2, frame }] };
    const steps = new Map([
      [1, step()],
      [2, step({ n: 2, kind: "type", click: null })],
    ]);
    const on = setZoomDefault(d, true, steps);
    expect(on.zoomDefault).toBe(true);
    expect(on.blocks.map((b) => (b as StepBlock).frame ?? null)).toEqual([null, frame, frame]);
    expect(on.blocks.map((b) => zoomOn(b as StepBlock, on))).toEqual([true, false, true]);
  });
});
