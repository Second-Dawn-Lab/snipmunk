import { describe, expect, it } from "vitest";
import { created, textStep, type TextState } from "./textTool";

const idle: TextState = { kind: "idle" };

describe("the text tool", () => {
  it("a click on empty canvas makes one new box", () => {
    const s = textStep(idle, { type: "down", hit: null, inEditBox: false });
    expect(s.effects).toEqual([{ type: "create" }]);
    expect(created(s.state, "t1")).toEqual({ kind: "editing", id: "t1", isNew: true });
  });
  it("a click on empty canvas while typing only finishes that box (one box per activation)", () => {
    const s = textStep({ kind: "editing", id: "t1", isNew: true }, { type: "down", hit: null, inEditBox: false });
    expect(s.effects).toEqual([{ type: "finish" }]);
    expect(s.state).toEqual(idle);
  });
  it("a click inside the box being typed in is left to the text field (the box does not move)", () => {
    const s = textStep({ kind: "editing", id: "t1", isNew: true }, { type: "down", hit: "t1", inEditBox: true });
    expect(s.effects).toEqual([{ type: "native" }]);
    expect(s.state).toEqual({ kind: "editing", id: "t1", isNew: true });
  });
  it("a click on another text while typing only finishes the box", () => {
    const s = textStep({ kind: "editing", id: "t1", isNew: false }, { type: "down", hit: "t2", inEditBox: false });
    expect(s.effects).toEqual([{ type: "finish" }]);
  });
  it("a press on a text when nothing is typed selects it", () => {
    const s = textStep(idle, { type: "down", hit: "t2", inEditBox: false });
    expect(s.effects).toEqual([{ type: "select", id: "t2" }]);
    expect(s.state).toMatchObject({ kind: "pressed", id: "t2" });
  });
  it("pressing and letting go on a text edits it with the cursor where it was clicked", () => {
    const down = textStep(idle, { type: "down", hit: "t2", inEditBox: false });
    const up = textStep(down.state, { type: "up", moved: false });
    expect(up.effects).toEqual([{ type: "edit", id: "t2", caret: "click" }]);
    expect(up.state).toEqual({ kind: "editing", id: "t2", isNew: false });
  });
  it("dragging a text moves it and does not start editing", () => {
    const down = textStep(idle, { type: "down", hit: "t2", inEditBox: false });
    const up = textStep(down.state, { type: "up", moved: true });
    expect(up.effects).toEqual([]);
    expect(up.state).toEqual(idle);
  });
  it("Esc, Ctrl+Enter and a tool change finish the box; they do nothing when nothing is typed", () => {
    const typing: TextState = { kind: "editing", id: "t1", isNew: true };
    for (const ev of [{ type: "key", key: "Escape" }, { type: "key", key: "CtrlEnter" }, { type: "toolChanged" }, { type: "selectedElsewhere" }] as const) {
      expect(textStep(typing, ev)).toEqual({ state: idle, effects: [{ type: "finish" }] });
      expect(textStep(idle, ev).effects).toEqual([]);
    }
  });
  it("a pointer release without a press does nothing", () => {
    expect(textStep(idle, { type: "up", moved: false })).toEqual({ state: idle, effects: [] });
  });
});
