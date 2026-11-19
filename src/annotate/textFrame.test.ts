import { describe, expect, it } from "vitest";
import { frameZone, grabInPicture, TEXT_GRAB_PX } from "./textFrame";

const box = { x: 100, y: 100, w: 200, h: 40, rotation: 0 };

describe("the grab zone of a text box", () => {
  it("inside the box is the text, a band of 8 px around it is the border, farther is outside", () => {
    expect(frameZone(box, { x: 200, y: 120 }, 8)).toBe("inside");
    expect(frameZone(box, { x: 96, y: 120 }, 8)).toBe("border");
    expect(frameZone(box, { x: 308, y: 120 }, 8)).toBe("border");
    expect(frameZone(box, { x: 200, y: 92 }, 8)).toBe("border");
    expect(frameZone(box, { x: 200, y: 148 }, 8)).toBe("border");
    expect(frameZone(box, { x: 200, y: 91 }, 8)).toBe("outside");
    expect(frameZone(box, { x: 309, y: 120 }, 8)).toBe("outside");
    expect(frameZone(box, { x: 96, y: 96 }, 8)).toBe("border");
  });
  it("is as wide on the screen at any zoom", () => {
    expect(grabInPicture(1)).toBe(TEXT_GRAB_PX);
    expect(grabInPicture(0.25)).toBe(32);
    expect(grabInPicture(4)).toBe(2);
    expect(frameZone(box, { x: 90, y: 120 }, grabInPicture(0.25))).toBe("border");
    expect(frameZone(box, { x: 90, y: 120 }, grabInPicture(4))).toBe("outside");
    expect(grabInPicture(0)).toBeGreaterThan(0);
  });
  it("turns with the box about its anchor", () => {
    const turned = { ...box, rotation: Math.PI / 2 };
    // Turned a quarter: the 200 px width now runs downwards from the anchor, the height to the left.
    expect(frameZone(turned, { x: 80, y: 200 }, 8)).toBe("inside");
    expect(frameZone(turned, { x: 200, y: 120 }, 8)).toBe("outside");
    expect(frameZone(turned, { x: 104, y: 200 }, 8)).toBe("border");
    expect(frameZone(turned, { x: 90, y: 305 }, 8)).toBe("border");
  });
  it("a box that is turned half way round still has its zone", () => {
    const flipped = { ...box, rotation: Math.PI };
    expect(frameZone(flipped, { x: 0, y: 80 }, 8)).toBe("inside");
    expect(frameZone(flipped, { x: 200, y: 120 }, 8)).toBe("outside");
  });
});

import { editBoxSize } from "./textFrame";
describe("the frame of the text being edited follows its text area", () => {
  it("takes the size of the text area in picture pixels at any zoom, a fixed width stays", () => {
    expect(editBoxSize({ w: 0 }, { w: 200, h: 40 }, 2)).toEqual({ w: 100, h: 20 });
    expect(editBoxSize({ w: 150, fixedWidth: true }, { w: 200, h: 60 }, 0.5)).toEqual({ w: 150, h: 120 });
    expect(editBoxSize({ w: 0 }, { w: 10, h: 10 }, 0)).toEqual({ w: 1000, h: 1000 });
  });
});
