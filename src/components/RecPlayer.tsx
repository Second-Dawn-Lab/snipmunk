import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { recordingUrl, type Capture, type Session } from "../ipc";
import { clicksOf, cursorAt } from "../recording/cursorTrack";
import type { CursorFile } from "../recording/cursorFile";
import { activeClicks, clickMax, drawBurst, drawHalo, drawRipple, haloRadius } from "../recording/drawFx";
import { BORDER_WIDTH, CURSOR_SCALE, WEBCAM_WIDTH, trimRange, type Effects } from "../recording/effects";
import { clampTrim, formatTime } from "../recording/timeline";
import { AppIcon } from "./AppIcons";

/** What recording.json says that the player needs. */
export interface RecInfo {
  systemFile?: string | null;
  micFile?: string | null;
  cursorFile?: string | null;
  webcamFile?: string | null;
  webcamStartMs?: number;
  fps?: number;
}

/** Keep an audio track in step with the video; a drift of more than this many seconds is corrected. */
const DRIFT = 0.15;
/** The shortest part a trim can leave (seconds). */
const MIN_TRIM = 0.2;

/** The video as it is shown inside the stage (the video fills the stage as large as it fits). */
interface Box {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
}

/**
 * The player of a recording: the video (the screen, recorded without the cursor), the audio tracks (system sound and microphone,
 * each with a mute button and a volume), the cursor with its halo and the click effects drawn on top from the cursor track, the
 * webcam over a corner (or where it was dragged to), and a timeline with handles that trim the start and the end. Everything is
 * drawn from `effects`, the same numbers the export uses. Space plays and pauses; the button on the right goes full screen.
 */
