// WCAG AA contrast of the theme: text pairs need 4.5:1, parts of controls (borders, accents drawn as shapes) 3:1.
// The tokens are read from the real CSS: the design system's styles.css and the overrides in app.css.
import design from "@seconddawn/ui/styles.css?raw";
import { describe, expect, it } from "vitest";
import app from "./app.css?raw";

const unix = (css: string) => css.replace(/\r/g, "");

/** The custom properties declared in the block that starts with `selector {` (first match). */
function block(source: string, selector: string): Record<string, string> {
  const css = "\n" + unix(source);
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// The cascade: ":root" < ":root[data-theme]" by specificity, whatever the file order.
const light = { ...block(design, ":root"), ...block(app, ":root") };
const dark = { ...light, ...block(design, ':root[data-theme="dark"]'), ...block(app, ':root[data-theme="dark"]') };

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Tokens = Record<string, string>;

/** [foreground, background, minimum ratio]; names starting with "#" are colors, others are tokens. */
const PAIRS: [string, string, number][] = [
  ["--dw-text", "--dw-bg", 4.5],
  ["--dw-text", "--dw-surface", 4.5],
  ["--dw-text", "--dw-surface-2", 4.5],
  ["--dw-text-2", "--dw-bg", 4.5],
  ["--dw-text-2", "--dw-surface", 4.5],
  ["--dw-text-2", "--dw-surface-2", 4.5],
  ["--dw-text-3", "--dw-bg", 4.5],
  ["--dw-text-3", "--dw-surface", 4.5],
  ["--dw-text-3", "--dw-surface-2", 4.5],
  ["--dw-on-brand", "--dw-brand", 4.5],
  ["--dw-on-brand", "--dw-brand-hover", 4.5],
  ["--dw-brand-text", "--dw-surface", 4.5],
  ["--dw-brand-text", "--dw-bg", 4.5],
  ["--dw-brand-text", "--dw-brand-soft", 4.5],
  ["--dw-text", "--dw-brand-soft", 4.5],
  ["--dw-danger", "--dw-surface", 4.5],
  ["--dw-danger", "--dw-danger-soft", 4.5],
  ["#ffffff", "--sm-capture-btn", 4.5],
  ["#ffffff", "--sm-capture-btn-hover", 4.5],
  ["--sm-on-amber", "--sm-amber", 4.5],
  // Parts of controls
  ["--dw-brand", "--dw-surface", 3],
  ["--dw-brand", "--dw-bg", 3],
  ["--sm-capture-btn", "--dw-surface", 3],
  ["--sm-capture-btn", "--dw-bg", 3],
];

for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as [string, Tokens][]) {
  describe(`${name} theme contrast`, () => {
    const color = (ref: string) => (ref.startsWith("#") ? ref : tokens[ref]);
    for (const [fg, bg, min] of PAIRS) {
      it(`${fg} on ${bg} is at least ${min}:1`, () => {
        expect(color(fg), fg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(color(bg), bg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(min);
      });
    }
  });
}

describe("theme blocks", () => {
  it("the system-dark block repeats the dark block", () => {
    const css = unix(app);
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    const start = media.indexOf(":root:not(");
    const end = media.indexOf("\n  }", start);
    const tokens: Record<string, string> = {};
    for (const m of media.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
    expect(tokens).toEqual(block(app, ':root[data-theme="dark"]'));
  });

  it("uses the brand colors from the brief as accents", () => {
    expect(light["--dw-brand"].toLowerCase()).toBe("#a0522d");
    expect(light["--sm-capture"].toLowerCase()).toBe("#e53935");
    expect(light["--sm-amber"].toLowerCase()).toBe("#f2a541");
  });

  it("keeps the surfaces neutral (no beige): red, green and blue stay close together", () => {
    for (const tokens of [light, dark]) {
      for (const k of ["--dw-bg", "--dw-surface", "--dw-surface-2", "--dw-border"]) {
        const n = parseInt(tokens[k].slice(1), 16);
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        expect(Math.max(...ch) - Math.min(...ch), k).toBeLessThanOrEqual(8);
      }
    }
  });

  it("white on the pure brief red would fail AA, which is why the button uses a deeper red", () => {
    expect(contrast("#ffffff", "#e53935")).toBeLessThan(4.5);
  });
});
