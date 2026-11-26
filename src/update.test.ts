import { describe, expect, it } from "vitest";
import type { UpdatePhase, UpdateView } from "./ipc";
import { en } from "./locales/en";
import { dismissKey, quitWording, showsNotice, updateMessage } from "./update";

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

  it("asks about unsaved work in its own words, not as Quit does", () => {
    const quit = quitWording(false);
    const update = quitWording(true);
    expect(en[update.title]).toBe("Update now?");
    expect(en[update.cancel]).toBe("Later");
    expect(en[update.discard]).toBe("Update without saving");
    expect(en[quit.title]).toBe("Quit without saving?");
    for (const k of ["title", "body", "cancel", "discard"] as const) expect(update[k]).not.toBe(quit[k]);
  });

  it("has a sentence for every phase", () => {
    expect(updateMessage({ kind: "idle" })).toBeNull();
    expect(updateMessage({ kind: "upToDate" })).toEqual({ key: "update.upToDate" });
    expect(updateMessage({ kind: "downloading", version: "1", percent: null })?.key).toBe("update.preparing");
    expect(updateMessage({ kind: "downloading", version: "1", percent: 0 })).toEqual({ key: "update.downloading", vars: { version: "1", percent: 0 } });
    expect(updateMessage({ kind: "failed", version: "1" })).toEqual({ key: "update.failed", vars: { version: "1" } });
  });
});
