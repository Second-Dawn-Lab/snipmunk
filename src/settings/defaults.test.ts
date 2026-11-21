import { describe, expect, it } from "vitest";
import rust from "../../src-tauri/src/settings.rs?raw";
import { defaultSettings } from "./defaults";

describe("defaultSettings", () => {
  it("has the defaults of the spec", () => {
    expect(defaultSettings).toMatchObject({
      theme: "system",
      closeAction: "background",
      captureHotkey: "Ctrl+Alt+PrintScreen",
      clearOnExit: false,
      retentionDays: 30,
      defaultCopyMode: "separate",
      language: "system",
      captureMode: "rectangle",
      captureDelay: 0,
    });
  });

  it("has the same fields as the Rust Settings struct", () => {
    const struct = rust.slice(rust.indexOf("pub struct Settings"), rust.indexOf("impl Default"));
    const camel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
    const fields = [...struct.matchAll(/^\s+pub (\w+):/gm)].map((m) => camel(m[1])).sort();
    expect(Object.keys(defaultSettings).sort()).toEqual(fields);
  });
});

describe("copy each capture to the clipboard", () => {
  it("is on by default in the app and in the Rust defaults, for new installs and fresh settings files", () => {
    expect(defaultSettings.autoCopyToClipboard).toBe(true);
    expect(rust).toMatch(/auto_copy_to_clipboard: true,/);
  });
});
