// The cursor halo and the click effects as the player draws them. The export draws the same shapes from the same numbers
// (src-tauri/src/compose.rs: draw_halo, draw_ripple, draw_burst), so the preview shows what the file will have.

import type { ClickEvent } from "./cursorTrack";
import { CLICK_RADIUS, CURSOR_SCALE, type Effects } from "./effects";

/** How long a click effect lasts (seconds). */
export const CLICK_SECONDS = 0.6;

/** The click effects that are showing at time `t` (seconds): the click and how old it is (0 = now, 1 = gone). */
export function activeClicks(clicks: readonly ClickEvent[], t: number): { click: ClickEvent; age: number }[] {
  const out: { click: ClickEvent; age: number }[] = [];
  for (const click of clicks) {
    const age = (t - click.t) / CLICK_SECONDS;
    if (age >= 0 && age <= 1) out.push({ click, age });
  }
  return out;
}

/** The ring of a ripple at age `t`: radius and opacity of the ring (`max` is the size of the effect in pixels). */
export function rippleShape(max: number, t: number): { radius: number; thick: number; fade: number } {
  const ease = 1 - (1 - t) ** 3;
  return { radius: max * (0.25 + 0.75 * ease), thick: Math.max(max * 0.14, 2), fade: Math.min(1, Math.max(0, 1 - t)) };
}

/** The eight lines of a burst at age `t`: where each starts and ends, as angles and distances from the click. */
export function burstShape(max: number, t: number): { from: number; to: number; thick: number; fade: number; angles: number[] } {
  const ease = 1 - (1 - t) ** 2;
  const from = max * (0.35 + 0.65 * ease);
  const len = max * 0.38 * (1 - 0.5 * t);
  return {
    from,
    to: from + len,
    thick: Math.max(max * 0.08, 2),
    fade: Math.min(1, Math.max(0, 1 - t)),
    angles: Array.from({ length: 8 }, (_, k) => (k * Math.PI * 2) / 8),
  };
}

/** The radius of the halo around the cursor, in video pixels. */
export const haloRadius = (videoHeight: number, cursorSize: Effects["cursor"]["size"]) => videoHeight * 0.05 * CURSOR_SCALE[cursorSize];

/** The size of a click effect, in video pixels. */
export const clickMax = (videoHeight: number, size: Effects["click"]["size"]) => videoHeight * CLICK_RADIUS[size];

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Draw a soft disc: strongest in the middle, gone at the edge. Coordinates are canvas pixels. */
export function drawHalo(g: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, rgba(color, 0.42));
  grad.addColorStop(0.5, rgba(color, 0.42));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
}

export function drawRipple(g: CanvasRenderingContext2D, x: number, y: number, max: number, t: number, color: string): void {
  const { radius, thick, fade } = rippleShape(max, t);
  g.fillStyle = rgba(color, 0.22 * fade);
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = rgba(color, 0.9 * fade);
  g.lineWidth = thick;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.stroke();
}

export function drawBurst(g: CanvasRenderingContext2D, x: number, y: number, max: number, t: number, color: string): void {
  const { from, to, thick, fade, angles } = burstShape(max, t);
  g.strokeStyle = rgba(color, 0.95 * fade);
  g.lineWidth = thick;
  g.lineCap = "round";
  for (const a of angles) {
    g.beginPath();
    g.moveTo(x + Math.cos(a) * from, y + Math.sin(a) * from);
    g.lineTo(x + Math.cos(a) * to, y + Math.sin(a) * to);
    g.stroke();
  }
}
