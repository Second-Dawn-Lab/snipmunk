import { describe, expect, it } from "vitest";
import type { UpdatePhase, UpdateView } from "./ipc";
import { dismissKey, showsNotice, updateMessage } from "./update";

const view = (phase: UpdatePhase, supported = true): UpdateView => ({ supported, phase });

describe("the update notice", () => {
  it("stays away unless there is a version to tell about", () => {
    for (const kind of ["idle", "checking", "upToDate", "offline", "noRelease"] as const) {
      expect(showsNotice(view({ kind }), null)).toBe(false);
    }
    expect(showsNotice(view({ kind: "available", version: "0.1.1" }), null)).toBe(true);
    expect(showsNotice(view({ kind: "available", version: "0.1.1" }, false), null)).toBe(false);
  });

  it("is put away by Later until something else happens", () => {
    const found: UpdatePhase = { kind: "available", version: "0.1.1" };
    const later = dismissKey(found);
    expect(showsNotice(view(found), later)).toBe(false);
    expect(showsNotice(view({ kind: "available", version: "0.1.2" }), later)).toBe(true);
    expect(showsNotice(view({ kind: "downloading", version: "0.1.1", percent: 5 }), later)).toBe(true);
    expect(showsNotice(view({ kind: "ready", version: "0.1.1" }), later)).toBe(true);
  });

  it("has a sentence for every phase", () => {
    expect(updateMessage({ kind: "idle" })).toBeNull();
    expect(updateMessage({ kind: "upToDate" })).toEqual({ key: "update.upToDate" });
    expect(updateMessage({ kind: "downloading", version: "1", percent: null })?.key).toBe("update.preparing");
    expect(updateMessage({ kind: "downloading", version: "1", percent: 0 })).toEqual({ key: "update.downloading", vars: { version: "1", percent: 0 } });
    expect(updateMessage({ kind: "failed", version: "1" })).toEqual({ key: "update.failed", vars: { version: "1" } });
  });
});
