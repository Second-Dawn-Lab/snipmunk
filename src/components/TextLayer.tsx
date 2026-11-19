import { forwardRef, useId, useMemo } from "react";
import { FONT_STACK } from "../annotate/render";
import { fitScale, fontSizeFor, selectionText } from "../ocr/layer";
import type { OcrDoc } from "../ocr/types";

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, fontSize: number): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx as CanvasRenderingContext2D;
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  return ctx.measureText(text).width;
}

/** The text of the words the current selection touches, in reading order (whole words). */
export function selectedText(layer: HTMLElement, doc: OcrDoc): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
  const touched: number[] = [];
  layer.querySelectorAll<HTMLElement>("[data-n]").forEach((el) => {
    if (sel.containsNode(el, true)) touched.push(Number(el.dataset.n));
  });
  return selectionText(doc, touched);
}

/**
 * An invisible text layer over the picture: every recognized word is a real text element at the place of the word, so the
 * browser's own selection works (drag across lines, double-click a word) and `Ctrl+C` copies it (the parent handles the
 * copy event). The layer is in the pixels of the recognized picture and is scaled with the picture by its parent.
 */
export const TextLayer = forwardRef<
  HTMLDivElement,
  {
    doc: OcrDoc;
    onCopy: (text: string) => void;
    onMenu: (x: number, y: number) => void;
    /** Dim the whole picture and leave the recognized text bright (Text actions is open). */
    dim?: boolean;
    /** Words to mark (the gallery search found them). */
    hits?: ReadonlySet<number>;
    /** Only shows the marks: no selection, no menu. */
    passive?: boolean;
  }
>(function TextLayer(props, ref) {
  const { doc } = props;
  const maskId = useId();
  const lines = useMemo(
    () =>
      doc.lines.map((line) => ({
        index: line.index,
        rtl: line.rtl,
        words: line.words.map((w) => {
          const fontSize = fontSizeFor(w);
          return { w, fontSize, scale: fitScale(textWidth(w.text, fontSize), w.w) };
        }),
      })),
    [doc],
  );
  return (
    <div
      ref={ref}
      className={props.passive ? "ocrlayer ocrlayer--passive" : "ocrlayer"}
      style={{ width: doc.width, height: doc.height }}
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onCopy={(e) => {
        const text = selectedText(e.currentTarget, doc);
        if (!text) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", text);
        props.onCopy(text);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onMenu(e.clientX, e.clientY);
      }}
    >
      {(props.dim || (props.hits && props.hits.size > 0)) && (
        <svg className="ocrdim" width={doc.width} height={doc.height} aria-hidden="true">
          {props.dim && (
            <>
              <defs>
                <mask id={maskId}>
                  <rect width="100%" height="100%" fill="#fff" />
                  {doc.lines.map((l) => (
                    <rect key={l.index} x={l.x - 4} y={l.y - 3} width={l.w + 8} height={l.h + 6} rx={4} fill="#000" />
                  ))}
                </mask>
              </defs>
              <rect width="100%" height="100%" className="ocrdim__shade" mask={`url(#${maskId})`} />
              {doc.lines.map((l) => (
                <rect key={l.index} className="ocrdim__text" x={l.x - 4} y={l.y - 3} width={l.w + 8} height={l.h + 6} rx={4} />
              ))}
            </>
          )}
          {props.hits &&
            doc.words
              .filter((w) => props.hits?.has(w.n))
              .map((w) => <rect key={w.n} className="ocrdim__hit" x={w.x - 2} y={w.y - 1} width={w.w + 4} height={w.h + 2} rx={3} />)}
        </svg>
      )}
      {lines.map((l) => (
        <div key={l.index} className="ocrline" dir={l.rtl ? "rtl" : "ltr"}>
          {l.words.map(({ w, fontSize, scale }) => (
            <span
              key={w.n}
              className="ocrword"
              data-n={w.n}
              // The span is as wide as its text; scaling it from its left edge makes it as wide as the word's box.
              style={{ left: w.x, top: w.y, height: w.h, fontSize, lineHeight: `${w.h}px`, transform: `scaleX(${scale})` }}
            >
              {w.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
});
