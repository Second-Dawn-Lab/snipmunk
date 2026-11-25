// The heights of the pieces of a guide, measured in a hidden frame that has the width of the page and the template's styles. A
// measurer remembers what it measured, so a layout that follows a change only measures what is new.

import { htmlDocument, type ExportData } from "./html";
import { documentCss } from "../template/css";

/** What is measured: a block on its own, or a whole table whose rows are wanted one by one (`groups`: rows that stay together). */
export interface Request {
  html: string;
  groups?: number[];
}

export interface Size {
  height: number;
  /** For a table: the height of every group of rows, and the room above the first row (and below the last). */
  rows?: number[];
  lead?: number;
}

export interface Measurer {
  measure(d: ExportData, requests: readonly Request[], width: number): Promise<Size[]>;
  dispose(): void;
}

export function createMeasurer(): Measurer {
  let frame: HTMLIFrameElement | null = null;
  let loading: Promise<void> | null = null;
  let styled = "";
  const known = new Map<string, Size>();

  const open = (d: ExportData): Promise<void> => {
    if (loading) return loading;
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("sandbox", "allow-same-origin");
    f.style.cssText = "position:fixed;left:-20000px;top:0;width:900px;height:900px;border:0;visibility:hidden";
    frame = f;
    loading = new Promise<void>((resolve) => {
      f.onload = () => resolve();
      f.srcdoc = htmlDocument({ ...d, pictures: new Map() }, `<div class="doc pages"><div id="m"></div></div>`);
      document.body.appendChild(f);
    });
    styled = "";
    return loading;
  };

  const run = async (d: ExportData, requests: readonly Request[], width: number): Promise<Size[]> => {
    await open(d);
    const doc = frame!.contentDocument!;
    const css = documentCss(d.template);
    const key = `${width}|${d.lang}|${d.rtl}|${css}`;
    if (key !== styled) {
      styled = key;
      known.clear();
      doc.documentElement.lang = d.lang;
      doc.documentElement.dir = d.rtl ? "rtl" : "ltr";
      doc.querySelector("style")!.textContent = css;
      frame!.style.width = `${width + 40}px`;
    }
    const id = (r: Request) => `${r.groups?.join(",") ?? ""}|${r.html}`;
    const missing = Array.from(new Map(requests.filter((r) => !known.has(id(r))).map((r) => [id(r), r])).values());
    if (missing.length) {
      const host = doc.getElementById("m")!;
      host.style.width = `${width}px`;
      host.innerHTML = missing.map((r) => `<div data-u style="display:flow-root">${r.html}</div>`).join("");
      // A picture without its two numbers has no shape before it is read.
      await Promise.all(Array.from(doc.images).filter((i) => !(i.getAttribute("width") && i.getAttribute("height"))).map((i) => i.decode().catch(() => undefined)));
      await doc.fonts?.ready;
      const boxes = Array.from(host.children) as HTMLElement[];
      missing.forEach((r, i) => {
        const box = boxes[i].getBoundingClientRect();
        if (!r.groups) return void known.set(id(r), { height: box.height });
        const rows = Array.from(boxes[i].querySelector("tbody")?.children ?? []).map((x) => x.getBoundingClientRect());
        const heights: number[] = [];
        let at = 0;
        for (const n of r.groups) {
          const part = rows.slice(at, at + n);
          at += n;
          heights.push(part.length ? part[part.length - 1].bottom - part[0].top : 0);
        }
        const lead = rows.length ? Math.max(0, rows[0].top - box.top) : 0;
        known.set(id(r), { height: box.height, rows: heights, lead });
      });
      host.innerHTML = "";
    }
    return requests.map((r) => known.get(id(r)) ?? { height: 0 });
  };

  // One measurement at a time: they share the frame.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    measure(d, requests, width) {
      const next = queue.then(() => run(d, requests, width));
      queue = next.catch(() => undefined);
      return next;
    },
    dispose() {
      frame?.remove();
      frame = null;
      loading = null;
      known.clear();
    },
  };
}
