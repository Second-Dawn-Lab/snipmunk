import { describe, expect, it } from "vitest";
import type { Group } from "./ipc";
import {
  activeAfterGroupDelete,
  canDeleteGroup,
  defaultMoveTarget,
  GROUP_COLORS,
  GROUP_EMOJIS,
  isGroupColor,
  moveTargets,
  planGroupDelete,
} from "./groupRules";

const group = (id: string, count = 0): Group => ({
  id,
  name: id,
  order: 0,
  color: null,
  emoji: null,
  captures: Array.from({ length: count }, (_, i) => ({
    id: `${id}-${i}`,
    name: "x",
    createdAt: 0,
    file: "",
    thumbnail: null,
    thumbSize: 0,
    thumbRev: 0,
    width: 1,
    height: 1,
    sourceWindowTitle: null,
    source: null,
    annotations: null,
  })),
});
const groups = [group("g1", 2), group("g2"), group("g3", 1)];

describe("the colour and emoji lists", () => {
  it("have 9 colours and 12 emoji, each once", () => {
    expect(GROUP_COLORS).toHaveLength(9);
    expect(new Set(GROUP_COLORS).size).toBe(9);
    expect(GROUP_EMOJIS).toHaveLength(12);
    expect(new Set(GROUP_EMOJIS).size).toBe(12);
  });
  it("recognise their colours", () => {
    expect(isGroupColor("teal")).toBe(true);
    expect(isGroupColor("#ff0000")).toBe(false);
    expect(isGroupColor(null)).toBe(false);
  });
});

describe("deleting a group", () => {
  it("is possible unless it is the last one", () => {
    expect(canDeleteGroup(groups)).toBe(true);
    expect(canDeleteGroup([groups[0]])).toBe(false);
    expect(canDeleteGroup([])).toBe(false);
  });

  it("offers every other group as the place for the captures", () => {
    expect(moveTargets(groups, "g2").map((g) => g.id)).toEqual(["g1", "g3"]);
  });

  it("preselects the next tab, or the previous one for the last tab", () => {
    expect(defaultMoveTarget(groups, "g1")).toBe("g2");
    expect(defaultMoveTarget(groups, "g3")).toBe("g2");
    expect(defaultMoveTarget([groups[0]], "g1")).toBeNull();
    expect(defaultMoveTarget(groups, "nope")).toBe("g1");
  });

  it("plans a delete with the captures, or a move to another group", () => {
    expect(planGroupDelete(groups, "g1", { mode: "delete" })).toEqual({ ok: true, moveTo: null });
    expect(planGroupDelete(groups, "g1", { mode: "move", targetId: "g3" })).toEqual({ ok: true, moveTo: "g3" });
  });

  it("refuses the last group, an unknown group and a bad target", () => {
    expect(planGroupDelete([groups[0]], "g1", { mode: "delete" })).toEqual({ ok: false, reason: "last" });
    expect(planGroupDelete(groups, "zz", { mode: "delete" })).toEqual({ ok: false, reason: "unknown" });
    expect(planGroupDelete(groups, "g1", { mode: "move", targetId: "g1" })).toEqual({ ok: false, reason: "target" });
    expect(planGroupDelete(groups, "g1", { mode: "move", targetId: "zz" })).toEqual({ ok: false, reason: "target" });
  });

  it("shows another tab only when the shown one was deleted", () => {
    expect(activeAfterGroupDelete(groups, "g1", "g3", null)).toBe("g3");
    expect(activeAfterGroupDelete(groups, "g1", "g1", "g3")).toBe("g3");
    expect(activeAfterGroupDelete(groups, "g3", "g3", null)).toBe("g2");
  });
});
