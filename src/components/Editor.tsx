import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ASPECTS, cropHandleAt, fitAspect, resizeFrame, type CropHandle } from "../annotate/crop";
import { historyOf, revisionsOf, editorStore, saveAnnotations, useEditorUi } from "../annotate/editorStore";
import {
  boundsOf, boxCorners, boxOf, dragHandle, dragLine, dragRect, handleAt, handlesOf, hitTest, itemsInRect, topmostAt, translate,
  type HandleKind, type Pt,
} from "../annotate/geometry";
import { centred, clampPan, clampZoom, fitZoom, toPicture, toStage, zoomAt, type View } from "../annotate/view";
import { hasRedactions, planImageSync } from "../annotate/imageRevs";
import { nextTarget, stepZoom, wheelAction, type ZoomTarget } from "../annotate/wheel";
import { isEmpty } from "../ocr/layout";
import type { FindOptions } from "../ocr/pii";
import { anythingChosen, quickRects, redactionsFor } from "../ocr/quickRedact";
import { detectTable, toHtml, toTsv } from "../ocr/table";
import { notify } from "../notify";
import {
  prepareWork, renderDoc, workKey, FONT_STACK, isRtlText, labelPadding, type Ctx, type WorkCanvas,
} from "../annotate/render";
import type { Annotation, AnnotationDoc, PenAnnotation, HighlighterAnnotation, TextAnnotation } from "../annotate/schema";
import { straighten } from "../annotate/strokes";
import { fitted, resizeText } from "../annotate/textLayout";
import { brushCursor, eraserCursor, resizeCursor, rotateCursor, thinCrosshairCursor } from "../annotate/cursors";
import { recognize } from "../annotate/shapeRecognizer";
import { snappedAnnotation } from "../annotate/snapShape";
import { commitAll, made as madeLive, restrict, selectable, unlocked, type LockState } from "../annotate/lock";
import { created as createdBox, textStep, type TextState } from "../annotate/textTool";
import { emojiImageSize, imagePatch, imageValues, toScreenPx } from "../annotate/screenSize";
import { isBoxShape, newEmoji, newHighlighter, newLine, newPen, newShape, newText, pickValues, restyle, styleKey, type ToolValues } from "../annotate/styles";
import { toolForKey, undoKeyFor } from "../annotate/tools";
import { apply, cropFromFrame, docGeometry, flippedOnScreen, frameFromCrop, invert, turned, uncroppedGeometry } from "../annotate/transform";
import { useT } from "../i18n";
import { ipc, imageUrl, type Capture, type Session } from "../ipc";
import type { Settings } from "../settings/defaults";
import { THUMB_BOUNDS } from "./thumbBounds";
import type { ZoomMode } from "./Preview";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { matchingWords } from "../search";
import { caretIndexAt } from "./caretAt";
import { TextLayer, selectedText } from "./TextLayer";
import { useOcr } from "./useOcr";
import { TEXT_SIZE_RANGE } from "./palettes";
import { Button, Dialog } from "@seconddawn/ui";

const FLASH_MS = 700;
/** How long the pen must rest before its stroke snaps to a shape. */
const HOLD_MS = 1000;

type Interaction =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "stroke"; ann: PenAnnotation | HighlighterAnnotation; raw: number[]; snapped?: Annotation }
  | { kind: "shape"; start: Pt; ann: Annotation | null }
  | { kind: "erase"; ids: Set<string> }
  | { kind: "move"; ids: string[]; start: Pt; base: AnnotationDoc; moved: boolean }
  | { kind: "handle"; id: string; handle: HandleKind; base: AnnotationDoc; moved: boolean }
  | { kind: "marquee"; start: Pt; add: boolean; before: string[] }
  | { kind: "redact"; start: Pt; rect: { x: number; y: number; w: number; h: number } | null }
  | { kind: "crop"; handle: CropHandle; start: Pt; frame: { x: number; y: number; w: number; h: number } };

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** The text of a text mark is edited in a text box laid over the picture. */
interface TextEdit {
  id: string;
  isNew: boolean;
  /** Where the user clicked into an existing text (client pixels): the caret goes there. */
  click?: { x: number; y: number };
}

function makeCanvas(w: number, h: number): WorkCanvas {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measureLine(font: string): (line: string) => number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx as CanvasRenderingContext2D;
  ctx.font = font;
  return (line) => ctx.measureText(line).width;
}

const fontMeasure = (fontSize: number) => measureLine(`${fontSize}px ${FONT_STACK}`);

/** The size of a text mark's box, measured with the real font (wrapped when it has a fixed width). */
function measuredText(a: TextAnnotation): TextAnnotation {
  return fitted(fontMeasure, a);
}

/**
 * The picture of the shown capture, drawn on a canvas, with the tools that draw on it. The original image is never changed:
 * every edit is a change of the annotation document (marks, crop, rotation), saved with the capture and drawn by the shared
 * renderer (`renderDoc`); the thumbnail of the capture is drawn by the same renderer.
 */
