import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AppIcon, type AppIconName } from "../components/AppIcons";
import { useT } from "../i18n";
import { ipc, windowLabel, type OverlayInfo } from "../ipc";
import {
  boxToCss,
  clipToMonitor,
  dragBox,
  hitTestWindow,
  loupePlacement,
  loupeSource,
  modeForKey,
  MODE_ORDER,
  pixelRatio,
  readoutPosition,
  sizeLabel,
  thin,
  toDesktop,
  toPhysical,
  windowToLocal,
  type Box,
  type CaptureModeId,
  type Pt,
} from "./geometry";

const DELAYS = [0, 3, 5, 10] as const;
const LOUPE = 120; // CSS pixels
const LOUPE_CELLS = 15; // physical pixels on a side: 8x zoom
const MODE_ICONS: Record<CaptureModeId, AppIconName> = {
  rectangle: "rectangle",
  window: "window",
  fullscreen: "fullscreen",
  freeform: "freeform",
};

/** The frozen screenshot of one monitor, dimmed, with the selection on top. One of these runs on every monitor. */
export function Overlay() {
  const { t } = useT();
  const label = windowLabel();
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const [mode, setMode] = useState<CaptureModeId>("rectangle");
  const [delay, setDelay] = useState<number>(0);
  const [delayOpen, setDelayOpen] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [pointer, setPointer] = useState<Pt | null>(null); // CSS pixels
  const [inside, setInside] = useState(false);
  const [dragFrom, setDragFrom] = useState<Pt | null>(null); // physical pixels
  const [dragTo, setDragTo] = useState<Pt | null>(null);
  const [lasso, setLasso] = useState<Pt[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);

  // --- what to show -----------------------------------------------------------
  const reset = () => {
    setDragFrom(null);
    setDragTo(null);
    setLasso([]);
    setPointer(null);
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await ipc.overlayInfo(label);
      if (!alive) return;
      reset();
      setDrawn(false);
      setInfo(next);
      setDelayOpen(false);
      if (next) {
        setMode(next.mode);
        setDelay(next.delay);
        setInside(next.focus);
      }
    };
    void load();
    const opened = ipc.onCaptureOpen(() => void load());
    const moded = ipc.onCaptureMode((m) => setMode(m));
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      void opened.then((fn) => fn());
      void moded.then((fn) => fn());
    };
  }, [label]);

  // Put the frozen screenshot's raw pixels on the canvas (no decoding), then tell the backend it is on screen.
  useEffect(() => {
    if (!info) return;
    let alive = true;
    void (async () => {
      try {
        const bytes = new Uint8ClampedArray(await (await fetch(info.imageUrl)).arrayBuffer());
        const c = canvas.current;
        if (!alive || !c || bytes.length !== info.width * info.height * 4) return;
        c.width = info.width;
        c.height = info.height;
        c.getContext("2d")?.putImageData(new ImageData(bytes, info.width, info.height), 0, 0);
        setDrawn(true);
        void ipc.overlayReady(label);
        window.focus();
      } catch {
        // The backend's watchdog gives up on an overlay that never shows itself.
      }
    })();
    return () => {
      alive = false;
    };
  }, [info, label]);

  // --- geometry -------------------------------------------------------------------
  const image = { w: info?.width ?? 1, h: info?.height ?? 1 };
  const ratio = useMemo(() => pixelRatio(image, viewport), [image.w, image.h, viewport.w, viewport.h]);
  const monitorOrigin = { x: info?.monitor.x ?? 0, y: info?.monitor.y ?? 0 };
  const physical = pointer ? toPhysical(pointer, ratio) : null;

  const hovered =
    mode === "window" && physical && info
      ? hitTestWindow(info.windows, toDesktop(physical, monitorOrigin))
      : null;
  const hoveredBox: Box | null = hovered ? clipToMonitor(windowToLocal(hovered, monitorOrigin), image) : null;

  const dragged: Box | null =
    dragFrom && dragTo && mode === "rectangle" ? dragBox(dragFrom, dragTo, image) : null;
  const lassoBox: Box | null = useMemo(() => {
    if (lasso.length < 2) return null;
    const xs = lasso.map((p) => p.x);
    const ys = lasso.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }, [lasso]);
  const monitorBox: Box = { x: 0, y: 0, w: image.w, h: image.h };

  /** The rectangle that is highlighted: the area that would be captured now. */
  const selection: Box | null =
    mode === "rectangle" ? dragged : mode === "window" ? hoveredBox : mode === "fullscreen" ? (inside ? monitorBox : null) : lassoBox;

  // --- finishing ----------------------------------------------------------------
  const done = () => {
    reset();
    setInfo(null);
    setDrawn(false);
  };

  const cancel = () => {
    done();
    void ipc.captureCancel();
  };

  const finish = (rect: Box, extra: { points?: [number, number][]; windowTitle?: string } = {}) => {
    void ipc.captureFinish({
      label,
      mode,
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)],
      ...extra,
    });
    done();
  };

  const chooseMode = (next: CaptureModeId) => {
    if (next === mode) return;
    setMode(next);
    reset();
    void ipc.captureSetMode(next);
  };

  /** The delay dropdown. Any delay but "none" closes this overlay: the backend counts down, grabs again and reopens. */
  const chooseDelay = (next: number) => {
    setDelayOpen(false);
    setDelay(next);
    void ipc.captureSetDelay(next);
    if (next > 0) done();
  };
  const delayText = (d: number) => (d === 0 ? t("delay.none") : t("delay.seconds", { count: d }));

  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Esc closes an open dropdown first, then the capture.
        if (delayOpen) setDelayOpen(false);
        else cancel();
        return;
      }
      const next = modeForKey(e.key);
      if (next) {
        e.preventDefault();
        chooseMode(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- pointer ------------------------------------------------------------------------
  const cssPoint = (e: ReactPointerEvent): Pt => ({ x: e.clientX, y: e.clientY });
  /** Keep getting the pointer's events while it is held, even outside the window (not possible for a synthetic pointer). */
  const hold = (e: ReactPointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The drag still works inside the window.
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (delayOpen) return setDelayOpen(false); // a click outside the dropdown only closes it
    if (e.button === 2) return cancel();
    if (e.button !== 0) return;
    const p = toPhysical(cssPoint(e), ratio);
    if (mode === "rectangle") {
      hold(e);
      setDragFrom(p);
      setDragTo(p);
    } else if (mode === "freeform") {
      hold(e);
      setLasso([p]);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const css = cssPoint(e);
    setPointer(css);
    setInside(true);
    const p = toPhysical(css, ratio);
    if (dragFrom) setDragTo(p);
    if (mode === "freeform" && lasso.length > 0 && e.buttons & 1) setLasso((l) => thin([...l, p], 2));
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = toPhysical(cssPoint(e), ratio);
    if (mode === "rectangle" && dragFrom) {
      const box = dragBox(dragFrom, p, image);
      setDragFrom(null);
      setDragTo(null);
      if (box) finish(box);
    } else if (mode === "window") {
      if (hovered) finish(windowToLocal(hovered, monitorOrigin), { windowTitle: hovered.title });
    } else if (mode === "fullscreen") {
      finish(monitorBox);
    } else if (mode === "freeform" && lasso.length > 0) {
      const pts = thin([...lasso, p], 2);
      setLasso([]);
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const box = dragBox({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }, image);
      if (pts.length >= 3 && box) finish(box, { points: pts.map((q) => [q.x, q.y]) });
    }
  };

  // --- the magnifier -----------------------------------------------------------------------
  useEffect(() => {
    const c = loupe.current;
    if (!c || !drawn || !physical || !info?.magnifier) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const src = loupeSource(physical, LOUPE_CELLS, image);
    const cell = LOUPE / LOUPE_CELLS;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(canvas.current!, src.x, src.y, src.w, src.h, 0, 0, LOUPE, LOUPE);
    // The pixel grid
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < LOUPE_CELLS; i++) {
      ctx.moveTo(i * cell + 0.5, 0);
      ctx.lineTo(i * cell + 0.5, LOUPE);
      ctx.moveTo(0, i * cell + 0.5);
      ctx.lineTo(LOUPE, i * cell + 0.5);
    }
    ctx.stroke();
    // The pixel under the pointer: its cell and a centre crosshair
    const px = Math.floor(physical.x) - src.x;
    const py = Math.floor(physical.y) - src.y;
    ctx.strokeStyle = "#e53935";
    ctx.lineWidth = 2;
    ctx.strokeRect(px * cell + 1, py * cell + 1, cell - 2, cell - 2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, 0);
    ctx.lineTo(LOUPE / 2, LOUPE);
    ctx.moveTo(0, LOUPE / 2);
    ctx.lineTo(LOUPE, LOUPE / 2);
    ctx.stroke();
  }, [physical?.x, physical?.y, drawn, info?.magnifier]);

  if (!info) return <div className="overlay overlay--idle" />;

  const loupeAt = pointer ? loupePlacement(pointer, LOUPE, viewport) : null;
  const css = selection ? boxToCss(selection, ratio) : null;
  const readout = selection && (mode !== "fullscreen" || inside) ? sizeLabel(selection) : null;
  const readoutAt = css && readout ? readoutPosition(css, { w: 96, h: 26 }, viewport) : null;
  const dimPath =
    `M0 0H${image.w}V${image.h}H0Z` +
    (mode === "freeform" && lasso.length > 2
      ? `M${lasso.map((p) => `${p.x} ${p.y}`).join("L")}Z`
      : selection
        ? `M${selection.x} ${selection.y}h${selection.w}v${selection.h}h${-selection.w}Z`
        : "");

  return (
    <div
      className={drawn ? "overlay" : "overlay overlay--loading"}
      data-mode={mode}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setPointer(null);
        setInside(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvas} className="overlay__frozen" />
      <svg className="overlay__shade" viewBox={`0 0 ${image.w} ${image.h}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={dimPath} fillRule="evenodd" className={selection || lasso.length > 2 ? "shade shade--sel" : "shade"} />
        {mode === "freeform" && lasso.length > 1 && (
          <polyline points={lasso.map((p) => `${p.x},${p.y}`).join(" ")} className="outline" fill="none" />
        )}
        {mode !== "freeform" && selection && (
          <rect x={selection.x} y={selection.y} width={selection.w} height={selection.h} className="outline" fill="none" />
        )}
      </svg>

      {readoutAt && readout && (
        <div className="readout" style={{ left: readoutAt.x, top: readoutAt.y }} dir="ltr">
          {readout}
        </div>
      )}

      {info.magnifier && loupeAt && (
        <canvas
          ref={loupe}
          className="loupe"
          width={LOUPE}
          height={LOUPE}
          style={{ left: loupeAt.x, top: loupeAt.y }}
          aria-hidden="true"
        />
      )}

      {info.focus && (
        <div className="modebar" role="toolbar" aria-label={t("overlay.modes")} onPointerDown={(e) => e.stopPropagation()}>
          {MODE_ORDER.map((m, i) => (
            <button
              key={m}
              type="button"
              className="modebar__btn"
              aria-pressed={m === mode}
              title={`${t(`mode.${m}`)} (${i + 1})`}
              onClick={() => chooseMode(m)}
            >
              <AppIcon name={MODE_ICONS[m]} size={18} />
              <span>{t(`mode.${m}`)}</span>
              <kbd dir="ltr">{i + 1}</kbd>
            </button>
          ))}
          <span className="modebar__sep" aria-hidden="true" />
          <div className="modebar__delay">
            <button
              type="button"
              className="modebar__btn"
              aria-haspopup="listbox"
              aria-expanded={delayOpen}
              title={t("capture.delay")}
              aria-label={`${t("capture.delay")}: ${delayText(delay)}`}
              onClick={() => setDelayOpen((o) => !o)}
            >
              <AppIcon name="clock" size={18} />
              <span>{delayText(delay)}</span>
              <AppIcon name="chevron" size={14} />
            </button>
            {delayOpen && (
              <ul className="modebar__menu" role="listbox" aria-label={t("capture.delay")}>
                {DELAYS.map((d) => (
                  <li key={d} role="presentation">
                    <button type="button" role="option" aria-selected={d === delay} className="modebar__option" onClick={() => chooseDelay(d)}>
                      {delayText(d)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="modebar__btn modebar__btn--icon" title={t("overlay.cancel")} aria-label={t("overlay.cancel")} onClick={cancel}>
            <AppIcon name="close" size={18} />
          </button>
          <div className="modebar__hint">{t(`overlay.hint.${mode}`)}</div>
        </div>
      )}
    </div>
  );
}
