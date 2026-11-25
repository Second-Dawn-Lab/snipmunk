// The cover page of a Word document. Word has no boxes laid out as on the web: the colour blocks and pictures of a design are
// pictures behind the text, placed on the page from the first page's header, and the texts are paragraphs that are indented and
// spaced to stand where the design has them (their height is estimated, so the vertical place is close, not exact).

import { AlignmentType, BorderStyle, HorizontalPositionRelativeFrom, ImageRun, Paragraph, TextRun, VerticalPositionRelativeFrom, type FileChild } from "docx";
import { zlibSync } from "fflate";
import { ART_KEY, BACKGROUND_KEY, backgroundBox, hasArt, onCover } from "../template/background";
import { colorsOf, coverPlace, onColor, type Across, type CoverField } from "../template/model";
import { coverTitle, type ExportData, type ExportImage, type PmNode } from "./html";

const PX = 25.4 / 96;
const PT = 25.4 / 72;
const twips = (mm: number) => Math.round((mm * 1440) / 25.4);
const emu = (mm: number) => Math.round(mm * 36000);
const px = (mm: number) => Math.max(1, Math.round(mm / PX));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => (b.reduce((c, v) => crcTable[(c ^ v) & 255] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

/** A picture of one pixel of a colour: a coloured block of a design, at any size. */
export function solidPng(hex: string): Uint8Array {
  const n = parseInt(hex.replace("#", ""), 16) || 0;
  const be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...Array.from(type, (c) => c.charCodeAt(0)), ...data]);
    return [...be(data.length), ...body, ...be(crc(body))];
  };
  const head = new Uint8Array([...be(1), ...be(1), 8, 2, 0, 0, 0]);
  const pixel = zlibSync(new Uint8Array([0, (n >> 16) & 255, (n >> 8) & 255, n & 255]));
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", head), ...chunk("IDAT", pixel), ...chunk("IEND", new Uint8Array())]);
}

const bytes = (dataUrl: string): Uint8Array => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));

/** A picture behind the text, at a place on the page (millimetres). */
export function behindPicture(data: Uint8Array, jpeg: boolean, box: { x: number; y: number; w: number; h: number }, order: number, name: string): ImageRun {
  return new ImageRun({
    type: jpeg ? "jpg" : "png",
    data,
    transformation: { width: px(box.w), height: px(box.h) },
    altText: { title: name, description: name, name },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(box.x) },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(box.y) },
      behindDocument: true,
      allowOverlap: true,
      lockAnchor: true,
      zIndex: order,
    },
  });
}
const imageBehind = (img: ExportImage, box: { x: number; y: number; w: number; h: number }, order: number, name: string) => behindPicture(bytes(img.src), img.src.startsWith("data:image/jpeg"), box, order, name);

export interface CoverTools {
  /** The paragraphs of a formatted text, in a style, an ink and with what a cover adds to a paragraph. */
  rich(nodes: PmNode[], style: string, ink: string, extra: (n: PmNode) => object): FileChild[];
  rtlOf(text: string): boolean;
}

export interface WordCover {
  body: FileChild[];
  /** The pictures behind the cover (they go into the header of the first page). */
  behind: ImageRun[];
}

const plain = (n: PmNode): string => (n.text ?? "") + (n.content ?? []).map(plain).join("");
const ALIGN = { start: AlignmentType.START, center: AlignmentType.CENTER, end: AlignmentType.END } as const;

