// 7.5-C5: the File menu of the three modes, and what happens to "Template for new guides" when a template is deleted.
import { describe, expect, it } from "vitest";
import { newGuideTemplateAfterDelete } from "../docs/template/model";
import { RECENT, guideEntries, recordingEntries, screenshotEntries, withClose, type FileEntry } from "./fileEntries";

const t = ((key: string) => key) as unknown as Parameters<typeof screenshotEntries>[0];
const nothing = () => undefined;
/** The entries as short words: the id, the shortcut, and "-" in front of one that cannot be used. */
const short = (list: FileEntry[]) => list.map((e) => (e.kind === "item" ? `${e.disabled ? "-" : ""}${e.id}${e.hint ? ` ${e.hint}` : ""}` : e.kind === "heading" ? `# ${e.label}` : "---"));
const recent = Array.from({ length: 9 }, (_, i) => ({ path: `p${i}`, name: `n${i}`, exists: i !== 1 }));

describe("the File menu of Screenshots", () => {
  const run = { save: nothing, paint: nothing, print: nothing, folder: nothing };
  it("saves, edits and prints the capture on show, and opens the folder also without one", () => {
    expect(short(screenshotEntries(t, { capture: true, busy: false, windows: true }, run))).toEqual(["save", "paint", "print Ctrl+P", "folder"]);
    expect(short(screenshotEntries(t, { capture: false, busy: false, windows: true }, run))).toEqual(["-save", "-paint", "-print Ctrl+P", "folder"]);
    expect(short(screenshotEntries(t, { capture: true, busy: true, windows: true }, run))).toEqual(["-save", "-paint", "-print Ctrl+P", "-folder"]);
  });
});

describe("the File menu of Recording", () => {
  const run = { open: nothing, save: nothing, saveAs: nothing, rename: nothing, explorer: nothing, close: nothing, discard: nothing, openRecent: nothing };
  const menu = (state: Partial<Parameters<typeof recordingEntries>[1]>) => short(recordingEntries(t, { shown: true, project: false, dirty: false, busy: false, recent: [], ...state }, run));
  it("offers 'Save as project' and Discard for a recording that is no project yet", () => {
    expect(menu({})).toEqual(["open Ctrl+O", "save", "rename F2", "-explorer", "discard"]);
  });
  it("offers Save (only with changes), Save as and Close for a project", () => {
    expect(menu({ project: true })).toEqual(["open Ctrl+O", "-save Ctrl+S", "saveAs", "rename F2", "explorer", "close Ctrl+W"]);
    expect(menu({ project: true, dirty: true })[1]).toBe("save Ctrl+S");
  });
  it("only opens when nothing is on show, and lists the recent projects", () => {
    const list = menu({ shown: false, recent });
    expect(list.slice(0, 5)).toEqual(["open Ctrl+O", "-save", "-rename F2", "-explorer", "-close Ctrl+W"]);
    expect(list.slice(5)).toEqual(["# proj.recent", "recent:p0", "-recent:p1", "recent:p2", "recent:p3", "recent:p4", "recent:p5"]);
    expect(list.length - 6).toBe(RECENT);
  });
});

describe("the File menu of Documents", () => {
  const run = { create: nothing, open: nothing, save: nothing, saveAs: nothing, rename: nothing, explorer: nothing, close: nothing, openRecent: nothing };
  const menu = (state: Partial<Parameters<typeof guideEntries>[1]>) => short(guideEntries(t, { open: true, file: false, unchanged: false, busy: false, recent: [], ...state }, run));
  it("saves a guide that has no file yet, and has nothing to save in an unchanged one", () => {
    expect(menu({})).toEqual(["new", "open Ctrl+O", "save Ctrl+S", "saveAs Ctrl+Shift+S", "rename F2", "-explorer", "close Ctrl+W"]);
    expect(menu({ unchanged: true })[2]).toBe("save Ctrl+S");
    expect(menu({ file: true, unchanged: true }).slice(2, 6)).toEqual(["-save Ctrl+S", "saveAs Ctrl+Shift+S", "rename F2", "explorer"]);
    expect(menu({ file: true })[2]).toBe("save Ctrl+S");
  });
  it("without a guide only makes or opens one", () => {
    expect(menu({ open: false })).toEqual(["new", "open Ctrl+O", "-save Ctrl+S", "-saveAs Ctrl+Shift+S", "-rename F2", "-explorer", "-close Ctrl+W"]);
  });
  it("ends with Close Snipmunk after a line, as every File menu does", () => {
    expect(short(withClose(t, guideEntries(t, { open: false, file: false, unchanged: true, busy: false, recent: [] }, run), nothing)).slice(-2)).toEqual(["---", "quit"]);
  });
});

describe("deleting a template", () => {
  it("sets new guides back to Basic only when it was their template", () => {
    expect(newGuideTemplateAfterDelete("own-1", "own-1")).toBe("basic");
    expect(newGuideTemplateAfterDelete("clean", "own-1")).toBeNull();
    expect(newGuideTemplateAfterDelete("basic", "own-1")).toBeNull();
  });
});
