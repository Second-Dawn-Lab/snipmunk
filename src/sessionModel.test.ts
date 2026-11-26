import { describe, expect, it } from "vitest";
import type { Capture, Session } from "./ipc";
import {
  activeAfterDeleting,
  deleteTargets,
  formatSize,
  formatTime,
  groupOrFirst,
  sortCaptures,
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
  thumbSize: 0,
  thumbRev: 0,
  width: 100,
  height: 50,
  sourceWindowTitle: null,
  source: null,
  annotations: null,
});

const session: Session = {
  id: "s",
  createdAt: 0,
  updatedAt: 0,
  groups: [
    { id: "g1", name: "Group 1", order: 0, color: null, emoji: null, captures: [cap("a", 30), cap("b", 10), cap("c", 20)] },
    { id: "g2", name: "Group 2", order: 1, color: null, emoji: null, captures: [cap("d", 5)] },
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

describe("groups", () => {
  it("falls back to the first group", () => {
    expect(groupOrFirst(session, "g2").id).toBe("g2");
    expect(groupOrFirst(session, "gone").id).toBe("g1");
    expect(groupOrFirst(session, null).id).toBe("g1");
  });
});

describe("active capture", () => {
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