export function Editor(props: {
  session: Session;
  capture: Capture;
  zoomMode: ZoomMode;
  onZoom: (zoom: number) => void;
  onZoomMode: (zoom: number) => void;
  settings: Settings;
  onPatch?: (change: Partial<Settings>) => void;
  onError: (e: unknown) => void;
  /** The gallery search: its matching words are marked until the search is cleared. */
  searchQuery?: string;
}) {
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const { capture, settings } = props;
  const ui = useEditorUi();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [bakeAsk, setBakeAsk] = useState(false);
  const jobs = useRef<Promise<void>>(Promise.resolve());
  const holdTimer = useRef(0);
  /** Replace the stroke being drawn by the clean shape it was meant to be, with a short flash. */
  const snapStroke = (ia: Extract<Interaction, { kind: "stroke" }>) => {
    if (interaction.current !== ia || ia.snapped) return;
    const zoom = viewRef.current.zoom;
    const snap = recognize(ia.raw, 20 / zoom);
    if (!snap) return;
    const ann = ia.ann;
    const shape = snappedAnnotation(snap, ann);
    ia.snapped = shape;
    draft.current = shape;
    const b = boundsOf(shape);
    flash.current = { rects: [{ x: b.x, y: b.y, w: b.w, h: b.h }], start: performance.now() };
    requestDraw();
  };
  /** What the Text tool is doing (see src/annotate/textTool.ts). */
  const textSM = useRef<TextState>({ kind: "idle" });
  /** The areas that were just burned in flash for a moment (picture pixels). */
  const flash = useRef<{ rects: { x: number; y: number; w: number; h: number }[]; start: number } | null>(null);

  const history = useMemo(() => historyOf(capture.id, capture.annotations), [capture.id]);
  const docRef = useRef<AnnotationDoc>(history.current.doc);
  const [doc, setDocState] = useState<AnnotationDoc>(history.current.doc);
  const selRef = useRef<Set<string>>(new Set());
  const [, setSelectionState] = useState<string[]>([]);
  const viewRef = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const userView = useRef(false);
  const interaction = useRef<Interaction | null>(null);
  const draft = useRef<Annotation | null>(null);
  const hover = useRef<string | null>(null);
  const marquee = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const eraseIds = useRef<Set<string>>(new Set());
  const frame = useRef<{ x: number; y: number; w: number; h: number } | null>(null); // the crop frame while cropping
  const spaceDown = useRef(false);
  const [cursor, setCursorState] = useState("default");
  const cursorRef = useRef("default");
  const setCursor = (c: string) => {
    cursorRef.current = c;
    setCursorState(c);
  };
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const values = useRef<ToolValues>(pickValues(settings));
  values.current = pickValues(settings);
  const latest = useRef({ ui, props });
  latest.current = { ui, props };
  const work = useRef<{ key: string; canvas: WorkCanvas } | null>(null);
  const raf = useRef(0);
  const stats = useRef({ frames: 0, last: 0, worst: 0 });
  const drawRef = useRef<() => void>(() => {});

  const W = img?.naturalWidth ?? capture.width;
  const H = img?.naturalHeight ?? capture.height;

  // --- loading the original -------------------------------------------------------------------------------------------------
  useEffect(() => {
    const im = new Image();
    // The picture comes from our own scheme, which allows reading its pixels (needed to redact them).
    im.crossOrigin = "anonymous";
    im.onload = () => {
      work.current = null;
      imgRef.current = im;
      setImg(im);
    };
    im.src = imageUrl(props.session, capture);
    return () => {
      im.onload = null;
    };
  }, [capture.id, capture.file]);

  // --- the document ----------------------------------------------------------------------------------------------------------
  const geometry = useCallback(
    (d: AnnotationDoc = docRef.current, cropping = frame.current !== null) =>
      cropping ? uncroppedGeometry(d, W, H) : docGeometry(d, W, H),
    [W, H],
  );

  const syncStore = useCallback(() => {
    const d = docRef.current;
    editorStore.set({
      enabled: true,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      hasMarks: d.items.length > 0,
      hasCrop: d.crop !== null,
      hasRedactions: hasRedactions(d),
      hasQuickRedactions: d.items.some((a) => a.type === "redact" && a.origin === "quick"),
    });
  }, [history]);

  const requestDraw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      // The newest drawing function: it sees the current picture, size and text box.
      try {
        drawRef.current();
      } catch (e) {
        // A drawing error must not break the page; it is kept for the console of a development build.
        (window as unknown as { __editorError?: string }).__editorError = String((e as Error)?.stack ?? e);
        console.error(e);
      }
    });
  }, []);

  /** Which marks can still be edited (see src/annotate/lock.ts). */
  const lockRef = useRef<LockState>(unlocked);
  /** The Text tool and the emoji tool hand over to Select with their new mark still editable. */
  const keepLiveOnToolChange = useRef(false);
  const setSelection = useCallback(
    (ids: Iterable<string>) => {
      // A selection can only hold marks that were just made; committed marks cannot be selected.
      const next = new Set(restrict(lockRef.current, ids));
      if (sameSet(next, selRef.current)) return;
      selRef.current = next;
      setSelectionState([...next]);
      const types = docRef.current.items.filter((a) => next.has(a.id)).map((a) => a.type);
      editorStore.set({ selectedTypes: [...new Set(types)] });
      requestDraw();
    },
    [requestDraw],
  );

  /** A change that is an undo step: the document is replaced, saved, and the thumbnail is redrawn a moment later. */
  const commit = useCallback(
    (next: AnnotationDoc, key: string | null = null) => {
      docRef.current = next;
      history.push({ doc: next, rev: revisionsOf(capture.id).disk }, key);
      setDocState(next);
      void saveAnnotations(capture.id, next, props.onError);
      scheduleThumbnail(capture, imgRef.current, next, props.onError);
      syncStore();
      requestDraw();
    },
    [history, capture, props.onError, syncStore, requestDraw],
  );

  /** The same document without a history step (while a drag is under way). */
  const preview = useCallback(
    (next: AnnotationDoc) => {
      docRef.current = next;
      requestDraw();
    },
    [requestDraw],
  );

  // --- coordinates -----------------------------------------------------------------------------------------------------------
  const toImage = useCallback(
    (sx: number, sy: number): Pt => {
      const p = toPicture(viewRef.current, sx, sy);
      return apply(invert(geometry().matrix), p.x, p.y);
    },
    [geometry],
  );
  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const r = stage.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  // --- layout: fit or the chosen zoom, centred ----------------------------------------------------------------------------------
  const relayout = useCallback(() => {
    if (box.width <= 0) return;
    const g = geometry();
    const pic = { width: g.width, height: g.height };
    const zm = latest.current.props.zoomMode;
    const zoom = zm === "fit" ? fitZoom(pic, box) : zm;
    viewRef.current = centred(pic, box, zoom);
    userView.current = false;
    latest.current.props.onZoom(zoom);
    requestDraw();
  }, [box, geometry, requestDraw]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const g0 = geometry();
  useEffect(() => {
    if (!userView.current) relayout();
    else requestDraw();
    // The picture's size changes with crop and rotation.
  }, [box.width, box.height, g0.width, g0.height]);

  useEffect(() => {
    const zm = props.zoomMode;
    // A zoom the editor itself reported (wheel) is not a request to start over.
    if (typeof zm === "number" && Math.abs(zm - viewRef.current.zoom) < 1e-6) return;
    relayout();
  }, [props.zoomMode]);

  // --- drawing -----------------------------------------------------------------------------------------------------------------
  function ensureWork(items: readonly Annotation[]): CanvasImageSource | null {
    if (!img) return null;
    const key = workKey(items);
    if (key === "") return img;
    if (work.current?.key !== key) work.current = { key, canvas: prepareWork(makeCanvas, img, W, H, items) };
    return work.current.canvas as unknown as CanvasImageSource;
  }

  function drawNow() {
    const c = canvas.current;
    if (!c || !img) return;
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(box.width * dpr));
    const bh = Math.max(1, Math.round(box.height * dpr));
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const ctx = c.getContext("2d") as Ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cropping = frame.current !== null;
    const d0 = docRef.current;
    const editing = textEdit?.id;
    const d: AnnotationDoc = {
      ...d0,
      crop: cropping ? null : d0.crop,
      items: [...d0.items.filter((a) => a.id !== editing), ...(draft.current ? [draft.current] : [])],
    };
    const src = ensureWork(d0.items);
    if (!src) return;
    const v = viewRef.current;
    const g = docGeometry(d, W, H);
    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.zoom, v.zoom);
    // A thin shadow under the picture separates it from the stage.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 8 / v.zoom;
    ctx.fillStyle = "rgba(0,0,0,0.01)";
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.restore();
    renderDoc(ctx, src, W, H, d, 1);

    // Overlays in the picture's own coordinates.
    ctx.save();
    ctx.transform(g.matrix[0], g.matrix[1], g.matrix[2], g.matrix[3], g.matrix[4], g.matrix[5]);
    const px = 1 / v.zoom;
    overlays(ctx, d, px);
    const fl = flash.current;
    if (fl) {
      const age = (performance.now() - fl.start) / FLASH_MS;
      if (age >= 1) flash.current = null;
      else {
        ctx.fillStyle = `rgba(255, 214, 0, ${(0.55 * (1 - age)).toFixed(3)})`;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - age).toFixed(3)})`;
        ctx.lineWidth = 2 * px;
        for (const r of fl.rects) {
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        }
        requestAnimationFrame(() => requestDraw());
      }
    }
    ctx.restore();

    if (cropping && frame.current) drawCropOverlay(ctx, frame.current, g.width, g.height, px);
    ctx.restore();

    const t1 = performance.now();
    const s = stats.current;
    s.frames++;
    s.worst = Math.max(s.worst, t1 - t0);
    s.last = t1 - t0;
    placeLayer();
    (window as unknown as { __cropFrame?: unknown }).__cropFrame = frame.current;
    (window as unknown as { __editorStats?: unknown }).__editorStats = { frames: s.frames, last: s.last, worst: s.worst, items: d0.items.length, view: { ...v } };
  }

  /** The text layer lies over the picture: the same offset and zoom as the canvas draws it with. */
  function placeLayer() {
    const l = layerRef.current;
    if (!l) return;
    const v = viewRef.current;
    l.style.transform = `translate(${v.ox}px, ${v.oy}px) scale(${v.zoom})`;
  }

  function overlays(ctx: Ctx, d: AnnotationDoc, px: number) {
    ctx.lineWidth = px;
    // Marks the eraser is about to remove.
    for (const id of eraseIds.current) {
      const a = d.items.find((x) => x.id === id);
      if (!a) continue;
      const b = boundsOf(a);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = "#d32f2f";
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
    }
    const hov = hover.current;
    if (hov && latest.current.ui.tool === "eraser" && !eraseIds.current.has(hov)) {
      const a = d.items.find((x) => x.id === hov);
      if (a) {
        const b = boundsOf(a);
        ctx.strokeStyle = "#d32f2f";
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    }
    if (marquee.current) {
      const m = marquee.current;
      ctx.fillStyle = "rgba(30,136,229,0.12)";
      ctx.strokeStyle = "#1e88e5";
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
    }
    const ia = interaction.current;
    if (ia?.kind === "redact" && ia.rect) {
      ctx.strokeStyle = "#000";
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(ia.rect.x, ia.rect.y, ia.rect.w, ia.rect.h);
      ctx.strokeRect(ia.rect.x, ia.rect.y, ia.rect.w, ia.rect.h);
      ctx.setLineDash([]);
    }
    // Redactions show a hint outline in the select tool so that they can be found (the pixels under them are gone).
    if (latest.current.ui.tool === "select") {
      for (const a of d.items) {
        if (a.type !== "redact") continue;
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        ctx.setLineDash([]);
      }
    }
    // Selection: an outline per mark and handles for a single one.
    const sel = d.items.filter((a) => selRef.current.has(a.id));
    for (const a of sel) {
      const corners = boxCorners(a.type === "line" || a.type === "arrow" ? { ...boxOf(a), rotation: 0 } : boxOf(a));
      ctx.strokeStyle = "#1e88e5";
      ctx.beginPath();
      corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      if (a.type !== "line" && a.type !== "arrow") ctx.stroke();
    }
    if (sel.length === 1) {
      const handles = handlesOf(sel[0], 26 * px);
      const rot = handles.find((h) => h.kind === "rotate");
      const top = handles.find((h) => h.kind === "n");
      if (rot && top) {
        ctx.strokeStyle = "#1e88e5";
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(rot.x, rot.y);
        ctx.stroke();
      }
      for (const h of handles) {
        const r = (h.kind === "rotate" ? 5 : 4) * px;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#1e88e5";
        ctx.beginPath();
        if (h.kind === "rotate" || h.kind === "p1" || h.kind === "p2") ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        else ctx.rect(h.x - r, h.y - r, 2 * r, 2 * r);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  function drawCropOverlay(ctx: Ctx, f: { x: number; y: number; w: number; h: number }, w: number, h: number, px: number) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, w, f.y);
    ctx.fillRect(0, f.y + f.h, w, h - f.y - f.h);
    ctx.fillRect(0, f.y, f.x, f.h);
    ctx.fillRect(f.x + f.w, f.y, w - f.x - f.w, f.h);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.lineWidth = px;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    for (const k of [1, 2]) {
      ctx.beginPath();
      ctx.moveTo(f.x + (f.w * k) / 3, f.y);
      ctx.lineTo(f.x + (f.w * k) / 3, f.y + f.h);
      ctx.moveTo(f.x, f.y + (f.h * k) / 3);
      ctx.lineTo(f.x + f.w, f.y + (f.h * k) / 3);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1e88e5";
    for (const [hx, hy] of [[f.x, f.y], [f.x + f.w / 2, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h / 2], [f.x + f.w, f.y + f.h], [f.x + f.w / 2, f.y + f.h], [f.x, f.y + f.h], [f.x, f.y + f.h / 2]]) {
      ctx.fillRect(hx - 5 * px, hy - 5 * px, 10 * px, 10 * px);
      ctx.strokeRect(hx - 5 * px, hy - 5 * px, 10 * px, 10 * px);
    }
  }

  drawRef.current = drawNow;
  useEffect(() => {
    requestDraw();
  }, [img, doc, box.width, box.height, textEdit, requestDraw]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      // React may run this cleanup and then set the component up again (development mode): drawing must still be possible.
      raf.current = 0;
    },
    [],
  );

  // --- the tools: what the toolbar asks for ---------------------------------------------------------------------------------------
  /** A mark was just made: it is the one that can be edited now, the earlier ones are committed. */
  const makeLive = (ids: string[]) => {
    lockRef.current = madeLive(ids);
    setSelection(ids);
  };
  /** Commit the live marks: they stay, but cannot be selected or edited any more. */
  const commitLive = () => {
    if (lockRef.current.live.size === 0 && selRef.current.size === 0) return;
    lockRef.current = commitAll(lockRef.current);
    setSelection([]);
  };
  const selectedItems = () => docRef.current.items.filter((a) => selRef.current.has(a.id));

  /** Jobs that touch the stored picture run one after the other (a permanent redaction, and undoing it). */
  const enqueue = useCallback(
    (job: () => Promise<void>) => {
      jobs.current = jobs.current.then(job).catch((e) => props.onError(e));
      return jobs.current;
    },
    [props.onError],
  );

  /** The stored picture of this capture is now `bytes`: written to the file and shown. */
  const putImage = useCallback(
    async (bytes: Uint8Array) => {
      const session = await ipc.replaceCaptureImage(capture.id, new Blob([bytes as BlobPart], { type: "image/png" }));
      const { sessionStore } = await import("../sessionStore");
      sessionStore.apply(session);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      try {
        const im = await new Promise<HTMLImageElement>((resolve, reject) => {
          const x = new Image();
          x.onload = () => resolve(x);
          x.onerror = () => reject(new Error("image"));
          x.src = url;
        });
        work.current = null;
        imgRef.current = im;
        setImg(im);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [capture.id],
  );

  const undoRedo = useCallback(
    (dir: "undo" | "redo") => {
      endText(true);
      void enqueue(async () => {
        const entry = dir === "undo" ? history.undo() : history.redo();
        if (!entry) return;
        const revs = revisionsOf(capture.id);
        const plan = planImageSync(revs, entry.rev);
        if (plan.kind !== "none") {
          const bytes = plan.kind === "restore" ? revs.get(plan.rev) : undefined;
          try {
            if (!bytes) throw new Error("The earlier picture is no longer in memory.");
            await putImage(bytes);
            revs.setDisk(plan.rev);
            if (dir === "undo") notify(tRef.current("bake.restored"));
          } catch (e) {
            // The picture could not be brought back: stay where we were.
            if (dir === "undo") history.redo();
            else history.undo();
            throw e;
          }
        }
        const next = entry.doc;
        docRef.current = next;
        setDocState(next);
        // Undo and redo commit whatever was being edited.
        lockRef.current = commitAll(lockRef.current);
        setSelection([]);
        void saveAnnotations(capture.id, next, props.onError);
        scheduleThumbnail(capture, imgRef.current, next, props.onError);
        syncStore();
        requestDraw();
      });
    },
    [history, capture, enqueue, putImage, props.onError, syncStore, requestDraw, setSelection],
  );

  /** Burn the redactions into the stored picture. The earlier picture is kept in memory only (for undo). */
  const bake = useCallback(
    () =>
      enqueue(async () => {
        const d = docRef.current;
        const im = imgRef.current;
        const redacts = d.items.filter((a) => a.type === "redact");
        if (!im || redacts.length === 0) return;
        const revs = revisionsOf(capture.id);
        if (!revs.get(revs.disk)) {
          const res = await fetch(imageUrl(props.session, capture), { cache: "no-store" });
          revs.remember(revs.disk, new Uint8Array(await res.arrayBuffer()));
        }
        const baked = prepareWork(makeCanvas, im, im.naturalWidth, im.naturalHeight, redacts) as unknown as HTMLCanvasElement;
        const blob = await new Promise<Blob | null>((resolve) => baked.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("The picture could not be written.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const rev = revs.allocate();
        revs.remember(rev, bytes);
        await putImage(bytes);
        revs.setDisk(rev);
        const ids = new Set(redacts.map((a) => a.id));
        flash.current = { rects: redacts.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h })), start: performance.now() };
        requestDraw();
        const now = docRef.current;
        setSelection([...selRef.current].filter((id) => !ids.has(id)));
        commit({ ...now, items: now.items.filter((a) => !ids.has(a.id)) });
        notify(tRef.current("bake.doneCount", { count: redacts.length }));
      }),
    [enqueue, putImage, capture, props.session, commit, setSelection, requestDraw],
  );

  /** The picture the text is read from: crop, rotation and flip applied, redactions burned in, no other marks. */
  const renderForOcr = useCallback(async (d: AnnotationDoc): Promise<Blob | null> => {
    const im = imgRef.current;
    if (!im) return null;
    const w = im.naturalWidth;
    const h = im.naturalHeight;
    const only: AnnotationDoc = { ...d, items: d.items.filter((a) => a.type === "redact") };
    const g = docGeometry(only, w, h);
    const src = workKey(only.items) === "" ? im : (prepareWork(makeCanvas, im, w, h, only.items) as unknown as CanvasImageSource);
    const c = makeCanvas(g.width, g.height) as HTMLCanvasElement;
    renderDoc(c.getContext("2d") as Ctx, src, w, h, only, 1);
    return new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  }, []);

  const { ocr, ensure } = useOcr({
    captureId: capture.id,
    doc,
    docRef,
    languages: settings.ocrLanguages,
    active: ui.textMode || !!props.searchQuery,
    render: renderForOcr,
    onError: (message) => notify(tRef.current("ocr.failed", { message }), true),
  });

  useEffect(() => {
    editorStore.set({ hasText: !!ocr && !isEmpty(ocr), hasTable: !!ocr && detectTable(ocr) !== null });
  }, [ocr]);

  const searchHits = useMemo(() => {
    if (!props.searchQuery || !ocr) return undefined;
    const hits = matchingWords(ocr, props.searchQuery);
    return hits.size > 0 ? hits : undefined;
  }, [props.searchQuery, ocr]);
  useLayoutEffect(() => placeLayer(), [ocr, ui.textMode, searchHits]);

  const enterCrop = useCallback(() => {
    const d = docRef.current;
    frame.current = frameFromCrop(d.crop, d, W, H);
    editorStore.set({ cropping: true });
    setSelection([]);
    userView.current = false;
    relayout();
  }, [W, H, relayout, setSelection]);

  const leaveCrop = useCallback(() => {
    frame.current = null;
    editorStore.set({ cropping: false });
    if (latest.current.ui.tool === "crop") editorStore.setTool("select");
    relayout();
  }, [relayout]);

  const applyCrop = useCallback(() => {
    const f = frame.current;
    if (!f) return;
    const d = docRef.current;
    const g = uncroppedGeometry(d, W, H);
    const full = Math.abs(f.w - g.width) < 1 && Math.abs(f.h - g.height) < 1 && f.x < 1 && f.y < 1;
    const crop = full ? null : cropFromFrame(f, d, W, H);
    leaveCrop();
    if (JSON.stringify(crop) !== JSON.stringify(d.crop)) commit({ ...d, crop });
  }, [W, H, leaveCrop, commit]);

  const actions = useMemo(
    () => ({
      undo: () => undoRedo("undo"),
      redo: () => undoRedo("redo"),
      eraseAll: () => {
        const d = docRef.current;
        if (d.items.length === 0) return;
        setSelection([]);
        commit({ ...d, items: [] });
      },
      rotate: (turns: number) => {
        const d = docRef.current;
        userView.current = false;
        commit({ ...d, rotation: turned(d.rotation, turns) });
      },
      flip: (axis: "h" | "v") => {
        userView.current = false;
        commit({ ...docRef.current, ...flippedOnScreen(docRef.current, axis) });
      },
      cropApply: applyCrop,
      cropCancel: leaveCrop,
      cropReset: () => {
        const d = docRef.current;
        if (frame.current) {
          const g = uncroppedGeometry(d, W, H);
          frame.current = { x: 0, y: 0, w: g.width, h: g.height };
          requestDraw();
        } else if (d.crop) commit({ ...d, crop: null });
      },
      setAspect: (id: (typeof ASPECTS)[number]["id"]) => {
        editorStore.set({ aspect: id });
        const ratio = ASPECTS.find((a) => a.id === id)?.ratio ?? null;
        if (frame.current && ratio) {
          const g = uncroppedGeometry(docRef.current, W, H);
          frame.current = fitAspect(frame.current, ratio, { w: g.width, h: g.height });
          requestDraw();
        }
      },
      copyAllText: () => {
        void (async () => {
          const o = await ensure();
          if (!o) return;
          if (isEmpty(o)) return notify(tRef.current("ocr.none"));
          await ipc.copyText(o.text);
          notify(tRef.current("ocr.copied"));
        })().catch(props.onError);
      },
      copyTable: () => {
        void (async () => {
          const o = await ensure();
          if (!o) return;
          const table = detectTable(o);
          if (!table) return notify(tRef.current(isEmpty(o) ? "ocr.none" : "ocr.noTable"));
          await ipc.copyTable(toHtml(table), toTsv(table));
          notify(tRef.current("ocr.tableCopied"));
        })().catch(props.onError);
      },
      quickRedact: (options: FindOptions) => {
        void (async () => {
          if (!anythingChosen(options)) return;
          const o = await ensure();
          if (!o) return;
          const found = quickRects(o, options);
          const d = docRef.current;
          const marks = redactionsFor(found.rects, docGeometry(d, W, H).matrix, { width: W, height: H });
          if (marks.length === 0) return notify(tRef.current(isEmpty(o) ? "ocr.none" : "ocr.nothingFound"));
          commit({ ...d, items: [...d.items, ...marks] });
          notify(tRef.current("ocr.redacted", { count: marks.length }));
        })().catch(props.onError);
      },
      removeQuickRedactions: () => {
        const d = docRef.current;
        const items = d.items.filter((a) => !(a.type === "redact" && a.origin === "quick"));
        if (items.length === d.items.length) return;
        setSelection([...selRef.current].filter((id) => items.some((a) => a.id === id)));
        commit({ ...d, items });
      },
      askBake: () => {
        if (hasRedactions(docRef.current)) setBakeAsk(true);
      },
      restyle: (patch: Partial<ToolValues>) => {
        const sel = selectedItems();
        if (sel.length === 0) return;
        const d = docRef.current;
        const items = d.items.map((a) => {
          if (!selRef.current.has(a.id)) return a;
          const next = restyle(a, imagePatch(patch, viewRef.current.zoom));
          // A text box is measured again when its size, label or colour changed.
          return next.type === "text" && next !== a ? measuredText(next) : next;
        });
        if (JSON.stringify(items) !== JSON.stringify(d.items)) commit({ ...d, items }, styleKey(patch));
      },
    }),
    [undoRedo, applyCrop, leaveCrop, commit, setSelection, W, H, requestDraw, ensure, props.onError],
  );

  useEffect(() => editorStore.register(actions), [actions]);
  useEffect(() => () => editorStore.reset(), []);
  useEffect(() => {
    if (img) syncStore();
  }, [img, syncStore]);

  // The tool changed: leave what the old tool was doing.
  useEffect(() => {
    if (ui.tool === "crop" && !frame.current && img) enterCrop();
    if (ui.tool !== "crop" && frame.current) leaveCrop();
    // Changing the tool commits the live marks (except the hand-over of the Text and emoji tools to Select).
    if (keepLiveOnToolChange.current) keepLiveOnToolChange.current = false;
    else commitLive();
    if (ui.tool !== "text") endText(true);
    hover.current = null;
    setCursor(cursorFor(null));
  }, [ui.tool, img]);

  // --- text ---------------------------------------------------------------------------------------------------------------------------
  const startText = (id: string, isNew: boolean, click?: { x: number; y: number }) => setTextEdit({ id, isNew, click });
  const lastDown = useRef<{ x: number; y: number } | null>(null);

  /** Finish the text box: keep the text (measured), or remove the mark when it is empty. */
  function endText(commitIt: boolean) {
    const te = textEditRef.current;
    if (!te) return;
    // One text per activation of the Text tool: when the box is finished the tool goes back to Select, with the box selected.
    const backToSelect = latest.current.ui.tool === "text";
    const finishTool = (keep: boolean) => {
      if (!backToSelect) return;
      if (keep) makeLive([te.id]);
      keepLiveOnToolChange.current = keep;
      editorStore.setTool("select");
    };
    if (textSM.current.kind === "editing") textSM.current = { kind: "idle" };
    const area = textArea.current;
    textEditRef.current = null;
    setTextEdit(null);
    if (!commitIt) return finishTool(false);
    const d = docRef.current;
    const text = area?.value ?? "";
    const existing = d.items.find((a) => a.id === te.id) as TextAnnotation | undefined;
    if (!existing) return;
    if (text.trim() === "") {
      if (!te.isNew || d.items.some((a) => a.id === te.id)) {
        const items = d.items.filter((a) => a.id !== te.id);
        if (te.isNew) {
          // A mark that was never kept leaves no step behind.
          docRef.current = { ...d, items };
          setDocState(docRef.current);
          requestDraw();
        } else commit({ ...d, items });
      }
      return finishTool(false);
    }
    if (text === existing.text && !te.isNew) return finishTool(true);
    commit({ ...d, items: d.items.map((a) => (a.id === te.id ? measuredText({ ...existing, text }) : a)) });
    finishTool(true);
  }

  const textEditRef = useRef<TextEdit | null>(null);
  textEditRef.current = textEdit;
  const textArea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!textEdit) return;
    requestAnimationFrame(() => {
      const a = textArea.current;
      if (!a) return;
      // The box is as high as its text from the start (a wrapped text has several lines).
      a.style.height = "auto";
      a.style.height = `${a.scrollHeight}px`;
      a.focus();
      // The caret goes where the user clicked into an existing text (at the end for a new one).
      const at = textEdit.click ? caretIndexAt(a, textEdit.click.x, textEdit.click.y) : a.value.length;
      a.setSelectionRange(at, at);
    });
  }, [textEdit]);

  // --- pointer -------------------------------------------------------------------------------------------------------------------------
  const tolerance = () => 6 / viewRef.current.zoom;

  /** The marks made last that may be moved by pressing their body: not a freehand stroke, which the pen draws next to. */
  const snappedId = useRef<string | null>(null);
  const movableLive = (a: Annotation) => (a.type !== "pen" && a.type !== "highlighter") || a.id === snappedId.current;
  /** Is the point on the body or the border of the mark that was just made (also inside an outline without fill)? */
  const onLiveBody = (a: Annotation, p: Pt) => {
    const tol = tolerance();
    if (hitTest(a, p, tol)) return true;
    const b = boundsOf(a);
    const r = "rotation" in a && typeof a.rotation === "number" ? a.rotation : 0;
    if (r === 0) return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    return false;
  };

  /** The cursor for a tool (and for a point on the picture: the handles and body of the mark that was just made). */
  const cursorFor = (p: Pt | null): string => {
    const tool = latest.current.ui.tool;
    if (spaceDown.current) return "grab";
    if (p && !frame.current && tool !== "eraser") {
      const live = docRef.current.items.filter((a) => selRef.current.has(a.id));
      if (live.length === 1) {
        const a = live[0];
        const h = handleAt(handlesOf(a, 26 / viewRef.current.zoom), p, 10 / viewRef.current.zoom);
        if (h) {
          if (h.kind === "rotate") return rotateCursor();
          return resizeCursor(h.kind, "rotation" in a && typeof a.rotation === "number" ? a.rotation : 0, docRef.current.rotation);
        }
        if (tool !== "text" && movableLive(a) && onLiveBody(a, p)) return "move";
      }
    }
    const v = values.current;
    switch (tool) {
      case "select":
        return "default";
      case "pen":
        return brushCursor(v.lastPenColor, v.lastPenSize);
      case "highlighter":
        return brushCursor(v.lastHighlighterColor, v.lastHighlighterSize);
      case "eraser":
        return eraserCursor();
      case "text":
        return "text";
      default:
        return thinCrosshairCursor();
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // A press inside the box being typed in belongs to the text field (the caret moves; the box neither moves nor ends).
    if (textArea.current && e.target === textArea.current) return;
    // Presses on the context menu belong to the menu (the stage would capture the pointer and the menu items never get their click).
    if ((e.target as HTMLElement).closest?.(".ctxmenu")) return;
    lastDown.current = { x: e.clientX, y: e.clientY };
    stage.current?.focus({ preventScroll: true });
    const wasTyping = !!textEditRef.current;
    if (wasTyping) endText(true);
    if (!img) return;
    // A press that finishes a text box with the Text tool does nothing else (no second box).
    if (wasTyping && latest.current.ui.tool === "text") return;
    const s = stagePoint(e);
    stage.current?.setPointerCapture(e.pointerId);
    // Pan: middle button, or Space held.
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      interaction.current = { kind: "pan", sx: s.x, sy: s.y, ox: viewRef.current.ox, oy: viewRef.current.oy };
      setCursor("grabbing");
      return;
    }
    if (e.button !== 0) return;
    const p = toImage(s.x, s.y);
    const tool = latest.current.ui.tool;
    const d = docRef.current;
    // The popovers show sizes as they look on the screen; the mark gets the picture pixels they come to at this zoom.
    const v = imageValues(values.current, viewRef.current.zoom);

    if (frame.current) {
      const out = toPicture(viewRef.current, s.x, s.y);
      const handle = cropHandleAt(frame.current, out, 10 / viewRef.current.zoom);
      if (handle) interaction.current = { kind: "crop", handle, start: out, frame: { ...frame.current } };
      return;
    }

    // The mark that was just made (if any) can be resized or rotated by its handles, in any tool.
    const liveSel = d.items.filter((a) => selRef.current.has(a.id));
    if (liveSel.length === 1 && tool !== "eraser" && tool !== "crop") {
      const h = handleAt(handlesOf(liveSel[0], 26 / viewRef.current.zoom), p, 10 / viewRef.current.zoom);
      if (h) {
        interaction.current = { kind: "handle", id: liveSel[0].id, handle: h.kind, base: d, moved: false };
        return;
      }
    }
    // Pressing the body or the border of the mark that was just made moves it, with any tool.
    if (liveSel.length === 1 && tool !== "eraser" && tool !== "crop" && tool !== "text" && movableLive(liveSel[0]) && onLiveBody(liveSel[0], p)) {
      interaction.current = { kind: "move", ids: [liveSel[0].id], start: p, base: d, moved: false };
      setCursor("move");
      return;
    }
    if (tool === "select") {
      // The Select tool is the neutral pointer: it moves the mark that was just made, and a press anywhere else commits it.
      const hit = topmostAt(selectable(lockRef.current, d.items), p, tolerance());
      if (hit) {
        interaction.current = { kind: "move", ids: [...selRef.current], start: p, base: d, moved: false };
        setCursor("move");
      } else commitLive();
      return;
    }
    // Drawing with another tool commits the mark that was just made (unless the press is on that mark's handle, above).
    if (tool !== "text" && tool !== "eraser") commitLive();
    if (tool === "pen" || tool === "highlighter") {
      const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
      const pts = [p.x, p.y, pressure];
      const ann = tool === "pen" ? newPen(pts, v) : newHighlighter(pts, v);
      draft.current = ann;
      interaction.current = { kind: "stroke", ann, raw: pts };
      requestDraw();
      return;
    }
    if (tool === "eraser") {
      eraseIds.current = new Set();
      interaction.current = { kind: "erase", ids: eraseIds.current };
      eraseAt(p);
      return;
    }
    if (tool === "shapes") {
      const kind = latest.current.ui.shape;
      if (kind === "emoji") {
        const size = emojiImageSize(viewRef.current.zoom);
        const e2 = newEmoji(latest.current.ui.emoji, p, size);
        commit({ ...d, items: [...d.items, e2] });
        makeLive([e2.id]);
        keepLiveOnToolChange.current = true;
        editorStore.setTool("select");
        return;
      }
      interaction.current = { kind: "shape", start: p, ann: null };
      return;
    }
    if (tool === "text") {
      // The handles of the selected text work in the Text tool too (scale, wrap, rotate).
      const hit = topmostAt(selectable(lockRef.current, d.items).filter((a) => a.type === "text"), p, tolerance());
      const step = textStep(textSM.current, { type: "down", hit, inEditBox: false });
      textSM.current = step.state;
      for (const eff of step.effects) {
        if (eff.type === "create") {
          const a = newText(p, v);
          // The new mark exists in the document (without a history step) while it is typed.
          docRef.current = { ...d, items: [...d.items, a] };
          setDocState(docRef.current);
          makeLive([a.id]);
          startText(a.id, true);
          textSM.current = createdBox(textSM.current, a.id);
        } else if (eff.type === "select") {
          // Pressing a text selects it; a drag moves it, letting go without dragging edits it.
          setSelection([eff.id]);
          interaction.current = { kind: "move", ids: [eff.id], start: p, base: d, moved: false };
        }
      }
      return;
    }
    if (tool === "blur") {
      interaction.current = { kind: "redact", start: p, rect: null };
    }
  };

  function eraseAt(p: Pt) {
    const tol = tolerance();
    for (const a of docRef.current.items) {
      if (hitTest(a, p, tol)) eraseIds.current.add(a.id);
    }
    requestDraw();
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const ia = interaction.current;
    const s = stagePoint(e);
    if (!ia) {
      if (img) {
        const c = cursorFor(toImage(s.x, s.y));
        if (c !== cursorRef.current) setCursor(c);
      }
      if (latest.current.ui.tool === "eraser" && img) {
        const id = topmostAt(docRef.current.items, toImage(s.x, s.y), tolerance());
        if (id !== hover.current) {
          hover.current = id;
          requestDraw();
        }
      }
      return;
    }
    const d = docRef.current;
    const shift = e.shiftKey;
    switch (ia.kind) {
      case "pan": {
        const g = geometry();
        viewRef.current = clampPan({ ...viewRef.current, ox: ia.ox + s.x - ia.sx, oy: ia.oy + s.y - ia.sy }, g, box);
        userView.current = true;
        requestDraw();
        return;
      }
      case "stroke": {
        if (ia.snapped) return;
        const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
        const list = events.length > 0 ? events : [e.nativeEvent];
        for (const ev of list) {
          const q = stagePoint(ev);
          const p = toImage(q.x, q.y);
          ia.raw.push(p.x, p.y, ev.pointerType === "pen" ? ev.pressure || 0.5 : 0.5);
        }
        // Shift: a straight line from where the stroke started to where the pointer is now. Letting go of Shift goes back
        // to the free stroke, which was kept.
        const raw = ia.raw;
        ia.ann = { ...ia.ann, points: shift ? straighten([raw[0], raw[1], raw[2], ...raw.slice(-3)]) : raw.slice() };
        draft.current = ia.ann;
        // Held still for about a second: the stroke may snap to a clean shape (see src/annotate/shapeRecognizer.ts).
        window.clearTimeout(holdTimer.current);
        holdTimer.current = window.setTimeout(() => snapStroke(ia), HOLD_MS);
        requestDraw();
        return;
      }
      case "shape": {
        const p = toImage(s.x, s.y);
        const kind = latest.current.ui.shape;
        const v = imageValues(values.current, viewRef.current.zoom);
        if (isBoxShape(kind)) ia.ann = newShape(kind, dragRect(ia.start, p, shift), v);
        else {
          const [a, b] = dragLine(ia.start, p, shift);
          ia.ann = newLine(kind === "arrow" ? "arrow" : "line", a, b, v);
        }
        draft.current = ia.ann;
        requestDraw();
        return;
      }
      case "erase":
        eraseAt(toImage(s.x, s.y));
        return;
      case "move": {
        const p = toImage(s.x, s.y);
        const dx = p.x - ia.start.x;
        const dy = p.y - ia.start.y;
        if (!ia.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return;
        ia.moved = true;
        const ids = new Set(ia.ids);
        preview({ ...ia.base, items: ia.base.items.map((a) => (ids.has(a.id) ? translate(a, dx, dy) : a)) });
        return;
      }
      case "handle": {
        const p = toImage(s.x, s.y);
        ia.moved = true;
        preview({
          ...ia.base,
          items: ia.base.items.map((a) => {
            if (a.id !== ia.id) return a;
            // A text scales with its corners and wraps again with its sides (see textLayout.ts); the rest uses the plain handles.
            return a.type === "text" && ia.handle !== "rotate" ? resizeText(a, ia.handle, p, fontMeasure) : dragHandle(a, ia.handle, p, shift);
          }),
        });
        return;
      }
      case "marquee": {
        const p = toImage(s.x, s.y);
        const r = dragRect(ia.start, p, false);
        marquee.current = r;
        const inside = itemsInRect(d.items, r);
        setSelection(ia.add ? [...new Set([...ia.before, ...inside])] : inside);
        requestDraw();
        return;
      }
      case "redact": {
        const p = toImage(s.x, s.y);
        ia.rect = dragRect(ia.start, p, false);
        requestDraw();
        return;
      }
      case "crop": {
        const g = uncroppedGeometry(d, W, H);
        const out = toPicture(viewRef.current, s.x, s.y);
        const ratio = ASPECTS.find((a) => a.id === latest.current.ui.aspect)?.ratio ?? null;
        frame.current = resizeFrame(ia.frame, ia.handle, out.x - ia.start.x, out.y - ia.start.y, { w: g.width, h: g.height }, ratio);
        requestDraw();
        return;
      }
    }
  };

  const finish = (cancel: boolean) => {
    const ia = interaction.current;
    interaction.current = null;
    setCursor(cursorFor(null));
    if (textSM.current.kind === "pressed") {
      // The press on a text ended: without a drag the text is edited.
      const moved = ia?.kind === "move" && ia.moved;
      const step = textStep(textSM.current, { type: "up", moved: cancel || moved });
      textSM.current = step.state;
      if (!cancel) {
        // The move (if any) is committed below; editing starts after it.
        window.setTimeout(() => {
          for (const eff of step.effects) if (eff.type === "edit") startText(eff.id, false, lastDown.current ?? undefined);
        }, 0);
      }
    }
    if (!ia) return;
    const d = docRef.current;
    switch (ia.kind) {
      case "stroke": {
        draft.current = null;
        window.clearTimeout(holdTimer.current);
        if (cancel) break;
        // A stroke that was held still became a clean shape; that one is kept.
        const made = ia.snapped ?? ia.ann;
        snappedId.current = ia.snapped ? made.id : null;
        commit({ ...d, items: [...d.items, made] });
        makeLive([made.id]);
        break;
      }
      case "shape": {
        draft.current = null;
        const a = ia.ann;
        if (!cancel && a) {
          const b = boundsOf(a);
          if (Math.max(b.w, b.h) * viewRef.current.zoom >= 4) {
            commit({ ...d, items: [...d.items, a] });
            makeLive([a.id]);
          }
        }
        break;
      }
      case "erase": {
        const ids = new Set(eraseIds.current);
        eraseIds.current = new Set();
        if (!cancel && ids.size > 0) commit({ ...d, items: d.items.filter((a) => !ids.has(a.id)) });
        break;
      }
      case "move":
      case "handle":
        if (cancel) docRef.current = ia.base;
        else if (ia.moved) {
          const next = docRef.current;
          docRef.current = ia.base;
          commit(next);
          // The size popover of the text tool shows the size the text has now.
          const grown = ia.kind === "handle" ? next.items.find((a) => a.id === ia.id) : undefined;
          if (grown?.type === "text") {
            const size = Math.min(TEXT_SIZE_RANGE.max, Math.max(TEXT_SIZE_RANGE.min, Math.round(toScreenPx(grown.fontSize, viewRef.current.zoom))));
            if (size !== latest.current.props.settings.lastTextSize) latest.current.props.onPatch?.({ lastTextSize: size });
          }
        }
        break;
      case "marquee":
        marquee.current = null;
        break;
      case "redact": {
        const r = ia.rect;
        if (!cancel && r && Math.min(r.w, r.h) * viewRef.current.zoom >= 4) {
          const item = { type: "redact" as const, id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, ...r, mode: latest.current.ui.redactMode };
          commit({ ...d, items: [...d.items, item] });
          makeLive([item.id]);
        }
        break;
      }
      default:
        break;
    }
    requestDraw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    stage.current?.releasePointerCapture?.(e.pointerId);
    finish(false);
  };

  /** The text of the layer: selected and copied (the menu and Ctrl+A / Ctrl+C use these). */
  function selectAllText() {
    const l = layerRef.current;
    if (!l) return;
    const range = document.createRange();
    range.selectNodeContents(l);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    l.focus({ preventScroll: true });
  }

  function copySelection() {
    const l = layerRef.current;
    const text = l && ocr ? selectedText(l, ocr) : "";
    if (!text) return;
    void ipc.copyText(text).then(() => notify(tRef.current("ocr.copied")), props.onError);
  }

  // --- keyboard ----------------------------------------------------------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (textEditRef.current) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "a") && layerRef.current?.contains(e.target as Node)) {
      if (e.key === "a") {
        e.preventDefault();
        selectAllText();
      }
      return;
    }
    if (e.key === " ") {
      spaceDown.current = true;
      e.preventDefault();
      setCursor("grab");
      return;
    }
    const undo = undoKeyFor(e);
    if (undo) {
      e.preventDefault();
      undoRedo(undo);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (interaction.current) finish(true);
      else if (frame.current) leaveCrop();
      else if (selRef.current.size > 0 || lockRef.current.live.size > 0) commitLive();
      else editorStore.setTool("select");
      return;
    }
    if (e.key === "Enter" && !frame.current && lockRef.current.live.size > 0) {
      e.preventDefault();
      commitLive();
      return;
    }
    if (e.key === "Enter" && frame.current) {
      e.preventDefault();
      applyCrop();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      const d = docRef.current;
      const ids = new Set(selRef.current);
      setSelection([]);
      commit({ ...d, items: d.items.filter((a) => !ids.has(a.id)) });
      return;
    }
    if (e.key.startsWith("Arrow") && selRef.current.size > 0 && !e.ctrlKey) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const d = docRef.current;
      // Arrow keys move on the screen, whatever the rotation of the picture.
      const m = geometry().matrix;
      const inv = invert(m);
      const v = { x: inv[0] * dx + inv[2] * dy, y: inv[1] * dx + inv[3] * dy };
      commit({ ...d, items: d.items.map((a) => (selRef.current.has(a.id) ? translate(a, v.x, v.y) : a)) }, "nudge");
      return;
    }
    const tool = toolForKey(e);
    if (tool) {
      e.preventDefault();
      if (tool === "rotate") actions.rotate(1);
      else editorStore.setTool(tool);
    }
  };

  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") {
        spaceDown.current = false;
        setCursor(cursorFor(null));
      }
    };
    // Ctrl+Z / Ctrl+Y work wherever the focus is, except while typing in a box.
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (stage.current?.contains(target)) return; // the stage handles its own keys
      const undo = undoKeyFor(e);
      if (undo) {
        e.preventDefault();
        undoRedo(undo);
      }
    };
    window.addEventListener("keyup", up);
    window.addEventListener("keydown", down);
    return () => {
      window.removeEventListener("keyup", up);
      window.removeEventListener("keydown", down);
    };
  }, [undoRedo]);

  // The wheel (a native listener: React's wheel handlers cannot cancel the page zoom). Zooming eases towards a target so a
  // notch is smooth; the parent is told once the zoom has settled (its redraw of the whole window made the first zoom hitch).
  const zoomTarget = useRef<ZoomTarget | null>(null);
  const zoomTimer = useRef(0);
  const zoomReport = useRef(0);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let last = 0;
    const report = () => {
      window.clearTimeout(zoomReport.current);
      zoomReport.current = window.setTimeout(() => {
        const z = viewRef.current.zoom;
        latest.current.props.onZoom(z);
        latest.current.props.onZoomMode(z);
      }, 120);
    };
    const tick = (now: number) => {
      zoomTimer.current = 0;
      const target = zoomTarget.current;
      if (!target) return;
      const z = stepZoom(viewRef.current.zoom, target.zoom, Math.min(64, now - last));
      last = now;
      viewRef.current = clampPan(zoomAt(viewRef.current, z, target.x, target.y), geometry(), box);
      userView.current = true;
      drawRef.current();
      if (z === target.zoom) {
        zoomTarget.current = null;
        report();
      } else zoomTimer.current = requestAnimationFrame(tick);
    };
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".cropbar,.editor__text")) return;
      const action = wheelAction(e, latest.current.props.settings.editorWheel);
      // Ctrl + wheel is the browser's page zoom otherwise: always ours.
      if (action || e.ctrlKey || e.metaKey) e.preventDefault();
      if (!action) return;
      if (action.kind === "pan") {
        const v = viewRef.current;
        viewRef.current = clampPan({ ...v, ox: v.ox + action.dx, oy: v.oy + action.dy }, geometry(), box);
        userView.current = true;
        requestDraw();
        return;
      }
      const r = el.getBoundingClientRect();
      zoomTarget.current = nextTarget(zoomTarget.current, viewRef.current.zoom, action.factor, e.clientX - r.left, e.clientY - r.top, clampZoom);
      if (!zoomTimer.current) {
        last = performance.now();
        zoomTimer.current = requestAnimationFrame(tick);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(zoomTimer.current);
      zoomTimer.current = 0;
      window.clearTimeout(zoomReport.current);
    };
  }, [geometry, box, requestDraw]);

  // Leaving the capture: whatever is half done is kept (a stroke) or finished (a text), and the saves are flushed.
  useEffect(
    () => () => {
      if (interaction.current?.kind === "stroke" || interaction.current?.kind === "shape") finish(false);
      endText(true);
      flushThumbnail(capture.id);
    },
    [],
  );


  // --- the text box --------------------------------------------------------------------------------------------------------------------
  const editing = textEdit ? (doc.items.find((a) => a.id === textEdit.id) as TextAnnotation | undefined) : undefined;
  const textBoxStyle = (() => {
    if (!editing) return undefined;
    const g = geometry();
    const v = viewRef.current;
    const o = apply(g.matrix, editing.x, editing.y);
    const s = toStage(v, o.x, o.y);
    const rtl = isRtlText(editing.text);
    const pad = editing.background ? labelPadding(editing.fontSize) * v.zoom : 0;
    // A text with a fixed width wraps inside it, like the rendered text.
    const wrap = editing.fixedWidth
      ? { width: Math.max(1, editing.w * v.zoom - 2 * pad), whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const, boxSizing: "content-box" as const }
      : {};
    return {
      ...wrap,
      left: s.x,
      top: s.y,
      fontSize: editing.fontSize * v.zoom,
      lineHeight: 1.25,
      color: editing.color,
      padding: pad,
      background: editing.background ? (editing.color && parseInt(editing.color.slice(1), 16) > 0x808080 ? "#000" : "#fff") : "transparent",
      direction: rtl ? ("rtl" as const) : ("ltr" as const),
      transform: `rotate(${editing.rotation + (docRef.current.rotation * Math.PI) / 180}rad)`,
      transformOrigin: "0 0",
      fontFamily: FONT_STACK,
    };
  })();

  /** Redact just the selected text (one undo step); the list of words stays as it is. */
  function redactSelection() {
    const o = ocr;
    const layer = layerRef.current;
    if (!o || !layer) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const touched: number[] = [];
    layer.querySelectorAll<HTMLElement>("[data-n]").forEach((el) => {
      if (sel.containsNode(el, true)) touched.push(Number(el.dataset.n));
    });
    const rects = touched.map((n) => o.words[n]).filter(Boolean).map((w) => ({ x: w.x - 2, y: w.y - 2, w: w.w + 4, h: w.h + 4 }));
    if (rects.length === 0) return;
    const d = docRef.current;
    const marks = redactionsFor(rects, docGeometry(d, W, H).matrix, { width: W, height: H });
    if (marks.length === 0) return;
    commit({ ...d, items: [...d.items, ...marks] });
    notify(tRef.current("ocr.redacted", { count: marks.length }));
  }

  /** Add the selected text to the words Quick redact always covers (Settings, Text recognition). */
  function alwaysRedact() {
    const text = (layerRef.current && ocr ? selectedText(layerRef.current, ocr) : "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const words = props.settings.quickRedactWords;
    if (!words.some((w) => w.toLowerCase() === text.toLowerCase())) props.onPatch?.({ quickRedactWords: [...words, text], quickRedactCustom: true });
    notify(t("ocr.wordAdded", { word: text }));
  }

  const menuEntries: MenuEntry[] = [
    { kind: "item", id: "copy", label: t("ocr.menuCopy"), icon: "copytext", onSelect: copySelection },
    { kind: "item", id: "all", label: t("ocr.copyAll"), icon: "copytext", onSelect: () => actions.copyAllText() },
    { kind: "item", id: "sel", label: t("ocr.selectAll"), onSelect: selectAllText },
    { kind: "separator", id: "sepAlways" },
    { kind: "item", id: "only", label: t("ocr.menuRedactOnly"), icon: "redact", onSelect: redactSelection },
    { kind: "item", id: "always", label: t("ocr.menuAlways"), icon: "redact", onSelect: alwaysRedact },
  ];

  const label = capture.name;
  return (
    <div
      ref={stage}
      className={`editor editor--${ui.tool}${ui.cropping ? " editor--cropping" : ""}`}
      style={{ cursor }}
      tabIndex={0}
      role="application"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => finish(true)}
      onKeyDown={onKeyDown}
      onDoubleClick={(e) => {
        if (latest.current.ui.tool !== "select") return;
        const s = stagePoint(e);
        const p = toImage(s.x, s.y);
        const hit = topmostAt(selectable(lockRef.current, docRef.current.items).filter((a) => a.type === "text"), p, tolerance());
        if (hit) {
          setSelection([hit]);
          startText(hit, false, { x: e.clientX, y: e.clientY });
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvas} className="editor__canvas" style={{ width: box.width, height: box.height }} />
      {(ui.textMode || searchHits) && ocr && !ui.cropping && (
        <TextLayer
          ref={layerRef}
          doc={ocr}
          dim={ui.textMode}
          hits={searchHits}
          passive={!ui.textMode}
          onCopy={() => notify(t("ocr.copied"))}
          onMenu={(x, y) => setMenu({ x, y })}
        />
      )}
      {editing && textBoxStyle && (
        <textarea
          key={editing.id}
          ref={textArea}
          className="editor__text"
          style={textBoxStyle}
          defaultValue={editing.text}
          dir="auto"
          aria-label={t("tools.text")}
          spellCheck={false}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            if (editing.fixedWidth) return;
            el.style.width = "auto";
            el.style.width = `${Math.max(el.scrollWidth + 4, editing.fontSize * viewRef.current.zoom)}px`;
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              endText(true);
              stage.current?.focus();
            }
          }}
          onBlur={() => endText(true)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
      {ui.cropping && <CropBar />}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={t("ocr.label")} entries={menuEntries} onClose={() => setMenu(null)} />
      )}
      <Dialog
        open={bakeAsk}
        title={t("bake.title")}
        onClose={() => setBakeAsk(false)}
        footer={
          <>
            <Button onClick={() => setBakeAsk(false)}>{t("bake.cancel")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setBakeAsk(false);
                void bake();
              }}
            >
              {t("bake.confirm")}
            </Button>
          </>
        }
      >
        <p>{t("bake.body")}</p>
      </Dialog>
    </div>
  );
}

function CropBar() {
  const { t } = useT();
  const ui = useEditorUi();
  return (
    <div className="cropbar" role="toolbar" aria-label={t("tools.crop")} onPointerDown={(e) => e.stopPropagation()}>
      <select className="dw-select" aria-label={t("crop.aspect")} value={ui.aspect} onChange={(e) => editorStore.actions.setAspect(e.target.value as never)}>
        {ASPECTS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.id === "free" ? t("crop.free") : a.id}
          </option>
        ))}
      </select>
      <button type="button" className="dw-btn" onClick={() => editorStore.actions.cropReset()}>
        {t("crop.reset")}
      </button>
      <button type="button" className="dw-btn" onClick={() => editorStore.actions.cropCancel()} aria-label={t("crop.cancel")} title={`${t("crop.cancel")} (Esc)`}>
        ✕
      </button>
      <button type="button" className="dw-btn dw-btn--primary" onClick={() => editorStore.actions.cropApply()} aria-label={t("crop.apply")} title={`${t("crop.apply")} (Enter)`}>
        ✓
      </button>
    </div>
  );
}

// --- thumbnails ------------------------------------------------------------------------------------------------------------------------

interface PendingThumb {
  timer: number;
  run: () => Promise<void>;
}
const pending = new Map<string, PendingThumb>();

/** A moment after the last edit, the card thumbnail is redrawn with the shared renderer and sent to the backend. */
function scheduleThumbnail(capture: Capture, img: HTMLImageElement | null, doc: AnnotationDoc, onError: (e: unknown) => void): void {
  if (!img) return;
  const old = pending.get(capture.id);
  if (old) window.clearTimeout(old.timer);
  const run = async () => {
    pending.delete(capture.id);
    try {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const g = docGeometry(doc, W, H);
      const scale = Math.min(1, THUMB_BOUNDS.width / g.width, THUMB_BOUNDS.height / g.height);
      const items = doc.items;
      const src = workKey(items) === "" ? img : (prepareWork(makeCanvas, img, W, H, items) as unknown as CanvasImageSource);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(g.width * scale));
      c.height = Math.max(1, Math.round(g.height * scale));
      const ctx = c.getContext("2d") as Ctx;
      renderDoc(ctx, src, W, H, doc, scale);
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
      if (!blob) return;
      // Saves of the annotations come first, so the thumbnail always matches what is stored.
      const { sessionStore } = await import("../sessionStore");
      sessionStore.apply(await ipc.setCaptureThumbnail(capture.id, blob));
    } catch (e) {
      onError(e);
    }
  };
  pending.set(capture.id, { timer: window.setTimeout(() => void run(), 900), run });
}

function flushThumbnail(id: string): void {
  const p = pending.get(id);
  if (!p) return;
  window.clearTimeout(p.timer);
  void p.run();
}

