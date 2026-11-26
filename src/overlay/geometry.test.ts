import { describe, expect, it } from "vitest";
import {
  boxToCss,
  clipToMonitor,
  dragBox,
  hitTestWindow,
  loupePlacement,
  loupeSource,
  modeForKey,
  pixelRatio,
  readoutPosition,
  sizeLabel,
  thin,
  toDesktop,
  toPhysical,
  windowToLocal,
  type WinInfo,
} from "./geometry";

describe("pixel ratio on monitors with different scaling", () => {
  it("is 1 on a 100 % monitor and 1.5 on a 150 % one", () => {
    expect(pixelRatio({ w: 1920, h: 1080 }, { w: 1920, h: 1080 })).toEqual({ x: 1, y: 1 });
    expect(pixelRatio({ w: 2880, h: 1620 }, { w: 1920, h: 1080 })).toEqual({ x: 1.5, y: 1.5 });
  });

  it("follows the real sizes when they disagree by a rounded pixel", () => {
    const r = pixelRatio({ w: 2560, h: 1440 }, { w: 1706, h: 960 });
    expect(r.x).toBeCloseTo(1.5006, 3);
    const p = toPhysical({ x: 1706, y: 960 }, r);
    expect(p.x).toBeCloseTo(2560, 6);
    expect(p.y).toBeCloseTo(1440, 6);
  });

  it("falls back to 1 for an empty viewport", () => {
    expect(pixelRatio({ w: 100, h: 100 }, { w: 0, h: 0 })).toEqual({ x: 1, y: 1 });
  });

  it("converts back and forth", () => {
    const ratio = { x: 1.5, y: 1.5 };
    const p = toPhysical({ x: 100, y: 40 }, ratio);
    expect(p).toEqual({ x: 150, y: 60 });
    expect(boxToCss({ x: 150, y: 60, w: 300, h: 150 }, ratio)).toEqual({ x: 100, y: 40, w: 200, h: 100 });
  });
});

describe("dragBox", () => {
  const monitor = { w: 1920, h: 1080 };
  it("is the same whichever way the drag goes", () => {
    const want = { x: 10, y: 20, w: 100, h: 50 };
    expect(dragBox({ x: 10, y: 20 }, { x: 110, y: 70 }, monitor)).toEqual(want);
    expect(dragBox({ x: 110, y: 70 }, { x: 10, y: 20 }, monitor)).toEqual(want);
    expect(dragBox({ x: 110, y: 20 }, { x: 10, y: 70 }, monitor)).toEqual(want);
  });

  it("stays on the monitor", () => {
    expect(dragBox({ x: 1900, y: 1000 }, { x: 2500, y: 1300 }, monitor)).toEqual({ x: 1900, y: 1000, w: 20, h: 80 });
    expect(dragBox({ x: -50, y: -50 }, { x: 30, y: 30 }, monitor)).toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });

  it("drops accidental clicks", () => {
    expect(dragBox({ x: 5, y: 5 }, { x: 6, y: 80 }, monitor)).toBeNull();
    expect(dragBox({ x: 5, y: 5 }, { x: 5, y: 5 }, monitor)).toBeNull();
  });

  it("rounds to whole physical pixels", () => {
    expect(dragBox({ x: 10.4, y: 10.4 }, { x: 50.6, y: 50.6 }, monitor)).toEqual({ x: 10, y: 10, w: 41, h: 41 });
  });
});

describe("size readout", () => {
  it("is in physical pixels", () => {
    expect(sizeLabel({ w: 640, h: 360 })).toBe("640 × 360");
    expect(sizeLabel({ w: 640.4, h: 359.6 })).toBe("640 × 360");
  });

  it("sits below the selection, or above when there is no room, and stays on screen", () => {
    const label = { w: 90, h: 24 };
    const vp = { w: 1000, h: 600 };
    expect(readoutPosition({ x: 100, y: 100, w: 300, h: 100 }, label, vp)).toEqual({ x: 310, y: 208 });
    expect(readoutPosition({ x: 100, y: 450, w: 300, h: 140 }, label, vp)).toEqual({ x: 310, y: 418 });
    expect(readoutPosition({ x: 0, y: 0, w: 1000, h: 600 }, label, vp)).toEqual({ x: 910, y: 568 });
    expect(readoutPosition({ x: 0, y: 100, w: 20, h: 20 }, label, vp).x).toBe(0);
  });
});

