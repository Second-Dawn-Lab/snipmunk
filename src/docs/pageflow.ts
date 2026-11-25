// Which block of a guide begins which page, for the editor's pages: the same layout as the print preview and the PDF (cover and
// contents on pages of their own, steps never split), measured with empty pictures of the right size so it can follow every change.

import { useEffect, useRef, useState } from "react";
import type { GuideStep } from "../ipc";
import { useExportLocale } from "./export/ExportDialog";
import { imageKey, type ExportData, type ExportImage, type PmNode } from "./export/html";
import { createMeasurer, type Measurer } from "./export/measure";
import { layoutPages, type Layout } from "./export/paginate";
import type { Locale } from "./export/run";
import { FRAME_W, hasOuter, outerPadding } from "./marks";
import type { GuideDoc } from "./model";
import { shownRect, templateOf } from "./template/apply";

/** The widest picture an export holds (see export/pictures.tsx). */
const MAX_WIDTH = 2000;
/** How long after the last change the pages are made anew. */
export const LAYOUT_DELAY = 100;

/** An empty picture of a size: all that the layout of the pages needs to know about a picture. */
const empty = (width: number, height: number): ExportImage => {
  const [w, h] = [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
  return { src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`)}`, width: w, height: h };
};

export function layoutPictures(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>): Map<string, ExportImage> {
  const out = new Map<string, ExportImage>();
  const images = (node: PmNode) => {
    if (node.type === "image" && node.attrs?.file) {
      const a = node.attrs as { nw?: number; nh?: number; crop?: number[] | null };
      const [cw, ch] = a.crop ? [a.crop[2], a.crop[3]] : [1, 1];
      out.set(imageKey(node.attrs), empty((a.nw || 800) * cw, (a.nh || 450) * ch));
    }
    node.content?.forEach(images);
  };
  for (const b of doc.blocks) {
    if (b.type === "step") {
      const step = steps.get(b.n);
      if (step?.image) {
        const { view } = shownRect(step, b, doc);
        const [, , w, h] = view;
        const scale = Math.min(1, MAX_WIDTH / w);
        const picture = empty(w * scale, h * scale);
        // The room that callouts and magnifiers need around the picture.
        const around = outerPadding(b.annotations, view);
        if (hasOuter(around)) {
          const [side, top, bottom] = [around.side / FRAME_W, around.top / FRAME_W, around.bottom / FRAME_W];
          const over = empty(picture.width * (1 + 2 * side), picture.height + picture.width * (top + bottom));
          picture.over = { ...over, side, top, bottom };
        }
        out.set(b.id, picture);
      }
      if (b.desc) images(b.desc as unknown as PmNode);
    } else images(b.doc as unknown as PmNode);
  }
  const { logo } = templateOf(doc);
  if (logo) out.set(logo, empty(120, 40));
  return out;
}

/** The data of a layout: the guide as the editor shows it (everything of it, as the print preview does). */
export function layoutData(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>, locale: Locale): ExportData {
  const t = templateOf(doc);
  return {
    doc,
    steps,
    template: t,
    pictures: layoutPictures(doc, steps),
    options: { cover: t.cover.on, toc: t.contents, numbers: true, descriptions: true },
    lang: locale.lang,
    rtl: locale.rtl,
    words: { contents: locale.contents, page: (n, of) => locale.pagePattern.replace("{n}", String(n)).replace("{of}", String(of)) },
    date: locale.date,
  };
}

export interface CanvasPages {
  layout: Layout;
  /** What it was made of (the texts of headers, footers and the contents). */
  data: ExportData;
  /** How long it took, in milliseconds. */
  ms: number;
}

/** The pages of the guide, made anew a moment after the last change; `null` while off (no pages) or not yet known. */
export function useCanvasPages(doc: GuideDoc, steps: ReadonlyMap<number, GuideStep>, on: boolean): CanvasPages | null {
  const localeOf = useExportLocale();
  const [pages, setPages] = useState<CanvasPages | null>(null);
  const measurer = useRef<Measurer | null>(null);
  // The template the last layout was asked for: a change of the look is laid out at once, typing a moment later.
  const looked = useRef<GuideDoc["template"] | undefined>(undefined);
  const first = useRef(true);
  useEffect(
    () => () => {
      measurer.current?.dispose();
      measurer.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!on) {
      first.current = true;
      return setPages(null);
    }
    let gone = false;
    const wait = first.current || looked.current !== doc.template ? 0 : LAYOUT_DELAY;
    looked.current = doc.template;
    const timer = window.setTimeout(
      () => {
        first.current = false;
        const from = performance.now();
        const data = layoutData(doc, steps, localeOf());
        measurer.current ??= createMeasurer();
        void layoutPages(data, measurer.current)
          .then((layout) => !gone && setPages({ layout, data, ms: performance.now() - from }))
          // The pages are a help only here: the print preview says what went wrong.
          .catch((e) => console.warn("[guide] page layout:", e));
      },
      wait,
    );
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [doc, steps, on, localeOf]);
  return pages;
}
