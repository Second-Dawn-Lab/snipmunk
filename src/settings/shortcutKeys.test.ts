import { describe, expect, it } from "vitest";
import { buildShortcut, keyName } from "./shortcutKeys";

const press = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("keyName", () => {
  it("knows letters, digits, F keys, Space and PrintScreen", () => {
    expect(keyName({ code: "KeyT" })).toBe("T");
    expect(keyName({ code: "Digit5" })).toBe("5");
    expect(keyName({ code: "F8" })).toBe("F8");
    expect(keyName({ code: "F12" })).toBe("F12");
    expect(keyName({ code: "Space" })).toBe("Space");
    expect(keyName({ code: "PrintScreen" })).toBe("PrintScreen");
    expect(keyName({ code: "PageDown" })).toBe("PageDown");
  });

  it("refuses the rest", () => {
    expect(keyName({ code: "ArrowLeft" })).toBeNull();
    expect(keyName({ code: "Comma" })).toBeNull();
    expect(keyName({ code: "F13" })).toBeNull();
    expect(keyName({ code: "Enter" })).toBeNull();
  });
});

describe("buildShortcut", () => {
  it("writes the modifiers in a fixed order", () => {
    expect(buildShortcut(press("PrintScreen", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+PrintScreen");
    expect(buildShortcut(press("KeyS", { metaKey: true, shiftKey: true }))).toBe("Shift+Win+S");
  });

  it("needs a modifier and a supported key", () => {
    expect(buildShortcut(press("PrintScreen"))).toBeNull();
    expect(buildShortcut(press("ArrowUp", { ctrlKey: true }))).toBeNull();
  });
});
