import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { ipc, isTauri } from "../ipc";
import { BORDER_WIDTH } from "../recording/effects";
import { defaultSettings, type Settings } from "../settings/defaults";

/** How often a new picture is asked for (milliseconds): about 15 a second. */
const FRAME_MS = 66;

/**
 * The live webcam bubble (its own small window, left out of the recording). The window is dragged by its picture; the corner handle
 * resizes it. The picture is a JPEG that the backend keeps ready at the `snipmunk-cam` address; this page asks for the next one when
 * the last one has been drawn, so a slow machine simply shows fewer pictures and nothing queues up.
 */
export function WebcamBubble() {
  const { t } = useT();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const img = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ipc.getSettings().then(setSettings).catch(() => undefined);
    const p = ipc.onSettingsChanged(setSettings);
    return () => void p.then((fn) => fn());
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    let timer = 0;
    const next = () => {
      if (!alive || !img.current) return;
      img.current.src = `${convertFileSrc("latest", "snipmunk-cam")}?n=${Date.now()}`;
    };
    const el = img.current;
    const again = () => {
      timer = window.setTimeout(next, FRAME_MS);
    };
    el?.addEventListener("load", again);
    el?.addEventListener("error", again);
    next();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      el?.removeEventListener("load", again);
      el?.removeEventListener("error", again);
    };
  }, []);

  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.screenX;
    const start = box.current?.getBoundingClientRect().width ?? 200;
    const move = (ev: PointerEvent) => void ipc.bubbleResize(start + (ev.screenX - startX) * 2).catch(() => undefined);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const radius = settings.webcamShape === "circle" ? "50%" : settings.webcamShape === "rounded" ? "22%" : "0";
  return (
    <div
      ref={box}
      className="bubble"
      data-tauri-drag-region
      title={t("fx.webcamDrag")}
      style={{ borderRadius: radius }}
    >
      <img ref={img} alt="" draggable={false} />
      {/* The border is a ring on top of the picture (an outline would be painted under it). */}
      <span
        className="bubble__ring"
        style={{ borderRadius: radius, boxShadow: settings.webcamBorder === "off" ? "none" : `inset 0 0 0 max(2px, ${BORDER_WIDTH[settings.webcamBorder] * 100}vmin) ${settings.webcamBorderColor}` }}
      />
      <span className="bubble__grip" onPointerDown={resize} aria-hidden="true" />
    </div>
  );
}
