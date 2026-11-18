import { describe, expect, it } from "vitest";
import { placePopover, type PopoverInput } from "./popoverPlacement";

const base: PopoverInput = {
  trigger: { left: 100, top: 50, right: 140, bottom: 80 },
  panel: { width: 200, height: 150 },
  viewport: { width: 800, height: 600 },
  align: "start",
  rtl: false,
};

describe("placePopover", () => {
  it("opens below the trigger, lined up with its start edge", () => {
    const p = placePopover(base);
    expect(p.left).toBe(100);
    expect(p.top).toBe(86);
    expect(p.flipUp).toBe(false);
  });

  it("lines up with the end edge when asked (kept inside the window)", () => {
    expect(placePopover({ ...base, align: "end" }).left).toBe(8);
    const far = { left: 500, top: 50, right: 540, bottom: 80 };
    expect(placePopover({ ...base, trigger: far, align: "end" }).left).toBe(340);
  });

  it("mirrors start and end in right-to-left layouts", () => {
    const t = { left: 500, top: 50, right: 540, bottom: 80 };
    expect(placePopover({ ...base, trigger: t, align: "start", rtl: false }).left).toBe(500);
    expect(placePopover({ ...base, trigger: t, align: "start", rtl: true }).left).toBe(340);
    expect(placePopover({ ...base, trigger: t, align: "end", rtl: true }).left).toBe(500);
  });

  it("centers on the trigger", () => {
    expect(placePopover({ ...base, align: "center" }).left).toBe(20);
  });

  it("is shifted to stay inside the window", () => {
    const right = placePopover({ ...base, trigger: { left: 760, top: 50, right: 790, bottom: 80 } });
    expect(right.left).toBe(800 - 8 - 200);
    const left = placePopover({ ...base, trigger: { left: 0, top: 50, right: 30, bottom: 80 }, align: "end" });
    expect(left.left).toBe(8);
  });

  it("opens upwards when there is more room above", () => {
    const p = placePopover({ ...base, trigger: { left: 100, top: 500, right: 140, bottom: 530 } });
    expect(p.flipUp).toBe(true);
    expect(p.top).toBe(500 - 6 - 150);
  });

  it("stays below when it fits, even near the bottom", () => {
    const p = placePopover({ ...base, trigger: { left: 100, top: 400, right: 140, bottom: 430 } });
    expect(p.flipUp).toBe(false);
  });

  it("shrinks a tall popover to the room it has", () => {
    const p = placePopover({ ...base, panel: { width: 200, height: 900 } });
    expect(p.maxHeight).toBe(600 - 80 - 6 - 8);
    const small = placePopover({ ...base, panel: { width: 200, height: 900 }, viewport: { width: 800, height: 120 } });
    expect(small.maxHeight).toBe(80);
  });

  it("never gets wider than the window", () => {
    const p = placePopover({ ...base, panel: { width: 2000, height: 100 }, viewport: { width: 300, height: 600 } });
    expect(p.maxWidth).toBe(284);
    expect(p.left).toBe(8);
  });
});
