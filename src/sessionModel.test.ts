import { describe, expect, it } from "vitest";
import type { Capture, Session } from "./ipc";
import {
  activeAfterDelete,
  activeAfterDeleting,
  deleteTargets,
  fitZoom,
  formatSize,
  formatTime,
  groupOrFirst,
  pruneSelection,
  selectAll,
  sortCaptures,
  toggled,
  totalCaptures,
  validActive,
  zoomIn,
  zoomOut,
} from "./sessionModel";

const cap = (id: string, createdAt: number): Capture => ({
  id,
  name: id,
  createdAt,
  file: `images/${id}.png`,
  thumbnail: null,
  width: 100,
  height: 50,
  sourceWindowTitle: null,
  annotations: null,
});

const session: Session = {
  id: "s",
  createdAt: 0,
  updatedAt: 0,
  groups: [
    { id: "g1", name: "Group 1", order: 0, captures: [cap("a", 30), cap("b", 10), cap("c", 20)] },
    { id: "g2", name: "Group 2", order: 1, captures: [cap("d", 5)] },
  ],
};

describe("sortCaptures", () => {
  const list = session.groups[0].captures;
  it("keeps the stored order for custom order", () => {
    expect(sortCaptures(list, "custom").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts newest and oldest first without changing the input", () => {
    expect(sortCaptures(list, "newest").map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(sortCaptures(list, "oldest").map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(list.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("groups and selection", () => {
  it("falls back to the first group", () => {
    expect(groupOrFirst(session, "g2").id).toBe("g2");
    expect(groupOrFirst(session, "gone").id).toBe("g1");
    expect(groupOrFirst(session, null).id).toBe("g1");
  });
  it("toggles without mutating", () => {
    const one = toggled(new Set(), "a");
    expect([...one]).toEqual(["a"]);
    expect([...toggled(one, "a")]).toEqual([]);
    expect(one.has("a")).toBe(true);
  });
  it("selects all captures given", () => {
    expect(selectAll(session.groups[0].captures).size).toBe(3);
    expect(selectAll([]).size).toBe(0);
  });
  it("prunes ids that no longer exist, keeping selections from other groups", () => {
    const pruned = pruneSelection(new Set(["a", "d", "zzz"]), session);
    expect([...pruned].sort()).toEqual(["a", "d"]);
    const same = new Set(["a"]);
    expect(pruneSelection(same, session)).toBe(same);
  });
  it("counts all captures", () => {
    expect(totalCaptures(session)).toBe(4);
  });
});

describe("active capture", () => {
  it("moves to the next, else the previous, after a delete", () => {
    expect(activeAfterDelete(["a", "b", "c"], "b")).toBe("c");
    expect(activeAfterDelete(["a", "b", "c"], "c")).toBe("b");
    expect(activeAfterDelete(["a"], "a")).toBeNull();
    expect(activeAfterDelete(["a", "b"], "x")).toBe("a");
    expect(activeAfterDelete([], "x")).toBeNull();
  });
  it("keeps a valid active id and replaces a missing one", () => {
    expect(validActive(["a", "b"], "b")).toBe("b");
    expect(validActive(["a", "b"], "gone")).toBe("a");
    expect(validActive(["a", "b"], null)).toBe("a");
    expect(validActive([], "a")).toBeNull();
  });
});

describe("formatting", () => {
  const now = new Date(2026, 10, 17, 15, 0, 0).getTime();
  it("shows only the time for today", () => {
    const t = new Date(2026, 10, 17, 14, 5, 9).getTime();
    expect(formatTime(t, "en-GB", now)).toBe("14:05:09");
  });
  it("shows the date for other days", () => {
    const t = new Date(2026, 10, 16, 14, 5, 9).getTime();
    expect(formatTime(t, "en-GB", now)).toContain("16");
    expect(formatTime(t, "en-GB", now)).toContain("14:05");
  });
  it("formats the pixel size", () => {
    expect(formatSize(1920, 1080)).toBe("1920 × 1080 px");
  });
});

describe("zoom", () => {
  it("steps up and down and stays within the range", () => {
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomIn(4)).toBe(4);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(0.1)).toBe(0.1);
  });
  it("steps from a fit zoom that is between two steps", () => {
    expect(zoomIn(0.42)).toBe(0.5);
    expect(zoomOut(0.42)).toBe(0.33);
  });
  it("fits an image into a box but never enlarges", () => {
    expect(fitZoom({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5);
    expect(fitZoom({ width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(1);
    expect(fitZoom({ width: 0, height: 0 }, { width: 10, height: 10 })).toBe(1);
  });
});

describe("deleteTargets", () => {
  const none = new Set<string>();
  it("deletes all selected captures, in session order", () => {
    expect(deleteTargets(session, new Set(["d", "a"]), "b")).toEqual(["a", "d"]);
  });
  it("deletes the capture on show when nothing is selected", () => {
    expect(deleteTargets(session, none, "c")).toEqual(["c"]);
    expect(deleteTargets(session, none, null)).toEqual([]);
  });
  it("a trash icon on a selected card means the selection, on another card only that card", () => {
    const sel = new Set(["a", "b", "d"]);
    expect(deleteTargets(session, sel, "c", "b")).toEqual(["a", "b", "d"]);
    expect(deleteTargets(session, sel, "c", "c")).toEqual(["c"]);
    expect(deleteTargets(session, none, "a", "c")).toEqual(["c"]);
  });
  it("ignores selected ids that no longer exist", () => {
    expect(deleteTargets(session, new Set(["zzz"]), "c")).toEqual(["c"]);
  });
});

describe("activeAfterDeleting", () => {
  it("keeps the active capture when it stays", () => {
    expect(activeAfterDeleting(["a", "b", "c"], new Set(["c"]), "a")).toBe("a");
  });
  it("moves to the next remaining capture, else the last one", () => {
    expect(activeAfterDeleting(["a", "b", "c", "d"], new Set(["b", "c"]), "b")).toBe("d");
    expect(activeAfterDeleting(["a", "b", "c"], new Set(["b", "c"]), "c")).toBe("a");
    expect(activeAfterDeleting(["a"], new Set(["a"]), "a")).toBeNull();
  });
});
