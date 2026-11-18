import { describe, expect, it } from "vitest";
import { parseShortcut, ShortcutRouter, type KeyLike } from "./shortcutRouter";

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  repeat: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});
const CA = { ctrlKey: true, altKey: true };

describe("parseShortcut", () => {
  it("reads the default and its spellings", () => {
    expect(parseShortcut("Ctrl+Alt+PrintScreen")).toEqual({ ctrl: true, alt: true, shift: false, win: false, key: "PrintScreen" });
    expect(parseShortcut("alt + ctrl + prtscn")?.key).toBe("PrintScreen");
    expect(parseShortcut("Ctrl+Shift+F8")).toMatchObject({ ctrl: true, shift: true, key: "F8" });
    expect(parseShortcut("Win+Shift+s")).toMatchObject({ win: true, shift: true, key: "S" });
    expect(parseShortcut("Ctrl+Space")?.key).toBe("Space");
  });
  it("rejects what the backend would reject", () => {
    expect(parseShortcut("PrintScreen")).toBeNull();
    expect(parseShortcut("")).toBeNull();
    expect(parseShortcut("Ctrl+Nope")).toBeNull();
    expect(parseShortcut("Ctrl+Ctrl+A")).toBeNull();
    expect(parseShortcut("Hyper+A")).toBeNull();
    expect(parseShortcut("Ctrl+F13")).toBeNull();
  });
});

describe("ShortcutRouter", () => {
  it("fires on the key-down of an ordinary key with exactly the right modifiers", () => {
    const r = new ShortcutRouter("Ctrl+Shift+F8");
    expect(r.onKey(key("F8", { ctrlKey: true, shiftKey: true }), "keydown", false)).toBe(true);
    expect(r.onKey(key("F8", { ctrlKey: true }), "keydown", false)).toBe(false);
    expect(r.onKey(key("F8", { ctrlKey: true, shiftKey: true, altKey: true }), "keydown", false)).toBe(false);
    expect(r.onKey(key("F9", { ctrlKey: true, shiftKey: true }), "keydown", false)).toBe(false);
  });

  it("ignores auto-repeat and key-up of ordinary keys", () => {
    const r = new ShortcutRouter("Ctrl+Shift+F8");
    const mods = { ctrlKey: true, shiftKey: true };
    expect(r.onKey(key("F8", { ...mods, repeat: true }), "keydown", false)).toBe(false);
    expect(r.onKey(key("F8", mods), "keyup", false)).toBe(false);
  });

  it("fires on the key-up of Print Screen, which a page does not get a key-down for", () => {
    const r = new ShortcutRouter("Ctrl+Alt+PrintScreen");
    expect(r.onKey(key("PrintScreen", CA), "keyup", false)).toBe(true);
    expect(r.onKey(key("PrintScreen", CA), "keyup", false)).toBe(true); // a new press, a new key-up
  });

  it("fires once when Print Screen sends both key-down and key-up", () => {
    const r = new ShortcutRouter("Ctrl+Alt+PrintScreen");
    expect(r.onKey(key("PrintScreen", CA), "keydown", false)).toBe(true);
    expect(r.onKey(key("PrintScreen", CA), "keyup", false)).toBe(false);
    // and the next press starts over
    expect(r.onKey(key("PrintScreen", CA), "keydown", false)).toBe(true);
    expect(r.onKey(key("PrintScreen", CA, ), "keyup", false)).toBe(false);
  });

  it("does not fire for Print Screen with other modifiers", () => {
    const r = new ShortcutRouter("Ctrl+Alt+PrintScreen");
    expect(r.onKey(key("PrintScreen"), "keyup", false)).toBe(false);
    expect(r.onKey(key("PrintScreen", { altKey: true }), "keyup", false)).toBe(false);
    expect(r.onKey(key("PrintScreen", { ...CA, shiftKey: true }), "keyup", false)).toBe(false);
  });

  it("works while a text box has the focus, except for typing and editing keys", () => {
    const r = new ShortcutRouter("Ctrl+Alt+PrintScreen");
    expect(r.onKey(key("PrintScreen", CA), "keyup", true)).toBe(true);
    const edit = new ShortcutRouter("Ctrl+V");
    expect(edit.onKey(key("KeyV", { ctrlKey: true }), "keydown", true)).toBe(false);
    expect(edit.onKey(key("KeyV", { ctrlKey: true }), "keydown", false)).toBe(true);
    const shifted = new ShortcutRouter("Shift+A");
    expect(shifted.onKey(key("KeyA", { shiftKey: true }), "keydown", true)).toBe(false);
  });

  it("leaves AltGr typing alone for letters and digits", () => {
    const r = new ShortcutRouter("Ctrl+Alt+Q");
    expect(r.onKey(key("KeyQ", { ...CA, altGraph: true }), "keydown", false)).toBe(false);
    expect(r.onKey(key("KeyQ", CA), "keydown", false)).toBe(true);
  });

  it("does nothing without a usable shortcut", () => {
    expect(new ShortcutRouter("nonsense").onKey(key("PrintScreen", CA), "keyup", false)).toBe(false);
    expect(new ShortcutRouter(null).onKey(key("PrintScreen", CA), "keyup", false)).toBe(false);
  });
});
