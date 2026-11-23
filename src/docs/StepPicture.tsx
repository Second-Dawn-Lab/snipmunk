import { memo, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useT } from "../i18n";
import type { GuideStep } from "../ipc";
import { cropRect, markerColor, newId, viewRect, type Annotation, type AnnotationKind, type GuideDoc, type MarkerShape, type MarkerSize, type Rect, type Redaction, type StepBlock } from "./model";
import { guideImageUrl } from "./urls";

export type Tool = "none" | AnnotationKind | "blur" | "pixelate" | "black" | "crop" | "zoom" | "marker";

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

function AnnotationShape({ a, sel, onSelect, unit }: { a: Annotation; sel: boolean; onSelect: (id: string) => void; unit: number }) {
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
    case "text":
      return (
        <text x={a.x} y={a.y} fill={a.color} fontSize={unit * 16 * (a.width / 3)} fontFamily="Segoe UI, sans-serif" fontWeight="600" onPointerDown={(e) => (e.stopPropagation(), onSelect(a.id))} className={sel ? "gann gann--sel" : "gann"} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: unit * 3 }}>
          {a.text}
        </text>
      );
    case "callout": {
      const fs = unit * 15;
      const tw = Math.max(60 * unit, (a.text?.length ?? 4) * fs * 0.6 + 16 * unit);
      const th = fs + 14 * unit;
      return (
        <g onPointerDown={(e) => (e.stopPropagation(), onSelect(a.id))} className={sel ? "gann gann--sel" : "gann"}>
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
  doc: Pick<GuideDoc, "picture" | "keepFull" | "zoomDefault" | "marker">;
  /** Edit mode: the tool and its colour; the change is reported as a partial block. */
  tool: Tool;
  color: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (change: Partial<StepBlock>) => void;
}

/** The picture of a step: cropped (or zoomed), the click marker, the annotations and the redactions; the tools draw on it. */
export const StepPicture = memo(function StepPicture(props: PictureProps) {
  const { t } = useT();
  const { step, block, doc } = props;
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number; pts: [number, number][] } | null>(null);
  const near = useNear(box);
  // A picture that cannot be loaded: a "Picture missing" note instead of an empty box (the reason is logged in development builds).
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setProblem(null), [step.image]);
  if (!step.image) return <div className="gstep__blank">{t("guide.blankStep")}</div>;
  const view = viewRect(step, block, doc);
  const [vx, vy, vw, vh] = view;
  const [iw] = step.imageSize;
  const unit = Math.max(1, vw / 700);
  const marker = step.click && step.kind !== "type" && step.kind !== "key" && !block.markerHidden ? (block.markerPos ?? step.click) : null;
  const style = { ...doc.marker, ...block.marker };
  const point = (e: RPointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [vx + ((e.clientX - r.left) / r.width) * vw, vy + ((e.clientY - r.top) / r.height) * vh];
  };
  const tool = props.tool;
  const down = (e: RPointerEvent) => {
    if (tool === "none" || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    if (tool === "badge") {
      const n = (block.annotations ?? []).filter((a) => a.kind === "badge").length + 1;
      props.onChange({ annotations: [...(block.annotations ?? []), { id: newId(), kind: "badge", x, y, color: props.color, width: 3, n }] });
      return;
    }
    if (tool === "text" || tool === "callout") {
      const text = window.prompt(t("guide.annotationText"), "");
      if (!text) return;
      props.onChange({ annotations: [...(block.annotations ?? []), { id: newId(), kind: tool, x, y, x2: x + 40 * unit, y2: y + 60 * unit, color: props.color, width: 3, text }] });
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
      if (big) props.onChange({ crop: rect });
    } else if (tool === "zoom") {
      if (big) props.onChange({ zoom: true, zoomRect: rect });
    } else if (tool === "pen") {
      if (d.pts.length > 2) props.onChange({ annotations: [...(block.annotations ?? []), { id: newId(), kind: "pen", x: d.x, y: d.y, points: d.pts, color: props.color, width: 3 }] });
    } else if (big || Math.hypot(d.x2 - d.x, d.y2 - d.y) > 8) {
      props.onChange({ annotations: [...(block.annotations ?? []), { id: newId(), kind: tool as AnnotationKind, x: d.x, y: d.y, x2: d.x2, y2: d.y2, color: props.color, width: 3 }] });
    }
  };
  const live: Annotation | null =
    drag && !["blur", "pixelate", "black", "crop", "zoom", "marker", "text", "callout", "badge", "none"].includes(tool)
      ? { id: "live", kind: tool as AnnotationKind, x: drag.x, y: drag.y, x2: drag.x2, y2: drag.y2, points: drag.pts, color: props.color, width: 3 }
      : null;
  const liveBox = drag && ["blur", "pixelate", "black", "crop", "zoom"].includes(tool) ? drag : null;
  void cropRect;
  return (
    <div ref={box} className={`gpic${tool !== "none" ? " gpic--tool" : ""}`} style={{ aspectRatio: `${vw} / ${vh}` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
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
      {problem && (
        <div className="gpic__missing" role="img" aria-label={t("guide.pictureMissing")} title={import.meta.env.DEV ? problem : undefined}>
          {t("guide.pictureMissing")}
        </div>
      )}
      {(block.redact ?? []).map((r, i) => (
        <span key={i} className={`gredact gredact--${r.kind}`} style={{ left: `${((r.rect[0] - vx) / vw) * 100}%`, top: `${((r.rect[1] - vy) / vh) * 100}%`, width: `${(r.rect[2] / vw) * 100}%`, height: `${(r.rect[3] / vh) * 100}%` }} />
      ))}
      <svg className="gann-layer" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="none" aria-hidden="true">
        {(block.annotations ?? []).map((a) => (
          <AnnotationShape key={a.id} a={a} sel={props.selected === a.id} onSelect={props.onSelect} unit={unit} />
        ))}
        {live && <AnnotationShape a={live} sel={false} onSelect={() => undefined} unit={unit} />}
        {liveBox && <rect x={Math.min(liveBox.x, liveBox.x2)} y={Math.min(liveBox.y, liveBox.y2)} width={Math.abs(liveBox.x2 - liveBox.x)} height={Math.abs(liveBox.y2 - liveBox.y)} fill="rgba(37,99,235,.2)" stroke="#2563eb" strokeWidth={unit * 2} strokeDasharray={`${unit * 6} ${unit * 4}`} />}
      </svg>
      {marker && (
        <Marker shape={style.shape} size={style.size} color={markerColor(step, block, doc)} left={`${((marker[0] - vx) / vw) * 100}%`} top={`${((marker[1] - vy) / vh) * 100}%`} />
      )}
    </div>
  );
});
