import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { useT } from "../i18n";
import type { GuideStep } from "../ipc";
import {
  FONT,
  FRAME_W,
  LINE,
  MAX_OUT,
  MAX_SIDE,
  MIN_SOURCE,
  NO_OUTER,
  bubbleBox,
  calloutLines,
  calloutPadding,
  calloutStyle,
  canvasMeasure,
  clampBox,
  fitBox,
  frameHeight,
  frameScale,
  isOverMark,
  legacyCallout,
  magnifyStyle,
  newCallout,
  newMagnify,
  outerPadding,
  rectOf,
  restyleCallout,
  sourcePicture,
  sourceSquare,
  spotStyle,
  upgradeCallout,
  withBox,
  type Box,
  type Measure,
} from "./marks";
import { CalloutArt, MagnifyArt, SpotlightArt, type MarkHandlers } from "./marksArt";
import { cropRect, markerColor, newId, type Annotation, type AnnotationKind, type GuideDoc, type MarkerShape, type MarkerSize, type Rect, type Redaction, type StepBlock } from "./model";
import type { Choices } from "./panel/choices";
import { guideImageUrl } from "./urls";
import { framing } from "./template/apply";
import { clipToPicture, zoomFrame, type StepFrame } from "./template/frame";

export type Tool = "none" | AnnotationKind | "blur" | "pixelate" | "black" | "crop" | "zoom" | "expand" | "marker";

const SIZES: Record<MarkerSize, number> = { small: 22, medium: 34, large: 52 };

