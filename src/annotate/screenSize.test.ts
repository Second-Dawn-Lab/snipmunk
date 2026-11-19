import { describe, expect, it } from "vitest";
import { defaultSettings } from "../settings/defaults";
import { emojiImageSize, imagePatch, imageValues, toImagePx, toScreenPx } from "./screenSize";
import { newPen, newText, pickValues } from "./styles";

describe("screen sizes", () => {
  it("a 16 px text is 16 px on the screen whatever the capture size", () => {
    // A small capture shown at 200 %, and a 4K capture shown at 25 %.
    expect(toScreenPx(toImagePx(16, 2), 2)).toBe(16);
    expect(toImagePx(16, 2)).toBe(8);
    expect(toImagePx(16, 0.25)).toBe(64);
    expect(toScreenPx(toImagePx(16, 0.25), 0.25)).toBe(16);
  });
  it("converts the sizes of the tool values and leaves colours alone", () => {
    const v = imageValues(pickValues({ ...defaultSettings, lastTextSize: 16, lastPenSize: 4 }), 0.5);
    expect(v.lastTextSize).toBe(32);
    expect(v.lastPenSize).toBe(8);
    expect(v.lastTextColor).toBe(defaultSettings.lastTextColor);
  });
  it("makes marks with picture sizes", () => {
    const v = imageValues(pickValues({ ...defaultSettings, lastTextSize: 16, lastPenSize: 3 }), 4);
    expect(newText({ x: 0, y: 0 }, v).fontSize).toBe(4);
    expect(newPen([0, 0, 1], v).size).toBe(0.8);
  });
  it("converts a restyle patch, only the sizes", () => {
    expect(imagePatch({ lastTextSize: 20, lastTextColor: "#fff" }, 2)).toEqual({ lastTextSize: 10, lastTextColor: "#fff" });
    expect(imagePatch({ lastTextBackground: true }, 2)).toEqual({ lastTextBackground: true });
  });
  it("survives a zoom of 0 or NaN and gives an emoji a sensible size", () => {
    expect(toImagePx(16, 0)).toBe(16);
    expect(toImagePx(16, NaN)).toBe(16);
    expect(emojiImageSize(0.5)).toBe(80);
    expect(emojiImageSize(1000)).toBe(4);
  });
});