export function RecPlayer(props: {
  session: Session;
  capture: Capture;
  info: RecInfo | null;
  cursor: CursorFile | null;
  effects: Effects;
  onEffects: (next: Effects) => void;
}) {
  const { session, capture, info, cursor, effects, onEffects } = props;
  const { t } = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const cam = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sys = useRef<HTMLAudioElement>(null);
  const mic = useRef<HTMLAudioElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState((capture.durationMs ?? 0) / 1000);
  // What plays is always what these say: the audio elements are forced to this (the browser's own controls are never shown).
  const [volumes, setVolumes] = useState({ system: 1, mic: 1 });
  const [muted, setMuted] = useState({ system: false, mic: false });
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState<Box>({ vx: 0, vy: 0, vw: 1, vh: 1 });
  // The trim while a handle is dragged (seconds); saved when it is let go.
  // The trim handles are only there in trim mode; the kept part stays visible as a band.
  const [trimMode, setTrimMode] = useState(false);
  // "Edit webcam": handles on the webcam bubble to resize it directly on the video.
  const [editCam, setEditCam] = useState(false);
  const [dragTrim, setDragTrim] = useState<{ start: number; end: number } | null>(null);

  const saved = useMemo(() => {
    const [start, end] = trimRange(effects.trim, duration);
    return { start, end };
  }, [effects.trim, duration]);
  const trim = dragTrim ?? saved;
  const fx = useRef(effects);
  fx.current = effects;
  const trimRef = useRef(trim);
  trimRef.current = trim;
  const clicks = useMemo(() => (cursor ? clicksOf(cursor.samples) : []), [cursor]);

  // Another recording: start over.
  useEffect(() => {
    images.current.clear();
    setPlaying(false);
    setTime(0);
    setFailed(false);
    setDuration((capture.durationMs ?? 0) / 1000);
  }, [session.id, capture.id, capture.durationMs]);

  const media = useCallback(() => [sys.current, mic.current].filter((a): a is HTMLAudioElement => a !== null), []);
  const camOffset = (info?.webcamStartMs ?? 0) / 1000;

  /** Where the video lies in the stage. */
  const measure = useCallback((): Box | null => {
    const s = stage.current;
    const v = video.current;
    if (!s || !v || !v.videoWidth) return null;
    const r = s.getBoundingClientRect();
    const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const vw = v.videoWidth * scale;
    const vh = v.videoHeight * scale;
    return { vx: (r.width - vw) / 2, vy: (r.height - vh) / 2, vw, vh };
  }, []);

  // Draw the halo, the click effects and the cursor for the time of the video.
  const draw = useCallback(() => {
    const c = canvas.current;
    const v = video.current;
    const s = stage.current;
    if (!c || !v || !s) return;
    const r = s.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(r.width * ratio);
    const h = Math.round(r.height * ratio);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const b = measure();
    if (!cursor || !b || !v.videoWidth) return;
    const e = fx.current;
    const scale = (b.vw / v.videoWidth) * ratio;
    const ox = b.vx * ratio;
    const oy = b.vy * ratio;
    const state = cursorAt(cursor.samples, v.currentTime);
    const cs = CURSOR_SCALE[e.cursor.size];
    if (e.cursor.show && state?.visible && e.cursor.halo) {
      drawHalo(g, ox + state.x * scale, oy + state.y * scale, haloRadius(v.videoHeight, e.cursor.size) * scale, e.cursor.haloColor);
    }
    if (e.click.kind !== "off") {
      const max = clickMax(v.videoHeight, e.click.size) * scale;
      for (const { click, age } of activeClicks(clicks, v.currentTime)) {
        const color = click.button === "left" ? e.click.left : e.click.right;
        const x = ox + click.x * scale;
        const y = oy + click.y * scale;
        if (e.click.kind === "burst") drawBurst(g, x, y, max, age, color);
        else drawRipple(g, x, y, max, age, color);
      }
    }
    if (!e.cursor.show || !state || !state.visible) return;
    const shape = cursor.shapes[state.shape];
    if (!shape) return;
    let img = images.current.get(shape.id);
    if (!img) {
      img = new Image();
      img.src = recordingUrl(session, capture, shape.file);
      img.onload = () => draw();
      images.current.set(shape.id, img);
    }
    if (!img.complete || img.naturalWidth === 0) return;
    g.drawImage(img, ox + (state.x - shape.hx * cs) * scale, oy + (state.y - shape.hy * cs) * scale, shape.w * cs * scale, shape.h * cs * scale);
  }, [cursor, clicks, session, capture, measure]);

  // The webcam picture follows the video.
  const syncCam = useCallback(() => {
    const v = video.current;
    const c = cam.current;
    if (!v || !c) return;
    const want = v.currentTime - camOffset;
    if (want < 0) return;
    if (Math.abs(c.currentTime - want) > DRIFT) c.currentTime = Math.min(want, Number.isFinite(c.duration) ? c.duration : want);
  }, [camOffset]);

  // While playing: the cursor follows every picture, tracks that drifted are brought back, and the end of the trim stops playback.
  useEffect(() => {
    draw();
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        if (v.currentTime >= trimRef.current.end) {
          v.pause();
          for (const a of media()) a.pause();
          cam.current?.pause();
          v.currentTime = trimRef.current.end;
          setTime(trimRef.current.end);
          setPlaying(false);
          draw();
          return;
        }
        setTime(v.currentTime);
        for (const a of media()) if (Math.abs(a.currentTime - v.currentTime) > DRIFT) a.currentTime = v.currentTime;
        syncCam();
      }
      draw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, draw, media, syncCam]);

  // Redraw when the effects change (also while paused).
  useEffect(() => draw(), [effects, draw]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const b = measure();
      if (b) setBox(b);
      draw();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [draw, measure]);

  useEffect(() => {
    const apply = () => {
      for (const [el, vol, mute] of [
        [sys.current, volumes.system, muted.system],
        [mic.current, volumes.mic, muted.mic],
      ] as const) {
        if (!el) continue;
        if (el.volume !== vol) el.volume = vol;
        if (el.muted !== mute) el.muted = mute;
      }
      // The picture's own sound is never used: the tracks are separate files.
      if (video.current && !video.current.muted) video.current.muted = true;
      if (cam.current && !cam.current.muted) cam.current.muted = true;
    };
    apply();
    // Whatever changes volume or mute behind our back (the browser, the system) is put back at once.
    const els = [sys.current, mic.current, video.current, cam.current].filter((e): e is HTMLMediaElement => e !== null);
    for (const e of els) e.addEventListener("volumechange", apply);
    return () => {
      for (const e of els) e.removeEventListener("volumechange", apply);
    };
  }, [volumes, muted, info]);

  useEffect(() => {
    const onFull = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    const { start, end } = trimRef.current;
    if (v.paused || v.ended) {
      if (v.ended || v.currentTime >= end - 0.05 || v.currentTime < start) v.currentTime = start;
      for (const a of media()) a.currentTime = v.currentTime;
      syncCam();
      void v.play().catch(() => setFailed(true));
      for (const a of media()) void a.play().catch(() => undefined);
      void cam.current?.play().catch(() => undefined);
    } else {
      v.pause();
      for (const a of media()) a.pause();
      cam.current?.pause();
    }
  }, [media, syncCam]);

  // Space plays and pauses (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const seek = (to: number) => {
    const v = video.current;
    if (!v) return;
    const at = Math.min(trimRef.current.end, Math.max(trimRef.current.start, to));
    v.currentTime = at;
    for (const a of media()) a.currentTime = at;
    syncCam();
    setTime(at);
    draw();
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.current?.requestFullscreen().catch(() => undefined);
  };

  // --- the timeline: playhead and the two trim handles ---------------------------------------------------------------------
  /** Scrubbing: the playhead follows the pointer while it is held down on the timeline (the picture follows). */
  const scrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    seek(secondsAt(e.clientX));
    const move = (ev: PointerEvent) => seek(secondsAt(ev.clientX));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  // ← and → step one picture (Shift: one second) while the player has the focus.
  const stepKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const target = e.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.getAttribute("role") === "slider") return;
    e.preventDefault();
    const v = video.current;
    if (!v) return;
    if (!v.paused) toggle();
    const d = e.shiftKey ? 1 : 1 / (info?.fps || 30);
    seek(v.currentTime + (e.key === "ArrowLeft" ? -d : d));
  };
  const secondsAt = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };
  const saveTrim = (next: { start: number; end: number }) =>
    onEffects({
      ...fx.current,
      trim: { startMs: Math.round(next.start * 1000), endMs: next.end >= duration - 0.05 ? null : Math.round(next.end * 1000) },
    });
  const dragHandle = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let latest = { ...trimRef.current };
    const move = (ev: PointerEvent) => {
      const at = secondsAt(ev.clientX);
      // A handle stops where the other one is (at least MIN_TRIM apart).
      latest =
        which === "start"
          ? { start: Math.min(Math.max(0, at), latest.end - MIN_TRIM), end: latest.end }
          : { start: latest.start, end: Math.max(Math.min(duration, at), latest.start + MIN_TRIM) };
      setDragTrim(latest);
      // The picture follows the handle.
      const v = video.current;
      if (v) v.currentTime = which === "start" ? latest.start : latest.end;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDragTrim(null);
      saveTrim(latest);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const handleKey = (which: "start" | "end") => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    let d = 0;
    if (e.key === "ArrowLeft") d = -step;
    else if (e.key === "ArrowRight") d = step;
    else return;
    e.preventDefault();
    const cur = trimRef.current;
    saveTrim(clampTrim(which === "start" ? { start: cur.start + d, end: cur.end } : { start: cur.start, end: cur.end + d }, duration, MIN_TRIM));
  };
  const pct = (s: number) => `${duration > 0 ? (s / duration) * 100 : 0}%`;

  // --- the webcam over the video -------------------------------------------------------------------------------------------
  const camBox = (() => {
    const w = box.vw * WEBCAM_WIDTH[effects.webcam.size];
    const h = effects.webcam.shape === "rect" ? (w * 9) / 16 : w;
    const margin = box.vw * 0.02;
    let cx: number;
    let cy: number;
    if (effects.webcam.position === "free") {
      cx = effects.webcam.x * box.vw;
      cy = effects.webcam.y * box.vh;
    } else {
      cx = effects.webcam.position.endsWith("left") ? margin + w / 2 : box.vw - margin - w / 2;
      cy = effects.webcam.position.startsWith("top") ? margin + h / 2 : box.vh - margin - h / 2;
    }
    const x = Math.min(Math.max(0, cx - w / 2), Math.max(0, box.vw - w));
    const y = Math.min(Math.max(0, cy - h / 2), Math.max(0, box.vh - h));
    return { x, y, width: w, height: h };
  })();
  const dragCam = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { x: camBox.x, y: camBox.y };
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, base.x + ev.clientX - startX), Math.max(0, box.vw - camBox.width));
      const y = Math.min(Math.max(0, base.y + ev.clientY - startY), Math.max(0, box.vh - camBox.height));
      onEffects({
        ...fx.current,
        webcam: { ...fx.current.webcam, position: "free", x: (x + camBox.width / 2) / box.vw, y: (y + camBox.height / 2) / box.vh },
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  /** Resize from a corner handle: the bubble keeps its centre and takes the nearest of the sizes S, M, L. */
  const resizeCam = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const stage0 = stage.current?.getBoundingClientRect();
    if (!stage0) return;
    const cx = stage0.left + box.vx + camBox.x + camBox.width / 2;
    const move = (ev: PointerEvent) => {
      const width = 2 * Math.abs(ev.clientX - cx);
      let best: Effects["webcam"]["size"] = "m";
      let bestD = Infinity;
      for (const k of ["s", "m", "l"] as const) {
        const d = Math.abs(WEBCAM_WIDTH[k] * box.vw - width);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best !== fx.current.webcam.size) onEffects({ ...fx.current, webcam: { ...fx.current.webcam, size: best } });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const showCam = !!info?.webcamFile && effects.webcam.show && time >= camOffset;

  return (
    <div className={`recplayer${full ? " recplayer--full" : ""}`} ref={wrap} tabIndex={0} onKeyDown={stepKey} onContextMenu={(e) => e.preventDefault()}>
      <div className="recplayer__stage" ref={stage} onClick={toggle}>
        <video
          ref={video}
          className="recplayer__video"
          src={recordingUrl(session, capture, "screen.mp4")}
          crossOrigin="anonymous"
          muted
          controls={false}
          controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
          disablePictureInPicture
          disableRemotePlayback
          onContextMenu={(e) => e.preventDefault()}
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
            const b = measure();
            if (b) setBox(b);
            // The preview starts at the trim start.
            e.currentTarget.currentTime = trimRef.current.start;
            setTime(trimRef.current.start);
            draw();
          }}
          onSeeked={() => draw()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            for (const a of media()) a.pause();
            cam.current?.pause();
          }}
          onError={() => setFailed(true)}
        />
        <canvas className="recplayer__cursor" ref={canvas} aria-hidden="true" />
        {info?.webcamFile && (
          <video
            ref={cam}
            className={`recplayer__cam recplayer__cam--${effects.webcam.shape}`}
            style={{
              left: box.vx + camBox.x,
              top: box.vy + camBox.y,
              width: camBox.width,
              height: camBox.height,
              display: showCam ? "block" : "none",
              // The border lies on the inside of the edge, like the export's.
              outline: effects.webcam.border === "off" ? "none" : `${Math.max(2, Math.min(camBox.width, camBox.height) * BORDER_WIDTH[effects.webcam.border])}px solid ${effects.webcam.borderColor}`,
              outlineOffset: effects.webcam.border === "off" ? 0 : -Math.max(2, Math.min(camBox.width, camBox.height) * BORDER_WIDTH[effects.webcam.border]),
            }}
            src={recordingUrl(session, capture, info.webcamFile)}
            crossOrigin="anonymous"
            muted
            controls={false}
            disablePictureInPicture
            disableRemotePlayback
            playsInline
            preload="auto"
            onPointerDown={dragCam}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            title={t("fx.webcamDrag")}
          />
        )}
        {editCam && showCam && (
          <div className="recplayer__camframe" style={{ left: box.vx + camBox.x, top: box.vy + camBox.y, width: camBox.width, height: camBox.height }} aria-hidden="true">
            {(["nw", "ne", "sw", "se"] as const).map((c) => (
              <span key={c} className={`recplayer__camhandle recplayer__camhandle--${c}`} onPointerDown={resizeCam} />
            ))}
          </div>
        )}
        {failed && <p className="recplayer__error">{t("rec.loadFailed")}</p>}
      </div>
      {info?.systemFile && <audio ref={sys} src={recordingUrl(session, capture, info.systemFile)} preload="auto" crossOrigin="anonymous" controls={false} />}
      {info?.micFile && <audio ref={mic} src={recordingUrl(session, capture, info.micFile)} preload="auto" crossOrigin="anonymous" controls={false} />}

      <div className="recplayer__bar">
        <button type="button" className="recplayer__btn" onClick={toggle} title={playing ? t("rec.pause") : t("rec.play")} aria-label={playing ? t("rec.pause") : t("rec.play")}>
          <AppIcon name={playing ? "pause" : "play"} size={18} />
        </button>
        <span className="recplayer__time" dir="ltr">
          {formatTime(Math.max(0, time - trim.start))}
        </span>
        <div className="recplayer__timeline" ref={track} dir="ltr" onPointerDown={scrub}>
          <div className="recplayer__rail" />
          <div className="recplayer__kept" style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
          <div className="recplayer__head" style={{ left: pct(Math.min(Math.max(time, trim.start), trim.end)) }} />
          {trimMode && (
          <button
            type="button"
            role="slider"
            className="recplayer__handle recplayer__handle--start"
            style={{ left: pct(trim.start) }}
            aria-label={t("rec.trimStart")}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 1000)}
            aria-valuenow={Math.round(trim.start * 1000)}
            title={t("rec.trimStart")}
            onPointerDown={dragHandle("start")}
            onKeyDown={handleKey("start")}
          />
          )}
          {trimMode && (
          <button
            type="button"
            role="slider"
            className="recplayer__handle recplayer__handle--end"
            style={{ left: pct(trim.end) }}
            aria-label={t("rec.trimEnd")}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 1000)}
            aria-valuenow={Math.round(trim.end * 1000)}
            title={t("rec.trimEnd")}
            onPointerDown={dragHandle("end")}
            onKeyDown={handleKey("end")}
          />
          )}
        </div>
        {info?.webcamFile && (
          <button
            type="button"
            className={`recplayer__btn${editCam ? " recplayer__btn--on" : ""}`}
            aria-pressed={editCam}
            title={t("rec.webcamEdit")}
            aria-label={t("rec.webcamEdit")}
            onClick={() => setEditCam((m) => !m)}
          >
            <AppIcon name="webcam" size={16} />
          </button>
        )}
        <button
          type="button"
          className={`recplayer__btn${trimMode ? " recplayer__btn--on" : ""}`}
          aria-pressed={trimMode}
          title={t("rec.trimMode")}
          aria-label={t("rec.trimMode")}
          onClick={() => setTrimMode((m) => !m)}
        >
          <AppIcon name="scissors" size={16} />
        </button>
        <span className="recplayer__time" dir="ltr" title={t("rec.trimmedLength")}>
          {formatTime(trim.end - trim.start)}
        </span>
        {(["system", "mic"] as const).map((k) => {
          const file = k === "system" ? info?.systemFile : info?.micFile;
          if (!file) return null;
          const off = muted[k] || volumes[k] === 0;
          const label = k === "system" ? t("rec.soundToggle") : t("rec.micToggle");
          const icon = k === "system" ? (off ? "speakerOff" : "speaker") : off ? "micOff" : "mic";
          return (
            <span className="recplayer__vol" key={k}>
              <button
                type="button"
                className={`recplayer__btn${off ? " recplayer__btn--off" : ""}`}
                title={label}
                aria-label={label}
                aria-pressed={!off}
                onClick={() => {
                  // Click = mute / unmute; a track whose slider is at 0 comes back at full volume.
                  if (volumes[k] === 0) setVolumes((v) => ({ ...v, [k]: 1 }));
                  setMuted((m) => ({ ...m, [k]: volumes[k] === 0 ? false : !m[k] }));
                }}
              >
                <AppIcon name={icon} size={16} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted[k] ? 0 : volumes[k]}
                onChange={(e) => {
                  setVolumes((v) => ({ ...v, [k]: Number(e.target.value) }));
                  setMuted((m) => ({ ...m, [k]: false }));
                }}
                aria-label={label}
                dir="ltr"
              />
            </span>
          );
        })}
        <button type="button" className="recplayer__btn" onClick={toggleFull} title={full ? t("rec.exitFullscreen") : t("rec.fullscreen")} aria-label={full ? t("rec.exitFullscreen") : t("rec.fullscreen")}>
          <AppIcon name="fullscreen" size={18} />
        </button>
      </div>
    </div>
  );
}
