import { describe, expect, it } from "vitest";
import { hotkeyLabel } from "./hotkeyLabel";

describe("hotkeyLabel", () => {
  it("keeps the keys as they are in English", () => {
    expect(hotkeyLabel("Ctrl+Alt+PrintScreen", "en")).toBe("Ctrl+Alt+PrintScreen");
  });

  it("uses the printed key names of German, French, Spanish and Italian keyboards", () => {
    expect(hotkeyLabel("Ctrl+Alt+PrintScreen", "de")).toBe("Strg+Alt+Druck");
    expect(hotkeyLabel("Ctrl+Shift+PrintScreen", "fr")).toBe("Ctrl+Maj+Impr. écran");
    expect(hotkeyLabel("PrintScreen", "es")).toBe("ImprPant");
    expect(hotkeyLabel("Ctrl+PrintScreen", "it")).toBe("Ctrl+Stamp");
  });

  it("wraps the shortcut in a left-to-right isolate in right-to-left languages", () => {
    expect(hotkeyLabel("Ctrl+0", "ar")).toBe("⁦Ctrl+0⁩");
    expect(hotkeyLabel("Ctrl+0", "ur")).toBe("⁦Ctrl+0⁩");
  });

  it("leaves other languages alone", () => {
    expect(hotkeyLabel("Ctrl+Alt+PrintScreen", "zh-Hans")).toBe("Ctrl+Alt+PrintScreen");
  });
});