describe("windows", () => {
  const windows: WinInfo[] = [
    { hwnd: 1, title: "front", rect: { x: 2000, y: 100, w: 400, h: 300 } },
    { hwnd: 2, title: "back", rect: { x: 1800, y: 0, w: 1000, h: 700 } },
  ];
  const second = { x: 1920, y: -200 }; // a monitor right of and above the first one

  it("finds the topmost window under a pointer on the second monitor", () => {
    const desktop = toDesktop({ x: 100, y: 350 }, second);
    expect(desktop).toEqual({ x: 2020, y: 150 });
    expect(hitTestWindow(windows, desktop)?.hwnd).toBe(1);
    expect(hitTestWindow(windows, { x: 1850, y: 50 })?.hwnd).toBe(2);
    expect(hitTestWindow(windows, { x: 10, y: 10 })).toBeNull();
    expect(hitTestWindow(windows, { x: 2400, y: 150 })?.hwnd).toBe(2); // the right edge belongs to the next pixel
  });

  it("gives a window's rectangle relative to the monitor, even when it reaches over the edge", () => {
    expect(windowToLocal(windows[1], second)).toEqual({ x: -120, y: 200, w: 1000, h: 700 });
  });

  it("clips the highlight to the monitor", () => {
    expect(clipToMonitor({ x: -120, y: 200, w: 1000, h: 700 }, { w: 2880, h: 1620 })).toEqual({
      x: 0,
      y: 200,
      w: 880,
      h: 700,
    });
    expect(clipToMonitor({ x: 3000, y: 0, w: 10, h: 10 }, { w: 2880, h: 1620 })).toBeNull();
  });
});

describe("modes and keys", () => {
  it("keys 1 to 4 pick rectangle, window, full screen and freeform", () => {
    expect(["1", "2", "3", "4", "5"].map(modeForKey)).toEqual(["rectangle", "window", "fullscreen", "freeform", "scrolling"]);
    expect(modeForKey("6")).toBeNull();
    expect(modeForKey("a")).toBeNull();
  });
});

describe("freeform path", () => {
  it("drops points that are too close to the last one", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      { x: 3.5, y: 0.5 },
      { x: 10, y: 0 },
    ];
    expect(thin(pts, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(thin([], 3)).toEqual([]);
  });
});

describe("magnifier", () => {
  const vp = { w: 1000, h: 600 };
  it("sits down-right of the pointer and flips near the edges", () => {
    expect(loupePlacement({ x: 100, y: 100 }, 120, vp)).toEqual({ x: 124, y: 124 });
    expect(loupePlacement({ x: 950, y: 100 }, 120, vp)).toEqual({ x: 806, y: 124 });
    expect(loupePlacement({ x: 100, y: 580 }, 120, vp)).toEqual({ x: 124, y: 436 });
    expect(loupePlacement({ x: 990, y: 590 }, 120, vp)).toEqual({ x: 846, y: 446 });
  });

  it("never leaves the screen even in a tiny viewport", () => {
    expect(loupePlacement({ x: 50, y: 50 }, 120, { w: 100, h: 100 })).toEqual({ x: 0, y: 0 });
  });

  it("shows a square of the screenshot centred on the pointer, clamped at the edges", () => {
    const img = { w: 2880, h: 1620 };
    expect(loupeSource({ x: 1000.7, y: 500.2 }, 15, img)).toEqual({ x: 993, y: 493, w: 15, h: 15 });
    expect(loupeSource({ x: 2, y: 2 }, 15, img)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(loupeSource({ x: 2879, y: 1619 }, 15, img)).toEqual({ x: 2865, y: 1605, w: 15, h: 15 });
  });
});
