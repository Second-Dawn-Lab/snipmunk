// The template of a guide (no React): page, fonts, colours, cover, header and footer, step layout, picture frame and styles.
// A template is plain JSON (version 1); the one a guide uses is embedded in the guide (docs/templates.md).

import type { MarkerStyle, PmDoc } from "../model";

export type PageSize = "a4" | "letter" | "screen";
export const SLOTS = ["none", "title", "text", "logo", "page", "date", "author"] as const;
export type Slot = (typeof SLOTS)[number];
export const SIDES = ["left", "center", "right"] as const;
export type Side = (typeof SIDES)[number];
export interface Slots {
  left: Slot;
  center: Slot;
  right: Slot;
  /** The words of the places that show a custom text. */
  texts: Record<Side, string>;
}
/** The texts of the cover. `dateText` empty: the date of the day. */
export const COVER_FIELDS = ["title", "subtitle", "author", "dateText"] as const;
export type CoverField = (typeof COVER_FIELDS)[number];
/** The picture behind the pages (the picture itself is `cover.image`). */
export interface Background {
  apply: "cover" | "all" | "notCover";
  size: "original" | "fit" | "fill" | "custom";
  /** With "custom": the width of the picture in percent of the page width. */
  scale: number;
  x: "left" | "center" | "right";
  y: "top" | "center" | "bottom";
  /** 0 to 100 percent. */
  opacity: number;
  grey: boolean;
}
/** The layouts of the cover page. */
export const COVER_DESIGNS = ["classic", "band", "banner", "image", "minimal", "split"] as const;
export type CoverDesign = (typeof COVER_DESIGNS)[number];
export const ACROSS = ["start", "center", "end"] as const;
export type Across = (typeof ACROSS)[number];
export const DOWN = ["top", "center", "bottom"] as const;
export type Down = (typeof DOWN)[number];
export const LOGO_PLACES = ["title", "top", "bottom"] as const;
export type LogoPlace = (typeof LOGO_PLACES)[number];

export const TOC_STYLES = ["classic", "modern", "formal", "simple"] as const;
export type TocStyle = (typeof TOC_STYLES)[number];
export const TOC_LEADERS = ["dots", "dashes", "line", "none"] as const;
export type TocLeader = (typeof TOC_LEADERS)[number];
/** The look of the table of contents and what it lists. */
export interface Toc {
  style: TocStyle;
  leader: TocLeader;
  numbers: boolean;
  /** Page numbers at the far side of the line; else right after the entry. */
  right: boolean;
  /** Empty: "Contents" in the language of the program. */
  title: string;
  /** Text size in pt; 0: the text size of the template. */
  size: number;
  /** Line spacing (1 to 2.5). */
  spacing: number;
  steps: boolean;
  /** Headings of level 1 and 2 of the text blocks. */
  headings: boolean;
}

export type FrameRatio = "original" | "16:9" | "4:3" | "3:2" | "1:1" | "custom";
export type BadgeShape = "circle" | "square" | "pill" | "none";
export type ColorRole = "main" | "accent" | "dark";

export interface Colors {
  main: string;
  accent: string;
  light: string;
  dark: string;
  text: string;
  background: string;
}

export interface Template {
  version: 1;
  id: string;
  name: string;
  page: { size: PageSize; orientation: "portrait" | "landscape"; margin: number };
  fonts: { heading: string; body: string; size: number; headingSize: number };
  /** `auto`: every colour but the main one and the background is derived from them. */
  colors: Colors & { auto: boolean };
  /** `title` … `dateText` are the plain words; `rich` holds a text as it was formatted in place. `align` and `vertical`
   * place the group of texts ("auto": as the design has it); `dateAlign` and `logoAlign` "auto" follow the group.
   * `logoSize` is the height of the logo in pixels of the page; `overlay` darkens or lightens the picture of "image". */
  cover: {
    on: boolean;
    title: string;
    subtitle: string;
    author: string;
    date: boolean;
    dateText: string;
    logo: boolean;
    background: string;
    image: string | null;
    rich: Partial<Record<CoverField, PmDoc>>;
    design: CoverDesign;
    align: Across | "auto";
    vertical: Down | "auto";
    dateAlign: Across | "auto";
    logoPlace: LogoPlace;
    logoAlign: Across | "auto";
    logoSize: number;
    overlay: "dark" | "light";
  };
  background: Background;
  /** A table of contents (after the cover). */
  contents: boolean;
  toc: Toc;
  header: Slots;
  footer: Slots;
  /** `badgeBg` and `badgeText`: colours of the step numbers of their own; `null`: from `badgeColor` and for contrast. */
  steps: { badge: BadgeShape; badgeColor: ColorRole; badgeBg: string | null; badgeText: string | null; layout: "above" | "right" | "left"; spacing: number; description: "normal" | "muted" | "boxed"; onePerPage: boolean; textScale: number };
  frame: { ratio: FrameRatio; w: number; h: number; maxWidth: number };
  picture: { borderColor: string; borderWidth: number; radius: number; shadow: boolean };
  annotation: ColorRole;
  table: { header: "main" | "light" | "none"; borders: boolean; zebra: boolean };
  marker: MarkerStyle;
  /** An image of the guide ("m-*.png"), used on the cover and in the header or footer. */
  logo: string | null;
}

