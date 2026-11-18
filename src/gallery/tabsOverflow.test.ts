import { describe, expect, it } from "vitest";
import { fadeEdges } from "./tabsOverflow";

describe("the fade edges of the tab strip", () => {
  it("are off when everything fits", () => {
    expect(fadeEdges({ scrollStart: 0, client: 400, scroll: 400 })).toEqual({ start: false, end: false, overflow: false });
    expect(fadeEdges({ scrollStart: 0, client: 400, scroll: 300 }).overflow).toBe(false);
  });

  it("show the end edge at the start of the strip", () => {
    expect(fadeEdges({ scrollStart: 0, client: 300, scroll: 800 })).toEqual({ start: false, end: true, overflow: true });
  });

  it("show both edges in the middle", () => {
    expect(fadeEdges({ scrollStart: 200, client: 300, scroll: 800 })).toEqual({ start: true, end: true, overflow: true });
  });

  it("show the start edge at the end of the strip", () => {
    expect(fadeEdges({ scrollStart: 500, client: 300, scroll: 800 })).toEqual({ start: true, end: false, overflow: true });
  });

  it("treat a negative scroll position (right-to-left) like a positive one", () => {
    expect(fadeEdges({ scrollStart: -200, client: 300, scroll: 800 })).toEqual({ start: true, end: true, overflow: true });
    expect(fadeEdges({ scrollStart: 0, client: 300, scroll: 800 }).start).toBe(false);
  });

  it("ignore sub-pixel differences", () => {
    expect(fadeEdges({ scrollStart: 0.4, client: 300, scroll: 300.6 }).overflow).toBe(false);
    expect(fadeEdges({ scrollStart: 499.5, client: 300, scroll: 800 }).end).toBe(false);
  });
});