/** The click marker, drawn at view time (never burned into the picture). */
export function Marker(props: { shape: MarkerShape; size: MarkerSize; color: string; left: string; top: string }) {
  const px = SIZES[props.size];
  const common = { left: props.left, top: props.top, width: px, height: px, marginLeft: -px / 2, marginTop: -px / 2 };
  const stroke = Math.max(3, Math.round(px / 8));
  if (props.shape === "box") {
    return <span className="gmarker gmarker--box" style={{ ...common, width: px * 1.8, marginLeft: -px * 0.9, borderColor: props.color, background: `${props.color}33` }} />;
  }
  if (props.shape === "arrow" || props.shape === "hand") {
    // A pointer whose tip is at the click point.
    const hand = props.shape === "hand";
    return (
      <svg className="gmarker" style={{ left: props.left, top: props.top, width: px, height: px, marginLeft: -px * (hand ? 0.38 : 0.08), marginTop: -px * 0.06 }} viewBox="0 0 24 24" aria-hidden="true">
        {hand ? (
          <path d="M9 3a1.5 1.5 0 0 1 3 0v6l.3.1 4.2 1.5A2 2 0 0 1 18 12.5V17c0 2.8-2.2 5-5 5h-1.6a5 5 0 0 1-3.9-1.9L4.6 15a1.5 1.5 0 0 1 2.3-1.9L9 15z" fill="#fff" stroke={props.color} strokeWidth="1.8" strokeLinejoin="round" />
        ) : (
          <path d="M3 2l15 9-6.5 1.6 3.7 7.2-2.8 1.4-3.7-7.2L4.5 18z" fill={props.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        )}
      </svg>
    );
  }
  return (
    <span className="gmarker gmarker--ring" style={{ ...common, borderWidth: stroke, borderColor: props.color }}>
      {props.shape === "ring" && <i style={{ background: props.color, width: px / 4, height: px / 4 }} />}
    </span>
  );
}

export function AnnotationShape({ a, sel, onSelect, onEdit, unit }: { a: Annotation; sel: boolean; onSelect: (id: string) => void; onEdit?: (id: string) => void; unit: number }) {
  const w = a.width * unit;
  const common = { stroke: a.color, strokeWidth: w, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, onPointerDown: (e: RPointerEvent) => (e.stopPropagation(), onSelect(a.id)), className: sel ? "gann gann--sel" : "gann" };
  const x2 = a.x2 ?? a.x;
  const y2 = a.y2 ?? a.y;
  switch (a.kind) {
    case "line":
      return <line {...common} x1={a.x} y1={a.y} x2={x2} y2={y2} />;
    case "arrow": {
      const ang = Math.atan2(y2 - a.y, x2 - a.x);
      const h = w * 4.5;
      const p1 = [x2 - h * Math.cos(ang - 0.45), y2 - h * Math.sin(ang - 0.45)];
      const p2 = [x2 - h * Math.cos(ang + 0.45), y2 - h * Math.sin(ang + 0.45)];
      return (
        <g {...common}>
          <line x1={a.x} y1={a.y} x2={x2} y2={y2} />
          <polygon points={`${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill={a.color} />
        </g>
      );
    }
    case "rect":
      return <rect {...common} x={Math.min(a.x, x2)} y={Math.min(a.y, y2)} width={Math.abs(x2 - a.x)} height={Math.abs(y2 - a.y)} rx={w} />;
    case "highlight":
      return <rect {...common} fill={`${a.color}55`} stroke="none" x={Math.min(a.x, x2)} y={Math.min(a.y, y2)} width={Math.abs(x2 - a.x)} height={Math.abs(y2 - a.y)} />;
    case "ellipse":
      return <ellipse {...common} cx={(a.x + x2) / 2} cy={(a.y + y2) / 2} rx={Math.abs(x2 - a.x) / 2} ry={Math.abs(y2 - a.y) / 2} />;
    case "pen":
      return <polyline {...common} points={(a.points ?? []).map((p) => p.join(",")).join(" ")} />;
    case "text": {
      const size = textSize(a, unit);
      const lines = (a.text ?? "").split("\n");
      return (
        <text x={a.x} y={a.y} fill={a.color} fontSize={size} fontFamily="Segoe UI, sans-serif" fontWeight="600" data-mark={a.id} onPointerDown={(e) => (e.stopPropagation(), onSelect(a.id))} onDoubleClick={() => onEdit?.(a.id)} className={sel ? "gann gann--sel" : "gann"} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: unit * 3, whiteSpace: "pre" }}>
          {lines.length === 1
            ? a.text
            : lines.map((line, i) => (
                <tspan key={i} x={a.x} dy={i === 0 ? 0 : size * 1.25}>
                  {line}
                </tspan>
              ))}
        </text>
      );
    }
    case "callout": {
      // (callouts with a box are drawn above the picture, by CalloutArt)
      if (a.box) return null;
      const old = legacyCallout(a, [0, 0, unit * FRAME_W, 1]);
      const [, , tw, th] = old.box;
      const fs = unit * 15;
      return (
        <g data-mark={a.id} onPointerDown={(e) => (e.stopPropagation(), onSelect(a.id))} onDoubleClick={() => onEdit?.(a.id)} className={sel ? "gann gann--sel" : "gann"}>
          <line x1={a.x + tw / 2} y1={a.y + th} x2={x2} y2={y2} stroke={a.color} strokeWidth={w} />
          <rect x={a.x} y={a.y} width={tw} height={th} rx={8 * unit} fill="#fff" stroke={a.color} strokeWidth={w} />
          <text x={a.x + 8 * unit} y={a.y + th / 2 + fs * 0.35} fontSize={fs} fill="#111" fontFamily="Segoe UI, sans-serif">
            {a.text}
          </text>
        </g>
      );
    }
    case "badge": {
      const r = 13 * unit;
      return (
        <g onPointerDown={(e) => (e.stopPropagation(), onSelect(a.id))} className={sel ? "gann gann--sel" : "gann"}>
          <circle cx={a.x} cy={a.y} r={r} fill={a.color} stroke="#fff" strokeWidth={2 * unit} />
          <text x={a.x} y={a.y + r * 0.38} textAnchor="middle" fontSize={r * 1.15} fill="#fff" fontWeight="700" fontFamily="Segoe UI, sans-serif">
            {a.n}
          </text>
        </g>
      );
    }
  }
}

/**
 * True once the element is (nearly) on screen; stays true. The pictures of a long guide load when a step comes near, with our own
 * observer: the browser's `loading="lazy"` never loaded an image that has no size yet (our images are laid out by percentages),
 * which left every step with an empty grey box.
 */
export function useNear(ref: React.RefObject<Element | null>, margin = 900): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: `${margin}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near, margin]);
  return near;
}

function fail(set: (reason: string) => void, file: string, why: string) {
  const reason = `${file}: ${why}`;
  if (import.meta.env.DEV) console.warn("[guide] picture missing:", reason, guideImageUrl(file, true));
  set(reason);
}

export interface PictureProps {
  step: GuideStep;
  block: StepBlock;
  doc: Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault" | "marker" | "template" | "spotlight">;
  /** The step is selected: its picture can be zoomed (Alt + wheel) and, where it shows a part only, dragged. */
  movable: boolean;
  /** Edit mode: the tool and its colour; the change is reported as a partial block. */
  tool: Tool;
  color: string;
  /** The stroke width of new marks. */
  width: number;
  /** The options of the next callout, magnifier and spotlight. */
  choices: Choices;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** `key`: changes with the same key that follow each other (typing) are undone as one. */
  onChange: (change: Partial<StepBlock>, key?: string) => void;
}

type Handle = "move" | "tip" | "bubble" | "bubbleSize" | "source" | "sourceSize" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: Handle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** A mark after one of its handles was dragged by (dx, dy) picture pixels. */
export function draggedMark(a: Annotation, handle: Handle, dx: number, dy: number, view: Rect, size: [number, number], measure: Measure): Annotation {
  const k = frameScale(view);
  const limit = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  if (a.kind === "callout") {
    const c = upgradeCallout(a, view);
    const box = c.box!;
    if (handle === "tip") return { ...c, x2: Math.round(limit((c.x2 ?? c.x) + dx, view[0], view[0] + view[2])), y2: Math.round(limit((c.y2 ?? c.y) + dy, view[1], view[1] + view[3])) };
    if (handle === "move") return withBox(c, clampBox({ ...box, x: box.x + dx / k, y: box.y + dy / k }, view), view);
    let { x, y, w, h } = box;
    if (handle.includes("w")) {
      const by = Math.min(dx / k, w - 40);
      x += by;
      w -= by;
    }
    if (handle.includes("e")) w = Math.max(40, w + dx / k);
    if (handle.includes("n")) {
      y += dy / k;
      h -= dy / k;
    }
    if (handle.includes("s")) h += dy / k;
    const fitted = fitBox({ x, y, w, h }, c.text ?? "", calloutStyle(c), measure, h);
    // (a box that cannot become lower keeps its other edge where it was)
    if (handle.includes("n")) fitted.y = box.y + box.h - fitted.h;
    return withBox(c, clampBox(fitted, view), view);
  }
  if (a.kind === "spot") {
    let [x, y, w, h] = rectOf(a);
    if (handle === "move") {
      x = limit(x + dx, 0, size[0] - w);
      y = limit(y + dy, 0, size[1] - h);
    } else {
      let right = x + w;
      let bottom = y + h;
      if (handle.includes("w")) x = limit(x + dx, 0, right - 8);
      if (handle.includes("e")) right = limit(right + dx, x + 8, size[0]);
      if (handle.includes("n")) y = limit(y + dy, 0, bottom - 8);
      if (handle.includes("s")) bottom = limit(bottom + dy, y + 8, size[1]);
      [w, h] = [right - x, bottom - y];
    }
    return { ...a, x: Math.round(x), y: Math.round(y), x2: Math.round(x + w), y2: Math.round(y + h) };
  }
  if (a.kind !== "magnify") return a;
  const [sx, sy, side] = rectOf(a);
  const place = ([x, y, s]: Rect): Annotation => ({ ...a, x, y, x2: x + s, y2: y + s });
  if (handle === "source") return place(sourceSquare(sx + side / 2 + dx, sy + side / 2 + dy, side, size));
  if (handle === "sourceSize") {
    const grown = Math.max(MIN_SOURCE, side + Math.max(dx, dy));
    return place(sourceSquare(sx + grown / 2, sy + grown / 2, grown, size));
  }
  const at = a.at ?? { x: FRAME_W / 2, y: frameHeight(view) / 2 };
  if (handle === "bubbleSize") {
    // The bubble keeps its place and its magnification: a larger bubble shows a larger area.
    const wanted = bubbleBox(a, view).w + (2 * Math.max(dx, dy)) / k;
    return place(sourceSquare(sx + side / 2, sy + side / 2, (wanted / magnifyStyle(a).zoom) * k, size));
  }
  const half = bubbleBox(a, view).w / 2;
  return {
    ...a,
    at: {
      x: Math.round(limit(at.x + dx / k, half - MAX_SIDE, FRAME_W + MAX_SIDE - half)),
      y: Math.round(limit(at.y + dy / k, half - MAX_OUT, frameHeight(view) + MAX_OUT - half)),
    },
  };
}

/** A drag that ends is no click: the click the browser makes of it (wherever the pointer was let go, which may be beside the
 * page) neither selects nor unselects anything. */
function swallowClick() {
  const stop = (e: Event) => e.stopPropagation();
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
}

/** The size of the letters of a text mark (picture pixels). */
export const textSize = (a: Pick<Annotation, "width">, unit: number): number => unit * 16 * (a.width / 3);

/** The picture of a step: cropped (or zoomed), the click marker, the annotations and the redactions; the tools draw on it.
 * Callouts and magnifiers may stand around it: the room they need is kept free. */
export const StepPicture = memo(function StepPicture(props: PictureProps) {
  const { t } = useT();
  const { step, block, doc } = props;
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number; pts: [number, number][] } | null>(null);
  const near = useNear(box);
  // A picture that cannot be loaded: a "Picture missing" note instead of an empty box (the reason is logged in development builds).
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setProblem(null), [step.image]);
  // A drag of the picture inside its frame (or inside itself, zoomed): the new place until the pointer is released.
  const [moving, setMoving] = useState<StepFrame | null>(null);
  const dragged = useRef(false);
  // A mark that is being dragged, as it will be; and the mark whose text is being typed.
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [exp, setExp] = useState<Rect | null>(null);
  const shown = framing(step, moving ? { ...block, frame: moving } : block, doc);
  // While the area is being expanded the whole picture is shown, with the shown area on it.
  const view: Rect = props.tool === "expand" ? [0, 0, step.imageSize[0], step.imageSize[1]] : shown.view;
  const zoomable = props.tool === "none" && props.movable ? shown : null;
  // A picture without a frame can be dragged once it shows a part only.
  const pannable = !!zoomable && (zoomable.ratio !== null || zoomable.frame !== null);
  const zoomRef = useRef(zoomable);
  zoomRef.current = zoomable;
  const change = useRef(props.onChange);
  change.current = props.onChange;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const f = zoomRef.current;
      if (!e.altKey || !f) return;
      e.preventDefault();
      const next = zoomFrame(f.now, e.deltaY < 0 ? 1.1 : 1 / 1.1, f.range);
      // Without a frame, zooming all the way out is no zoom at all.
      change.current({ frame: f.ratio === null && next.w >= f.range.widest ? null : next });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [near]);
  const startMove = (e: RPointerEvent) => {
    const f = zoomRef.current;
    if (!f || !pannable || e.button !== 0) return;
    e.preventDefault();
    const el = box.current!;
    const r = el.getBoundingClientRect();
    const [x0, y0] = [e.clientX, e.clientY];
    // The centre that is really shown (a place past the edge of the screen is moved inside first).
    const base = f.now;
    const scale = f.view[2] / r.width;
    let last: StepFrame | null = null;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!last && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      last = { ...base, cx: Math.round(base.cx - (ev.clientX - x0) * scale), cy: Math.round(base.cy - (ev.clientY - y0) * scale) };
      setMoving(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setMoving(null);
      if (last) {
        dragged.current = true;
        change.current({ frame: last });
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  // Leaving the step ends the typing.
  useEffect(() => {
    if (!props.movable) setEditing(null);
  }, [props.movable]);
  if (!step.image) return <div className="gstep__blank">{t("guide.blankStep")}</div>;
  const [vx, vy, vw, vh] = view;
  const [iw] = step.imageSize;
  const unit = Math.max(1, vw / 700);
  const marks = block.annotations ?? [];
  const shownMarks = draft ? marks.map((a) => (a.id === draft.id ? draft : a)) : marks;
  // (the room around the picture is that of the stored marks: it does not change under the pointer while one is dragged)
  const outer = props.tool === "expand" ? NO_OUTER : outerPadding(marks, view);
  const frameH = frameHeight(view);
  const put = (a: Annotation, key?: string) => props.onChange({ annotations: marks.map((x) => (x.id === a.id ? a : x)) }, key);
  const add = (a: Annotation, key?: string) => {
    props.onChange({ annotations: [...marks, a] }, key);
    props.onSelect(a.id);
  };
  /** Type the text of a callout or a text mark, in place. */
  const edit = (id: string) => {
    const a = marks.find((x) => x.id === id);
    if (!a) return;
    if (a.kind === "callout" && !a.box) put(restyleCallout(a, {}, view, canvasMeasure));
    props.onSelect(id);
    setEditing(id);
  };
  /** Drag a handle of a mark; the change is stored when the pointer is released. */
  const startDrag = (e: RPointerEvent, a: Annotation, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onSelect(a.id);
    // (a step that was not selected yet is only selected by this press)
    if (!props.movable) return;
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const r = box.current!.getBoundingClientRect();
    const [x0, y0] = [e.clientX, e.clientY];
    let last: Annotation | null = null;
    const move = (ev: PointerEvent) => {
      if (!last && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      last = draggedMark(a, handle, ((ev.clientX - x0) / r.width) * vw, ((ev.clientY - y0) / r.height) * vh, view, step.imageSize, canvasMeasure);
      setDraft(last);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDraft(null);
      if (last) {
        swallowClick();
        put(last);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  /** A mark can be picked up while no tool is chosen, or its own. */
  const pick = (a: Annotation, handle: Handle): MarkHandlers | undefined =>
    props.tool === "none" || props.tool === a.kind ? { onPointerDown: (e) => startDrag(e, a, handle), onDoubleClick: () => edit(a.id) } : undefined;
  const marker = step.click && step.kind !== "type" && step.kind !== "key" && !block.markerHidden ? (block.markerPos ?? step.click) : null;
  const style = { ...doc.marker, ...block.marker };
  const point = (e: RPointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [vx + ((e.clientX - r.left) / r.width) * vw, vy + ((e.clientY - r.top) / r.height) * vh];
  };
  const tool = props.tool;
  const down = (e: RPointerEvent) => {
    if (tool === "none") return startMove(e);
    // (a click beside a text that is being typed only ends the typing)
    if (tool === "expand" || e.button !== 0 || editing) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    if (tool === "badge") {
      const n = marks.filter((a) => a.kind === "badge").length + 1;
      props.onChange({ annotations: [...marks, { id: newId(), kind: "badge", x, y, color: props.color, width: props.width, n }] });
      return;
    }
    if (tool === "text") {
      // (typed in place; without a word it is taken away again)
      const id = newId();
      add({ id, kind: "text", x, y, color: props.color, width: props.width, text: "" }, `text:${id}`);
      setEditing(id);
      return;
    }
    if (tool === "marker") {
      props.onChange({ markerPos: [Math.round(x), Math.round(y)] });
      return;
    }
    setDrag({ x, y, x2: x, y2: y, pts: [[x, y]] });
  };
  const move = (e: RPointerEvent) => {
    if (!drag) return;
    const [x, y] = point(e);
    setDrag({ ...drag, x2: x, y2: y, pts: tool === "pen" ? [...drag.pts, [x, y]] : drag.pts });
  };
  const up = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const rect: Rect = [Math.round(Math.min(d.x, d.x2)), Math.round(Math.min(d.y, d.y2)), Math.round(Math.abs(d.x2 - d.x)), Math.round(Math.abs(d.y2 - d.y))];
    const big = rect[2] > 6 && rect[3] > 6;
    if (tool === "blur" || tool === "pixelate" || tool === "black") {
      if (big) props.onChange({ redact: [...(block.redact ?? []), { rect, kind: tool } as Redaction] });
    } else if (tool === "crop") {
      if (big) props.onChange({ crop: rect, frame: undefined });
    } else if (tool === "zoom") {
      if (big) props.onChange({ zoom: true, zoomRect: rect, frame: undefined });
    } else if (tool === "callout") {
      // The tip is where the press was; a drag puts the box where it ends.
      const id = newId();
      const away = Math.hypot(d.x2 - d.x, d.y2 - d.y) > 14 * (vw / FRAME_W);
      add(newCallout(id, [d.x, d.y], away ? [d.x2, d.y2] : null, view, props.choices.callout, canvasMeasure), `text:${id}`);
      setEditing(id);
    } else if (tool === "spot") {
      if (big) {
        const [x, y, w, h] = clipToPicture(rect, step.imageSize);
        add({ id: newId(), kind: "spot", x, y, x2: x + w, y2: y + h, shape: props.choices.spotShape, color: props.color, width: 0 });
      }
    } else if (tool === "magnify") {
      // A drag marks a square from where it began; a click takes a small one around the click.
      const long = Math.max(Math.abs(d.x2 - d.x), Math.abs(d.y2 - d.y));
      const side = long > 8 ? long : 80 * (vw / FRAME_W);
      const [cx, cy] = long > 8 ? [d.x + (Math.sign(d.x2 - d.x) * long) / 2, d.y + (Math.sign(d.y2 - d.y) * long) / 2] : [d.x, d.y];
      add(newMagnify(newId(), sourceSquare(cx, cy, side, step.imageSize), view, props.choices.magnify));
    } else if (tool === "pen") {
      if (d.pts.length > 2) props.onChange({ annotations: [...(block.annotations ?? []), { id: newId(), kind: "pen", x: d.x, y: d.y, points: d.pts, color: props.color, width: props.width }] });
    } else if (big || Math.hypot(d.x2 - d.x, d.y2 - d.y) > 8) {
      props.onChange({ annotations: [...(block.annotations ?? []), { id: newId(), kind: tool as AnnotationKind, x: d.x, y: d.y, x2: d.x2, y2: d.y2, color: props.color, width: props.width }] });
    }
  };
  // Expand area: drag the edges or corners of the shown area on the whole frame (outwards or inwards).
  const startExpand = (e: RPointerEvent, mode: string) => {
    e.preventDefault();
    e.stopPropagation();
    const [iw2, ih2] = step.imageSize;
    const r0: Rect = cropRect(step, block, doc);
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    const [px, py] = point(e);
    let last: Rect = r0;
    const move = (ev: PointerEvent) => {
      const b = box.current!.getBoundingClientRect();
      const x = ((ev.clientX - b.left) / b.width) * iw2;
      const y = ((ev.clientY - b.top) / b.height) * ih2;
      let [rx, ry, rw, rh] = r0;
      const right = rx + rw;
      const bottom = ry + rh;
      if (mode.includes("w")) {
        rx = Math.max(0, Math.min(right - 40, rx + (x - px)));
        rw = right - rx;
      }
      if (mode.includes("e")) rw = Math.max(40, Math.min(iw2 - rx, rw + (x - px)));
      if (mode.includes("n")) {
        ry = Math.max(0, Math.min(bottom - 40, ry + (y - py)));
        rh = bottom - ry;
      }
      if (mode.includes("s")) rh = Math.max(40, Math.min(ih2 - ry, rh + (y - py)));
      last = [Math.round(rx), Math.round(ry), Math.round(rw), Math.round(rh)];
      setExp(last);
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
      setExp(null);
      props.onChange({ crop: last, frame: undefined });
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
  };
  const expandRect: Rect | null = tool === "expand" ? (exp ?? cropRect(step, block, doc)) : null;
  const live: Annotation | null =
    drag && !["blur", "pixelate", "black", "crop", "zoom", "marker", "text", "callout", "badge", "spot", "magnify", "none"].includes(tool)
      ? { id: "live", kind: tool as AnnotationKind, x: drag.x, y: drag.y, x2: drag.x2, y2: drag.y2, points: drag.pts, color: props.color, width: props.width }
      : null;
  const liveBox = drag && ["blur", "pixelate", "black", "crop", "zoom", "magnify"].includes(tool) ? drag : null;
  const spots = shownMarks.filter((a) => a.kind === "spot");
  if (drag && tool === "spot") spots.push({ id: "live", kind: "spot", x: drag.x, y: drag.y, x2: drag.x2, y2: drag.y2, shape: props.choices.spotShape, color: props.color, width: 0 });
  // The mark whose handles are shown: the selected one of the selected step.
  const held = props.movable && !editing && tool !== "expand" ? shownMarks.find((a) => a.id === props.selected && (tool === "none" || tool === a.kind) && (a.kind === "callout" || a.kind === "spot" || a.kind === "magnify")) : undefined;
  const typed = editing ? shownMarks.find((a) => a.id === editing) : undefined;
  const at = (x: number, y: number, w: number, h: number): CSSProperties => ({ left: `${((x - vx) / vw) * 100}%`, top: `${((y - vy) / vh) * 100}%`, width: `${(w / vw) * 100}%`, height: `${(h / vh) * 100}%` });
  const inFrame = (b: Box): CSSProperties => ({ left: `${(b.x / FRAME_W) * 100}%`, top: `${(b.y / frameH) * 100}%`, width: `${(b.w / FRAME_W) * 100}%`, height: `${(b.h / frameH) * 100}%` });
  const grip = (a: Annotation, handle: Handle, style?: CSSProperties) => <span key={handle} className={`ghandle ghandle--${handle}`} style={style} data-handle={handle} onPointerDown={(e) => startDrag(e, a, handle)} />;
  const handles = () => {
    if (!held) return null;
    if (held.kind === "callout") {
      const c = upgradeCallout(held, view);
      return (
        <>
          <div className="ghandles" style={inFrame(c.box!)}>{EDGES.map((m) => grip(c, m))}</div>
          {grip(c, "tip", { left: `${(((c.x2 ?? c.x) - vx) / vw) * 100}%`, top: `${(((c.y2 ?? c.y) - vy) / vh) * 100}%` })}
        </>
      );
    }
    const [x, y, w, h] = rectOf(held);
    if (held.kind === "spot") {
      return (
        <div className={`ghandles${tool === "none" ? " ghandles--move" : ""}`} style={at(x, y, w, h)} onPointerDown={(e) => startDrag(e, held, "move")}>
          {EDGES.map((m) => grip(held, m))}
        </div>
      );
    }
    return (
      <>
        <div className="ghandles ghandles--source" style={at(x, y, w, h)}>
          {grip(held, "source")}
          {grip(held, "sourceSize")}
        </div>
        <div className="ghandles" style={inFrame(bubbleBox(held, view))}>{grip(held, "bubbleSize")}</div>
      </>
    );
  };
  const typing = () => {
    if (!typed) return null;
    // (sizes are given in the page's own pixels, before any zoom of the page)
    const wide = box.current?.clientWidth ?? FRAME_W;
    const finish = () => {
      setEditing(null);
      if (!(typed.text ?? "").trim()) props.onChange({ annotations: marks.filter((a) => a.id !== typed.id) }, `text:${typed.id}`);
    };
    const common = {
      className: "gtype",
      dir: "auto" as const,
      autoFocus: true,
      value: typed.text ?? "",
      "aria-label": t("guide.annotationText"),
      onBlur: finish,
      onPointerDown: (e: RPointerEvent) => e.stopPropagation(),
      onFocus: (e: { currentTarget: HTMLTextAreaElement }) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length),
      onKeyDown: (e: RKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.blur();
      },
    };
    if (typed.kind === "callout" && typed.box) {
      const s = calloutStyle(typed);
      const pad = calloutPadding(s.shape, typed.box, s.size);
      const lines = Math.max(1, calloutLines(typed.text ?? "", typed.box, s, canvasMeasure).length);
      const k = wide / FRAME_W;
      return (
        <textarea
          {...common}
          style={{ ...inFrame(typed.box), fontFamily: FONT, fontSize: s.size * k, lineHeight: LINE, fontWeight: s.bold ? 700 : 400, color: s.textColor, textAlign: "center", paddingInline: pad.x * k, paddingBlock: `${Math.max(0, (typed.box.h - lines * s.size * LINE) / 2) * k}px 0` }}
          onChange={(e) => put(restyleCallout(typed, { text: e.target.value }, view, canvasMeasure), `text:${typed.id}`)}
        />
      );
    }
    const size = textSize(typed, unit);
    const px = (size / vw) * wide;
    const lines = (typed.text ?? "").split("\n");
    const longest = Math.max(...lines.map((l) => canvasMeasure(l, px, true)));
    return (
      <textarea
        {...common}
        wrap="off"
        className="gtype gtype--text"
        style={{ left: `${((typed.x - vx) / vw) * 100}%`, top: `${((typed.y - size * 0.98 - vy) / vh) * 100}%`, width: longest + px * 2, height: lines.length * px * 1.25 + 4, fontFamily: FONT, fontSize: px, lineHeight: 1.25, fontWeight: 600, color: typed.color }}
        onChange={(e) => put({ ...typed, text: e.target.value }, `text:${typed.id}`)}
      />
    );
  };
  const over = tool === "expand" ? [] : shownMarks.filter(isOverMark);
  return (
    <div className="gshot" style={{ "--out-side": outer.side / FRAME_W, "--out-top": outer.top / FRAME_W, "--out-bottom": outer.bottom / FRAME_W } as CSSProperties}>
    <div
      ref={box}
      className={`gpic${tool !== "none" ? " gpic--tool" : ""}${pannable ? " gpic--move" : ""}`}
      style={{ aspectRatio: `${vw} / ${vh}` }}
      onClickCapture={(e) => {
        // (the click that ends a drag does not select or unselect the step)
        if (dragged.current) e.stopPropagation();
        dragged.current = false;
      }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="gpic__clip">
      {near && !problem && (
        <img
          src={guideImageUrl(step.image, true)}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth === 0) fail(setProblem, step.image, "the picture is empty");
          }}
          onError={() => fail(setProblem, step.image, "the picture could not be loaded")}
          style={{ width: `${(iw / vw) * 100}%`, left: `${-((vx) / vw) * 100}%`, top: `${-((vy) / vh) * 100}%` }}
        />
      )}
      {expandRect && (
        <div
          className="gpic__expand"
          style={{ left: `${(expandRect[0] / iw) * 100}%`, top: `${(expandRect[1] / step.imageSize[1]) * 100}%`, width: `${(expandRect[2] / iw) * 100}%`, height: `${(expandRect[3] / step.imageSize[1]) * 100}%` }}
        >
          {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((m) => (
            <span key={m} className={`gpic__eh gpic__eh--${m}`} onPointerDown={(e) => startExpand(e, m)} />
          ))}
        </div>
      )}
      {problem && (
        <div className="gpic__missing" role="img" aria-label={t("guide.pictureMissing")} title={import.meta.env.DEV ? problem : undefined}>
          {t("guide.pictureMissing")}
        </div>
      )}
      {(block.redact ?? []).map((r, i) => (
        <span
          key={i}
          onPointerDown={(e) => {
            if (tool !== "none" || !props.movable) return;
            e.stopPropagation();
            props.onSelect(`redact:${i}`);
          }}
          className={`gredact gredact--${r.kind}${tool === "none" && props.movable ? " gredact--pick" : ""}${props.selected === `redact:${i}` ? " gredact--sel" : ""}`} style={{ left: `${((r.rect[0] - vx) / vw) * 100}%`, top: `${((r.rect[1] - vy) / vh) * 100}%`, width: `${(r.rect[2] / vw) * 100}%`, height: `${(r.rect[3] / vh) * 100}%` }} />
      ))}
      <svg className="gann-layer" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="none" aria-hidden="true">
        <SpotlightArt spots={spots} style={spotStyle(doc, block)} view={view} id={`spot-${block.id}`} pick={tool === "none" || tool === "spot" ? (a) => pick(a, "move")! : undefined} />
        {shownMarks.map((a) =>
          a.kind === "spot" || a.id === editing && a.kind === "text" ? null : <AnnotationShape key={a.id} a={a} sel={props.selected === a.id} onSelect={props.onSelect} onEdit={edit} unit={unit} />,
        )}
        {live && <AnnotationShape a={live} sel={false} onSelect={() => undefined} unit={unit} />}
        {liveBox && <rect x={Math.min(liveBox.x, liveBox.x2)} y={Math.min(liveBox.y, liveBox.y2)} width={Math.abs(liveBox.x2 - liveBox.x)} height={Math.abs(liveBox.y2 - liveBox.y)} fill="rgba(37,99,235,.2)" stroke="#2563eb" strokeWidth={unit * 2} strokeDasharray={`${unit * 6} ${unit * 4}`} />}
        {drag && tool === "callout" && <line x1={drag.x} y1={drag.y} x2={drag.x2} y2={drag.y2} stroke={props.choices.callout.color} strokeWidth={unit * 3} />}
      </svg>
      {marker && (
        <Marker shape={style.shape} size={style.size} color={markerColor(step, block, doc)} left={`${((marker[0] - vx) / vw) * 100}%`} top={`${((marker[1] - vy) / vh) * 100}%`} />
      )}
      </div>
      {/* Callouts and magnifiers lie over the picture and may reach beyond it. */}
      {over.length > 0 && (
        <svg className="gover" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="none" aria-hidden="true">
          {over.map((a) => {
            if (a.kind === "callout") return <CalloutArt key={a.id} a={a} view={view} measure={canvasMeasure} hideText={a.id === editing} pick={pick(a, "move")} />;
            const from = sourcePicture(a, step.image, step.imageSize);
            return <MagnifyArt key={a.id} a={a} view={view} id={`mag-${block.id}-${a.id}`} image={near ? { ...from, href: guideImageUrl(from.file, true) } : null} covers={block.redact} pickSource={pick(a, "source")} pickBubble={pick(a, "bubble")} />;
          })}
        </svg>
      )}
      {handles()}
      {typing()}
    </div>
    </div>
  );
});
