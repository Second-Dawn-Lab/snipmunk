import { describe, expect, it } from "vitest";
import type { GuideStep } from "../ipc";
import { applyArea, areaOf, grow } from "./areas";
import type { StepBlock } from "./model";

const step: GuideStep = { n: 1, kind: "click", t: 0, image: "s.png", imageSize: [1000, 600], click: [500, 300], window: { rect: [100, 100, 400, 300], title: "W", process: "p" }, zoom: null, text: [], deleted: false };
const block = (crop?: StepBlock["crop"]): StepBlock => ({ id: "b", type: "step", n: 1, crop });

describe("picture area of a step", () => {
  it("knows which choice a step has", () => {
    expect(areaOf(step, block())).toBe("default");
    expect(areaOf(step, block([0, 0, 1000, 600]))).toBe("screen");
    expect(areaOf(step, block([100, 100, 400, 300]))).toBe("window");
    expect(areaOf(step, block([10, 10, 50, 50]))).toBe("custom");
  });
  it("says after reopening what the file named, until another choice is made", () => {
    // (an opened file: the stored picture is the chosen area, its crop the whole of it)
    const opened = { ...block([0, 0, 1000, 600]), areaChoice: "custom" as const };
    expect(areaOf(step, opened)).toBe("custom");
    expect(areaOf(step, { ...opened, areaChoice: "window" })).toBe("window");
    expect(areaOf(step, { ...opened, crop: [10, 10, 50, 50] })).toBe("custom");
    expect(areaOf(step, { ...opened, crop: null })).toBe("default");
    let got: Partial<StepBlock> = {};
    applyArea(step, opened, "screen", (c) => (got = c));
    expect(areaOf(step, { ...opened, ...got })).toBe("screen");
  });
  it("applies a choice as a crop; the guide default is no crop (so it follows the guide)", () => {
    let got: Partial<StepBlock> = {};
    const patch = (c: Partial<StepBlock>) => (got = c);
    applyArea(step, block([10, 10, 50, 50]), "default", patch);
    expect(got.crop).toBeNull();
    applyArea(step, block(), "screen", patch);
    expect(got.crop).toEqual([0, 0, 1000, 600]);
    applyArea(step, block(), "window", patch);
    expect(got.crop).toEqual([100, 100, 400, 300]);
  });
  it("expands by 25% and 50% around the centre, never outside the picture", () => {
    expect(grow([100, 100, 400, 300], 0.25, [1000, 600])).toEqual([50, 63, 500, 375]);
    expect(grow([100, 100, 400, 300], 0.5, [1000, 600])).toEqual([0, 25, 600, 450]);
    expect(grow([0, 0, 900, 500], 0.5, [1000, 600])).toEqual([0, 0, 1000, 600]);
    let got: Partial<StepBlock> = {};
    applyArea(step, block(), "grow25", (c) => (got = c));
    expect(got.crop).toEqual([50, 63, 500, 375]);
  });
});