export function wordCover(d: ExportData, size: { w: number; h: number }, margin: number, tools: CoverTools): WordCover {
  const t = d.template;
  const c = t.cover;
  const colors = colorsOf(t);
  const at = coverPlace(c);
  const hex = (v: string) => v.replace("#", "").toUpperCase();
  const textWidth = size.w - 2 * margin;
  // The side where lines begin: the right one in a right-to-left guide.
  const startX = (width: number) => (d.rtl ? size.w - width : 0);
  const logo = c.logo && t.logo ? d.pictures.get(t.logo) : undefined;
  const logoSize = logo ? { h: c.logoSize * PX, w: (c.logoSize * PX * logo.width) / Math.max(1, logo.height) } : null;
  if (logoSize && logoSize.w > textWidth) {
    logoSize.h *= textWidth / logoSize.w;
    logoSize.w = textWidth;
  }

  // What the cover says, in order, with an estimate of each line's height.
  const date = c.dateText || d.date;
  const said = (field: CoverField, words: string, size = t.fonts.size * 1.3) => ({ field, style: field === "title" ? "Title" : "Subtitle", words, size });
  const texts = [
    said("title", coverTitle(d), t.fonts.headingSize * (c.design === "band" || c.design === "split" || c.design === "minimal" ? 1.4 : 1.7)),
    said("subtitle", c.subtitle),
    said("author", c.author),
    ...(c.date ? [said("dateText", date)] : []),
  ].filter((x) => x.words);
  const region = c.design === "band" ? size.w * 0.42 : c.design === "split" ? size.w * 0.5 : size.w;
  const line = (x: (typeof texts)[number]) => Math.max(1, Math.ceil((x.words.length * x.size * PT * 0.5) / Math.max(30, Math.min(textWidth, region - margin - 6)))) * x.size * PT * 1.3 + 2;
  const heights = texts.map(line);
  const inLogo = logoSize && c.logoPlace === "title" ? logoSize.h + 4 : 0;
  const all = inLogo + heights.reduce((a, b) => a + b, 0);
  const first = at.down === "top" ? (c.design === "banner" ? 30 : margin + 8) : at.down === "center" ? (size.h - all) / 2 : size.h - margin - all - 8;
  const titleAt = Math.max(margin, first) + inLogo;
  // The block of "banner" holds the title (and the logo above it).
  const banner = { top: at.down === "top" ? 0 : titleAt - inLogo - 12, bottom: titleAt + (heights[0] ?? 14) + 8 };

  const behind: ImageRun[] = [];
  const page = { x: 0, y: 0, w: size.w, h: size.h };
  const art = d.pictures.get(ART_KEY);
  if (c.background.toUpperCase() !== "#FFFFFF") behind.push(behindPicture(solidPng(c.background), false, page, 1, "cover colour"));
  const back = d.pictures.get(BACKGROUND_KEY);
  if (back && !hasArt(c.design) && onCover(t.background)) behind.push(imageBehind(back, backgroundBox(t.background, size, back), 2, "background"));
  if (c.design === "band") behind.push(behindPicture(solidPng(colors.main), false, { x: startX(region), y: 0, w: region, h: size.h }, 3, "band"));
  if (c.design === "banner") behind.push(behindPicture(solidPng(colors.main), false, { x: 0, y: banner.top, w: size.w, h: banner.bottom - banner.top }, 3, "banner"));
  if (c.design === "image") behind.push(art ? imageBehind(art, page, 3, "cover picture") : behindPicture(solidPng(colors.main), false, page, 3, "cover colour"));
  if (c.design === "split") {
    const half = { x: d.rtl ? 0 : size.w / 2, y: 0, w: size.w / 2, h: size.h };
    behind.push(art ? imageBehind(art, half, 3, "cover picture") : behindPicture(solidPng(colors.light), false, half, 3, "cover colour"));
  }
  if (logo && logoSize && c.logoPlace !== "title") {
    const align = c.logoAlign === "auto" ? "end" : c.logoAlign;
    const edge = 32 * PX;
    const side: Across = align === "center" ? "center" : (align === "start") !== d.rtl ? "start" : "end";
    const x = side === "center" ? (size.w - logoSize.w) / 2 : side === "start" ? edge : size.w - edge - logoSize.w;
    behind.push(imageBehind(logo, { x, y: c.logoPlace === "top" ? edge : size.h - edge - logoSize.h, ...logoSize }, 4, "logo"));
  }

  const onMain = hex(onColor(colors.main));
  const onCoverInk = hex(onColor(c.background));
  const inkOf = (field: CoverField): string => {
    if (c.design === "band") return onMain;
    if (c.design === "banner") return field === "title" ? onMain : onCoverInk;
    if (c.design === "image") return art ? (c.overlay === "dark" ? "FFFFFF" : "111111") : onMain;
    return onCoverInk;
  };
  // The texts keep to their part of the page.
  const indent = region < size.w ? { start: 0, end: twips(Math.max(0, textWidth - (region - margin - 6))) } : undefined;
  const body: FileChild[] = [];
  let before = twips(Math.max(0, titleAt - inLogo - margin));
  if (logo && logoSize && c.logoPlace === "title") {
    const align = c.logoAlign === "auto" ? at.across : c.logoAlign;
    body.push(
      new Paragraph({
        alignment: ALIGN[align],
        bidirectional: d.rtl,
        indent,
        spacing: { before },
        children: [new ImageRun({ type: logo.src.startsWith("data:image/jpeg") ? "jpg" : "png", data: bytes(logo.src), transformation: { width: px(logoSize.w), height: px(logoSize.h) }, altText: { title: "logo", description: "logo", name: "logo" } })],
      }),
    );
    before = 0;
  }
  texts.forEach((x, i) => {
    const rich = c.rich[x.field] as unknown as PmNode | undefined;
    const formatted = rich && plain(rich).trim() ? (rich.content ?? []) : null;
    const own = x.field === "dateText" && c.dateAlign !== "auto" ? c.dateAlign : null;
    let space = i === 0 ? before : 0;
    // Below the block of "banner" the next text begins under it.
    if (c.design === "banner" && i === 1) space = twips(Math.max(0, banner.bottom - titleAt - (heights[0] ?? 0)) + 3);
    let used = false;
    const extra = (n: PmNode) => {
      const chosen = own ?? ((n.attrs?.textAlign as Across | null | undefined) || null);
      const out = {
        alignment: ALIGN[chosen ?? at.across],
        indent,
        ...(space && !used ? { spacing: { before: space } } : {}),
        ...(c.design === "minimal" && x.field === "title" ? { border: { top: { style: BorderStyle.SINGLE, size: 36, color: hex(colors.main), space: 8 } } } : {}),
      };
      used = true;
      return out;
    };
    const ink = inkOf(x.field);
    if (formatted) body.push(...tools.rich(formatted, x.style, ink, extra));
    else {
      const node: PmNode = { type: "paragraph", attrs: { textAlign: rich?.content?.[0]?.attrs?.textAlign ?? null } };
      const rtl = tools.rtlOf(x.words);
      body.push(new Paragraph({ style: x.style, bidirectional: rtl, ...extra(node), children: [new TextRun({ text: x.words, rightToLeft: rtl, color: ink })] }));
    }
  });
  return { body, behind };
}
