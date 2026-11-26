import { describe, expect, it } from "vitest";
import { hasRecordingGroup, isRecordingGroup, mergeGroupOrder } from "./recordingGroups";

const g = (id: string, kind?: "recording") => ({ id, kind: kind ?? null });

describe("screenshot and recording groups", () => {
  const all = [g("a"), g("r1", "recording"), g("b"), g("r2", "recording"), g("c")];
  it("are told apart by their kind, and sessions of earlier versions (no kind) hold screenshots", () => {
    expect(all.map(isRecordingGroup)).toEqual([false, true, false, true, false]);
    expect(isRecordingGroup({ kind: undefined })).toBe(false);
  });
  it("a reordered kind takes its places in the full order and the other kind stays put", () => {
    expect(mergeGroupOrder(all, ["c", "a", "b"])).toEqual(["c", "r1", "a", "r2", "b"]);
    expect(mergeGroupOrder(all, ["r2", "r1"])).toEqual(["a", "r2", "b", "r1", "c"]);
    expect(mergeGroupOrder(all, ["a", "b", "c"])).toEqual(["a", "r1", "b", "r2", "c"]);
  });
  it("knows whether a recording group exists", () => {
    expect(hasRecordingGroup(all)).toBe(true);
    expect(hasRecordingGroup([g("a")])).toBe(false);
    expect(hasRecordingGroup([])).toBe(false);
  });
});