// --- colours (WCAG 2) ------------------------------------------------------------------------------------------------------------

export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const hex = (c: [number, number, number]): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
/** `a` with `part` (0..1) of `b` mixed in. */
export const mix = (a: string, b: string, part: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * part, x[1] + (y[1] - x[1]) * part, x[2] + (y[2] - x[2]) * part]);
};
const luminance = (c: string): number => {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** `fg` made darker or lighter (towards black or white, whichever is further from the background) until it reaches `min` on `bg`. */
export function readable(fg: string, bg: string, min = 4.5): string {
  const to = contrast("#000000", bg) >= contrast("#FFFFFF", bg) ? "#000000" : "#FFFFFF";
  for (let i = 0; i <= 20; i++) {
    const c = mix(fg, to, i / 20);
    if (contrast(c, bg) >= min) return c;
  }
  return to;
}
/** The text colour to put ON a filled colour (a badge, a table header). */
export const onColor = (fill: string): string => (contrast("#FFFFFF", fill) >= contrast("#111111", fill) ? "#FFFFFF" : "#111111");

/** The derived colours for a main colour on a background: text AA (4.5) on the background and on the light fill. */
export function deriveColors(main: string, background: string): Colors {
  const darkPage = luminance(background) < 0.18;
  const text = readable(darkPage ? "#E8EAED" : "#1F2328", background, 7);
  const light = mix(background, main, darkPage ? 0.22 : 0.1);
  return {
    main,
    accent: readable(mix(main, darkPage ? "#FFFFFF" : "#000000", 0.18), background),
    light,
    dark: readable(mix(main, darkPage ? "#FFFFFF" : "#000000", 0.45), background, 7),
    text,
    background,
  };
}

/** The colours a template shows (derived when `auto`). Headings use `dark`, links `accent`: both readable on the background. */
export const colorsOf = (t: Template): Colors => (t.colors.auto ? deriveColors(t.colors.main, t.colors.background) : t.colors);

export const roleColor = (t: Template, role: ColorRole): string => colorsOf(t)[role];

/** The fill and the text colour of the step numbers. */
export function badgeColors(t: Template): { fill: string; text: string } {
  const fill = t.steps.badgeBg ?? roleColor(t, t.steps.badgeColor);
  return { fill, text: t.steps.badgeText ?? onColor(fill) };
}

// --- built-in templates ------------------------------------------------------------------------------------------------------------

const slots = (left: Slot, center: Slot, right: Slot): Slots => ({ left, center, right, texts: { left: "", center: "", right: "" } });

/** Level 1: the default, used when nothing else is chosen. Clean and neutral, A4, Segoe UI. */
export const BASIC: Template = {
  version: 1,
  id: "basic",
  name: "Basic",
  page: { size: "a4", orientation: "portrait", margin: 16 },
  fonts: { heading: "Segoe UI", body: "Segoe UI", size: 11, headingSize: 22 },
  colors: { auto: true, main: "#A0522D", accent: "", light: "", dark: "", text: "", background: "#FFFFFF" },
  cover: { on: false, title: "", subtitle: "", author: "", date: true, dateText: "", logo: true, background: "#FFFFFF", image: null, rich: {}, design: "classic", align: "auto", vertical: "auto", dateAlign: "auto", logoPlace: "title", logoAlign: "auto", logoSize: 90, overlay: "dark" },
  background: { apply: "cover", size: "fill", scale: 50, x: "center", y: "center", opacity: 100, grey: false },
  contents: false,
  toc: { style: "classic", leader: "dots", numbers: true, right: true, title: "", size: 0, spacing: 1.5, steps: true, headings: true },
  header: slots("none", "none", "none"),
  footer: slots("title", "none", "page"),
  steps: { badge: "circle", badgeColor: "main", badgeBg: null, badgeText: null, layout: "above", spacing: 18, description: "normal", onePerPage: false, textScale: 1 },
  frame: { ratio: "original", w: 16, h: 9, maxWidth: 100 },
  picture: { borderColor: "#D0D4DA", borderWidth: 1, radius: 6, shadow: false },
  annotation: "main",
  table: { header: "light", borders: true, zebra: false },
  marker: { left: "#FF5A36", right: "#3B82F6", shape: "circle", size: "medium" },
  logo: null,
};

const make = (id: string, name: string, change: (t: Template) => void): Template => {
  const t = JSON.parse(JSON.stringify(BASIC)) as Template;
  t.id = id;
  t.name = name;
  change(t);
  return t;
};

/** No look at all: no cover, header, footer, background or frame, and plain styles. */
export const BLANK: Template = make("blank", "Blank", (t) => {
  t.fonts = { heading: "Segoe UI", body: "Segoe UI", size: 11, headingSize: 20 };
  t.colors.main = "#374151";
  t.cover.logo = false;
  t.footer = slots("none", "none", "none");
  t.steps = { ...t.steps, badgeColor: "dark", spacing: 14 };
  t.picture = { borderColor: "#D0D4DA", borderWidth: 0, radius: 0, shadow: false };
  t.table = { header: "none", borders: true, zebra: false };
});

/** Level 2: the built-in templates. Their names are translated (`template.builtin.<id>`). */
export const BUILT_INS: readonly Template[] = [
  BLANK,
  BASIC,
  make("clean", "Clean", (t) => {
    t.fonts = { heading: "Calibri", body: "Calibri", size: 12, headingSize: 26 };
    t.colors.main = "#2563EB";
    t.cover.on = true;
    t.picture = { borderColor: "#E5E7EB", borderWidth: 1, radius: 10, shadow: true };
    t.steps.spacing = 26;
    t.frame.ratio = "16:9";
  }),
  make("corporate", "Corporate", (t) => {
    t.fonts = { heading: "Cambria", body: "Calibri", size: 11, headingSize: 24 };
    t.colors.main = "#1F3A5F";
    t.cover = { ...t.cover, on: true, background: "#1F3A5F" };
    t.header = slots("logo", "none", "title");
    t.footer = slots("date", "none", "page");
    t.steps = { ...t.steps, badge: "square", badgeColor: "dark" };
    t.table = { header: "main", borders: true, zebra: true };
    t.picture = { borderColor: "#1F3A5F", borderWidth: 1, radius: 0, shadow: false };
  }),
  make("training", "Training", (t) => {
    t.fonts = { heading: "Segoe UI", body: "Segoe UI", size: 14, headingSize: 30 };
    t.colors.main = "#0F7B4F";
    t.cover.on = true;
    t.steps = { ...t.steps, badge: "pill", textScale: 1.35, spacing: 32, description: "boxed", onePerPage: true };
    t.marker = { ...t.marker, shape: "ring", size: "large" };
    t.picture = { borderColor: "#0F7B4F", borderWidth: 2, radius: 8, shadow: false };
  }),
  make("compact", "Compact", (t) => {
    t.fonts = { heading: "Segoe UI", body: "Segoe UI", size: 9.5, headingSize: 18 };
    t.page.margin = 11;
    t.colors.main = "#4B5563";
    t.steps = { ...t.steps, badge: "square", layout: "right", spacing: 8, description: "muted" };
    t.frame = { ratio: "4:3", w: 4, h: 3, maxWidth: 45 };
    t.marker.size = "small";
  }),
  make("dark", "Dark", (t) => {
    t.page = { size: "screen", orientation: "portrait", margin: 14 };
    t.colors = { ...t.colors, main: "#F59E0B", background: "#14161A" };
    t.cover = { ...t.cover, on: true, background: "#1C1F26" };
    t.picture = { borderColor: "#3A3F4B", borderWidth: 1, radius: 8, shadow: true };
    t.footer = slots("none", "page", "none");
  }),
];

/** When a template is deleted: the new "Template for new guides" if it was that one (Basic), else `null` (nothing to change). */
export const newGuideTemplateAfterDelete = (chosen: string, deleted: string): string | null => (chosen === deleted ? BASIC.id : null);

/** The main colours offered as presets next to the colour picker. */
export const COLOR_PRESETS = ["#A0522D", "#2563EB", "#1F3A5F", "#0F7B4F", "#7C3AED", "#BE123C", "#B45309", "#4B5563"];

/** A template read from a file or a guide: missing parts take the basic values, so an older or hand-written one opens. */
export function normalizeTemplate(input: unknown): Template {
  const base = JSON.parse(JSON.stringify(BASIC)) as unknown as Record<string, unknown>;
  const merge = (into: Record<string, unknown>, from: unknown) => {
    if (!from || typeof from !== "object" || Array.isArray(from)) return;
    for (const [k, v] of Object.entries(from as Record<string, unknown>)) {
      const cur = into[k];
      if (cur && typeof cur === "object" && !Array.isArray(cur)) merge(cur as Record<string, unknown>, v);
      else if (v !== undefined && (cur === null || cur === undefined || typeof v === typeof cur || v === null)) into[k] = v;
    }
  };
  merge(base, input);
  const t = base as unknown as Template;
  t.version = 1;
  t.page.margin = Math.max(0, Math.min(40, Number(t.page.margin) || 0));
  t.frame.w = Math.max(1, Math.min(100, Number(t.frame.w) || 16));
  t.frame.h = Math.max(1, Math.min(100, Number(t.frame.h) || 9));
  t.frame.maxWidth = Math.max(20, Math.min(100, Number(t.frame.maxWidth) || 100));
  t.fonts.size = Math.max(7, Math.min(28, Number(t.fonts.size) || 11));
  t.fonts.headingSize = Math.max(12, Math.min(64, Number(t.fonts.headingSize) || 22));
  const colour = (c: unknown) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
  t.steps.badgeBg = colour(t.steps.badgeBg);
  t.steps.badgeText = colour(t.steps.badgeText);
  const oneOf = <T extends string>(v: T, list: readonly T[], other: T): T => (list.includes(v) ? v : other);
  const b = t.background;
  b.apply = oneOf(b.apply, ["cover", "all", "notCover"], "cover");
  b.size = oneOf(b.size, ["original", "fit", "fill", "custom"], "fill");
  b.x = oneOf(b.x, ["left", "center", "right"], "center");
  b.y = oneOf(b.y, ["top", "center", "bottom"], "center");
  b.scale = Math.max(5, Math.min(200, Number(b.scale) || 50));
  b.opacity = Number.isFinite(Number(b.opacity)) ? Math.max(0, Math.min(100, Number(b.opacity))) : 100;
  for (const s of [t.header, t.footer]) for (const side of SIDES) s[side] = oneOf(s[side], SLOTS, "none");
  const c = t.cover;
  // A cover made before the designs keeps its look: its texts stand at the start side.
  const had = (input as { cover?: { design?: unknown; align?: unknown } } | null)?.cover;
  if (had && had.design === undefined && had.align === undefined) c.align = "start";
  const auto = <T extends string>(v: T | "auto", list: readonly T[]): T | "auto" => oneOf<T | "auto">(v, [...list, "auto"], "auto");
  c.design = oneOf(c.design, COVER_DESIGNS, "classic");
  c.align = auto(c.align, ACROSS);
  c.vertical = auto(c.vertical, DOWN);
  c.dateAlign = auto(c.dateAlign, ACROSS);
  c.logoAlign = auto(c.logoAlign, ACROSS);
  c.logoPlace = oneOf(c.logoPlace, LOGO_PLACES, "title");
  c.logoSize = Math.round(Math.max(24, Math.min(240, Number(c.logoSize) || 90)));
  c.overlay = oneOf(c.overlay, ["dark", "light"], "dark");
  const toc = t.toc;
  toc.style = oneOf(toc.style, TOC_STYLES, "classic");
  toc.leader = oneOf(toc.leader, TOC_LEADERS, "dots");
  toc.title = String(toc.title).slice(0, 200);
  toc.size = Number(toc.size) > 0 ? Math.max(7, Math.min(28, Number(toc.size))) : 0;
  toc.spacing = Math.max(1, Math.min(2.5, Number(toc.spacing) || 1.5));
  return t;
}

/** Where the group of texts of a cover stands: what was chosen, else what the design has. */
export function coverPlace(c: Template["cover"]): { across: Across; down: Down } {
  const own: Record<CoverDesign, { across: Across; down: Down }> = {
    classic: { across: "center", down: "center" },
    band: { across: "start", down: "center" },
    banner: { across: "start", down: "top" },
    image: { across: "center", down: "center" },
    minimal: { across: "start", down: "bottom" },
    split: { across: "start", down: "center" },
  };
  return { across: c.align === "auto" ? own[c.design].across : c.align, down: c.vertical === "auto" ? own[c.design].down : c.vertical };
}

/** The ratio (width / height) of the picture frame, `null` for "Original" (no frame). */
export function frameRatio(t: Template): number | null {
  const f = t.frame;
  if (f.ratio === "original") return null;
  if (f.ratio === "custom") return f.w / f.h;
  const [w, h] = f.ratio.split(":").map(Number);
  return w / h;
}

/** The page in millimetres (`null`: "Screen", no pages). */
export function pageSize(t: Template): { w: number; h: number } | null {
  if (t.page.size === "screen") return null;
  const [w, h] = t.page.size === "a4" ? [210, 297] : [215.9, 279.4];
  return t.page.orientation === "portrait" ? { w, h } : { w: h, h: w };
}

/** A font with fallbacks for the writing systems of the languages. */
export const fontStack = (name: string): string => `"${name.replace(/["\\]/g, "")}", "Segoe UI", "Calibri", "Microsoft YaHei", "Segoe UI Historic", sans-serif`;
