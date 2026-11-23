import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useT } from "../i18n";

/** A crop of an image: x, y, width, height as fractions (0..1) of the original. The original stays in the guide. */
export type ImgCrop = [number, number, number, number];
type Align = "start" | "center" | "end" | "full";

interface ImgAttrs {
  src: string;
  alt: string | null;
  file: string | null;
  /** Shown width in pixels (null: the natural width, at most the width of the page). */
  width: number | null;
  /** Shown height in pixels, only for a free (not proportional) resize. */
  height: number | null;
  align: Align;
  crop: ImgCrop | null;
  /** The natural size, to reserve the height before the picture has loaded. */
  nw: number | null;
  nh: number | null;
}

const num = (el: HTMLElement, name: string) => {
  const v = Number(el.getAttribute(name));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * The image of a text block: attributes in the node (all optional, so guides of 7.5-B open as before), a view with corner handles to
 * resize (Shift = free), alignment, a non-destructive crop, alt text and delete.
 */
export const GuideImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      file: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-file") ?? null, renderHTML: (a: Record<string, unknown>) => (a.file ? { "data-file": a.file } : {}) },
      width: { default: null, parseHTML: (el: HTMLElement) => num(el, "data-w"), renderHTML: (a: Record<string, unknown>) => (a.width ? { "data-w": a.width } : {}) },
      height: { default: null, parseHTML: (el: HTMLElement) => num(el, "data-h"), renderHTML: (a: Record<string, unknown>) => (a.height ? { "data-h": a.height } : {}) },
      align: { default: "start", parseHTML: (el: HTMLElement) => el.getAttribute("data-align") ?? "start", renderHTML: (a: Record<string, unknown>) => (a.align && a.align !== "start" ? { "data-align": a.align } : {}) },
      crop: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          try {
            const v = JSON.parse(el.getAttribute("data-crop") ?? "null");
            return Array.isArray(v) && v.length === 4 ? v : null;
          } catch {
            return null;
          }
        },
        renderHTML: (a: Record<string, unknown>) => (a.crop ? { "data-crop": JSON.stringify(a.crop) } : {}),
      },
      nw: { default: null, parseHTML: (el: HTMLElement) => num(el, "data-nw"), renderHTML: (a: Record<string, unknown>) => (a.nw ? { "data-nw": a.nw } : {}) },
      nh: { default: null, parseHTML: (el: HTMLElement) => num(el, "data-nh"), renderHTML: (a: Record<string, unknown>) => (a.nh ? { "data-nh": a.nh } : {}) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function ImageView(props: NodeViewProps) {
  const { t } = useT();
  const a = props.node.attrs as ImgAttrs;
  const [cropping, setCropping] = useState(false);
  const [draft, setDraft] = useState<ImgCrop>(a.crop ?? [0, 0, 1, 1]);
  const box = useRef<HTMLDivElement>(null);
  const cropBox = useRef<HTMLDivElement>(null);
  const crop = a.crop;
  const [cx, cy, cw, ch] = crop ?? [0, 0, 1, 1];
  const ratio = a.nw && a.nh ? (cw * a.nw) / (ch * a.nh) : null;
  const widthCss = a.align === "full" ? "100%" : a.width ? `${a.width}px` : a.nw ? `${a.nw}px` : undefined;
  const free = !!a.height && !crop;
  const update = (c: Partial<ImgAttrs>) => props.updateAttributes(c as Record<string, unknown>);

  // Resize by a corner: proportional, Shift = free.
  const startResize = (e: RPointerEvent, corner: "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const max = (el.closest(".ProseMirror") as HTMLElement | null)?.clientWidth ?? 900;
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    const sx = corner.endsWith("e") ? 1 : -1;
    const sy = corner.startsWith("s") ? 1 : -1;
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const w = clamp(start.w + sx * (ev.clientX - start.x), 40, max);
      if (ev.shiftKey) update({ width: Math.round(w), height: Math.round(clamp(start.h + sy * (ev.clientY - start.y), 24, 4000)), align: a.align === "full" ? "start" : a.align });
      else update({ width: Math.round(w), height: null, align: a.align === "full" ? "start" : a.align });
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
  };

  // The crop rectangle on the whole picture.
  const startCrop = (e: RPointerEvent, mode: "move" | "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    const el = cropBox.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d0 = draft;
    const p0 = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - r.left) / r.width - p0.x;
      const dy = (ev.clientY - r.top) / r.height - p0.y;
      let [x, y, w, h] = d0;
      if (mode === "move") {
        x = clamp(x + dx, 0, 1 - w);
        y = clamp(y + dy, 0, 1 - h);
      } else {
        const left = mode.endsWith("w");
        const top = mode.startsWith("n");
        const nx = left ? clamp(x + dx, 0, x + w - 0.05) : x;
        const ny = top ? clamp(y + dy, 0, y + h - 0.05) : y;
        const nr = left ? x + w : clamp(x + w + dx, x + 0.05, 1);
        const nb = top ? y + h : clamp(y + h + dy, y + 0.05, 1);
        x = nx;
        y = ny;
        w = nr - nx;
        h = nb - ny;
      }
      setDraft([x, y, w, h]);
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
  };

  const finishCrop = () => {
    const [x, y, w, h] = draft;
    const whole = x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999;
    update({ crop: whole ? null : ([x, y, w, h] as ImgCrop), height: null });
    setCropping(false);
  };

  const bar = (label: string, on: boolean, run: () => void, glyph: string) => (
    <button type="button" className={`rich__btn${on ? " rich__btn--on" : ""}`} aria-pressed={on} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {glyph}
    </button>
  );

  return (
    <NodeViewWrapper className={`gimg gimg--${a.align}${props.selected ? " gimg--sel" : ""}`} data-align={a.align}>
      {props.selected && (
        <div className="gimg__bar" contentEditable={false} role="toolbar" aria-label={t("rich.imgTools")}>
          {cropping ? (
            <>
              {bar(t("rich.imgCropDone"), true, finishCrop, "✓")}
              {bar(t("rich.imgCropReset"), false, () => (setDraft([0, 0, 1, 1]), update({ crop: null }), setCropping(false)), "↺")}
            </>
          ) : (
            <>
              {bar(t("rich.alignStart"), a.align === "start", () => update({ align: "start" }), "⇤")}
              {bar(t("rich.alignCenter"), a.align === "center", () => update({ align: "center" }), "↔")}
              {bar(t("rich.alignEnd"), a.align === "end", () => update({ align: "end" }), "⇥")}
              {bar(t("rich.imgFull"), a.align === "full", () => update({ align: "full", height: null }), "▭")}
              <span className="rich__sep" />
              {bar(t("rich.imgCrop"), !!crop, () => (setDraft(crop ?? [0, 0, 1, 1]), setCropping(true)), "⛶")}
              <input className="gimg__alt" value={a.alt ?? ""} placeholder={t("rich.imgAlt")} aria-label={t("rich.imgAlt")} onChange={(e) => update({ alt: e.target.value })} onMouseDown={(e) => e.stopPropagation()} />
              {bar(t("rich.imgDelete"), false, () => props.deleteNode(), "🗑")}
            </>
          )}
        </div>
      )}
      {cropping && a.nw && a.nh ? (
        <div ref={cropBox} className="gimg__cropbox" style={{ width: widthCss ?? "100%", aspectRatio: `${a.nw} / ${a.nh}` }} contentEditable={false}>
          <img src={a.src} alt="" draggable={false} />
          <div className="gimg__crop" style={{ left: `${draft[0] * 100}%`, top: `${draft[1] * 100}%`, width: `${draft[2] * 100}%`, height: `${draft[3] * 100}%` }} onPointerDown={(e) => startCrop(e, "move")}>
            {(["nw", "ne", "sw", "se"] as const).map((c) => (
              <span key={c} className={`gimg__h gimg__h--${c}`} onPointerDown={(e) => startCrop(e, c)} />
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={box}
          className="gimg__box"
          contentEditable={false}
          style={{ width: widthCss, maxWidth: "100%", aspectRatio: free ? undefined : (ratio ?? undefined), height: free ? a.height! : undefined }}
        >
          {crop ? (
            <img
              src={a.src}
              alt={a.alt ?? ""}
              draggable={false}
              style={{ position: "absolute", width: `${100 / cw}%`, left: `${(-cx / cw) * 100}%`, top: `${(-cy / ch) * 100}%`, maxWidth: "none" }}
            />
          ) : (
            <img
              src={a.src}
              alt={a.alt ?? ""}
              draggable={false}
              style={{ width: "100%", height: "100%", display: "block" }}
              onLoad={(e) => {
                const i = e.currentTarget;
                if (!a.nw || !a.nh) update({ nw: i.naturalWidth, nh: i.naturalHeight });
              }}
            />
          )}
          {props.selected && (["nw", "ne", "sw", "se"] as const).map((c) => <span key={c} className={`gimg__h gimg__h--${c}`} onPointerDown={(e) => startResize(e, c)} />)}
        </div>
      )}
    </NodeViewWrapper>
  );
}

type TableAlign = "start" | "center" | "end";

/**
 * The table of a text block: columns can be resized by dragging their borders (the widths are stored in the cells), and the table has
 * an alignment (an attribute of the node; a decoration puts it on the table's wrapper).
 */
export const GuideTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: { default: "start", parseHTML: (el: HTMLElement) => el.getAttribute("data-align") ?? "start", renderHTML: (a: Record<string, unknown>) => (a.align && a.align !== "start" ? { "data-align": a.align } : {}) },
    };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("tableAlign"),
        props: {
          decorations(state) {
            const out: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === "table") {
                const al = (node.attrs.align as TableAlign | undefined) ?? "start";
                if (al !== "start") out.push(Decoration.node(pos, pos + node.nodeSize, { class: `tbl-${al}` }));
                return false;
              }
              return true;
            });
            return DecorationSet.create(state.doc, out);
          },
        },
      }),
    ];
  },
});
