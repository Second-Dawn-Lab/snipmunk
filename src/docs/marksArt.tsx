// The drawing of spotlights, new callouts and magnifiers (SVG in picture pixels): the same for the editor and, rendered to a
// picture, for every export.

import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from "react";
import { FONT, LINE, bubbleBox, calloutLines, calloutPath, calloutStyle, connector, frameScale, magnifyStyle, rectOf, toFrame, type Measure, type SpotStyle } from "./marks";
import type { Annotation, Rect, Redaction } from "./model";

/** What the editor adds to a mark so it can be picked, moved and edited. */
export interface MarkHandlers {
  onPointerDown?: (e: RPointerEvent) => void;
  onDoubleClick?: (e: RMouseEvent) => void;
}

function spotShape(a: Annotation, unit: number, extra: object) {
  const [x, y, w, h] = rectOf(a);
  if (a.shape === "ellipse") return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...extra} />;
  return <rect x={x} y={y} width={w} height={h} rx={a.shape === "round" ? Math.min(14 * unit, w / 2, h / 2) : 0} {...extra} />;
}

/** The dimming of everything outside all spotlights of a picture; `pick` makes the edge of each one clickable. */
export function SpotlightArt(props: { spots: readonly Annotation[]; style: SpotStyle; view: Rect; id: string; pick?: (a: Annotation) => MarkHandlers }) {
  const { spots, style, view, id } = props;
  if (spots.length === 0) return null;
  const [x, y, width, height] = view;
  const unit = frameScale(view);
  return (
    <g>
      <defs>
        {style.soft && (
          <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={9 * unit} />
          </filter>
        )}
        <mask id={id} maskUnits="userSpaceOnUse" x={x} y={y} width={width} height={height}>
          <rect x={x} y={y} width={width} height={height} fill="#fff" />
          <g filter={style.soft ? `url(#${id}-soft)` : undefined}>
            {spots.map((a) => (
              <g key={a.id}>{spotShape(a, unit, { fill: "#000" })}</g>
            ))}
          </g>
        </mask>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={style.tone === "light" ? "#FFFFFF" : "#000000"} fillOpacity={style.dim / 100} mask={`url(#${id})`} pointerEvents="none" />
      {props.pick &&
        spots.map((a) => (
          <g key={a.id} className="gann" data-mark={a.id} {...props.pick!(a)}>
            {spotShape(a, unit, { fill: "none", stroke: "transparent", strokeWidth: 12 * unit, pointerEvents: "stroke" })}
          </g>
        ))}
    </g>
  );
}

/** A callout with a box (new since 7.5-D). */
export function CalloutArt({ a, view, measure, hideText, pick }: { a: Annotation; view: Rect; measure: Measure; hideText?: boolean; pick?: MarkHandlers }) {
  const box = a.box!;
  const s = calloutStyle(a);
  const tip = toFrame(a.x2 ?? a.x, a.y2 ?? a.y, view);
  const p = calloutPath(s.shape, box, [tip.x, tip.y], s.width);
  const lines = calloutLines(a.text ?? "", box, s, measure);
  const first = box.y + (box.h - lines.length * s.size * LINE) / 2 + s.size * 0.97;
  // (a pointer stays visible without a border)
  const thick = Math.max(2, s.width);
  return (
    <g className="gann gcallout" data-mark={a.id} transform={`translate(${view[0]} ${view[1]}) scale(${frameScale(view)})`} {...pick}>
      {p.leader && <line x1={p.leader[0][0]} y1={p.leader[0][1]} x2={p.leader[1][0]} y2={p.leader[1][1]} stroke={s.color} strokeWidth={s.shape === "label" ? thick * 1.6 : thick} strokeLinecap="round" />}
      {p.dots?.map(([x, y, r]) => <circle key={`${x},${y}`} cx={x} cy={y} r={r} fill={s.fill} stroke={s.color} strokeWidth={thick} />)}
      <path d={p.body} fill={s.fill} stroke={s.width > 0 ? s.color : "none"} strokeWidth={s.width} strokeLinejoin="round" />
      {p.head && <path d={p.head} fill={s.color} />}
      {!hideText &&
        lines.map((line, i) => (
          <text key={i} x={box.x + box.w / 2} y={first + i * s.size * LINE} textAnchor="middle" fontSize={s.size} fontFamily={FONT} fontWeight={s.bold ? 700 : 400} fill={s.textColor} style={{ whiteSpace: "pre", unicodeBidi: "plaintext" }}>
            {line}
          </text>
        ))}
    </g>
  );
}

/** The pixels a magnifier shows: a picture and the rectangle of the step picture it covers (picture pixels). */
export interface SourceImage {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A magnifier: its area marked on the picture, the bubble with the area's own pixels (at their full resolution), and the line
 * between them. `covers` are redactions to draw over the pixels, for pixels that do not have them burned in.
 */
export function MagnifyArt({ a, view, image, covers, id, pickSource, pickBubble }: { a: Annotation; view: Rect; image: SourceImage | null; covers?: readonly Redaction[]; id: string; pickSource?: MarkHandlers; pickBubble?: MarkHandlers }) {
  const s = magnifyStyle(a);
  const k = frameScale(view);
  const [sx, sy, sw, sh] = rectOf(a);
  const bubble = bubbleBox(a, view);
  const [bx, by, side] = [view[0] + bubble.x * k, view[1] + bubble.y * k, bubble.w * k];
  const from = toFrame(sx, sy, view);
  const line = s.line ? connector({ x: from.x, y: from.y, w: sw / k, h: sh / k }, bubble, s.shape) : null;
  const shape = (x: number, y: number, w: number, extra: object) => (s.shape === "circle" ? <circle cx={x + w / 2} cy={y + w / 2} r={w / 2} {...extra} /> : <rect x={x} y={y} width={w} height={w} rx={w * 0.12} {...extra} />);
  const border = s.width * k;
  return (
    <g className="gann gmagnify" data-mark={a.id}>
      {line && <line x1={view[0] + line[0][0] * k} y1={view[1] + line[0][1] * k} x2={view[0] + line[1][0] * k} y2={view[1] + line[1][1] * k} stroke={s.color} strokeWidth={Math.max(1.5, s.width) * k} />}
      <g {...pickSource} className="gmagnify__source">{shape(sx, sy, sw, { fill: "none", stroke: s.color, strokeWidth: Math.max(1.5 * k, border), pointerEvents: pickSource ? "stroke" : "none" })}</g>
      <g {...pickBubble} className="gmagnify__bubble">
        <defs>
          <clipPath id={id}>{shape(bx, by, side, {})}</clipPath>
        </defs>
        {/* (the pixels take no pointer: the browser would pick the whole enlarged picture, also where it is cut away) */}
        <g clipPath={`url(#${id})`} pointerEvents="none">
          <rect x={bx} y={by} width={side} height={side} fill="#FFFFFF" />
          {image && (
            <svg x={bx} y={by} width={side} height={side} viewBox={`${sx} ${sy} ${sw} ${sh}`} preserveAspectRatio="none">
              <image href={image.href} x={image.x} y={image.y} width={image.width} height={image.height} preserveAspectRatio="none" />
              {covers?.map((r, i) => <rect key={i} x={r.rect[0]} y={r.rect[1]} width={r.rect[2]} height={r.rect[3]} fill={r.kind === "black" ? "#000000" : "#8A8A8A"} />)}
            </svg>
          )}
        </g>
        {shape(bx, by, side, { fill: "none", stroke: s.width > 0 ? s.color : "none", strokeWidth: border, pointerEvents: pickBubble ? "all" : "none" })}
      </g>
    </g>
  );
}
