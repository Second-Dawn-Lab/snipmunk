import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { recordingUrl, type Capture, type Session } from "../ipc";
import { cursorAt } from "../recording/cursorTrack";
import { parseCursorFile, type CursorFile } from "../recording/cursorFile";
import { formatTime } from "../recording/timeline";
import { AppIcon } from "./AppIcons";

interface Info {
  systemFile?: string | null;
  micFile?: string | null;
  cursorFile?: string | null;
}

/** Keep an audio track in step with the video; a drift of more than this many seconds is corrected. */
const DRIFT = 0.15;

/**
 * The player of a recording: the video (the screen, recorded without the cursor), the audio tracks (system sound and microphone,
 * each with its own volume) and the cursor drawn on top from the cursor track, at normal size and in step with the video.
 * Space plays and pauses, the bar seeks, the button on the right goes full screen.
 */
export function RecPlayer(props: { session: Session; capture: Capture }) {
  const { session, capture } = props;
  const { t } = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sys = useRef<HTMLAudioElement>(null);
  const mic = useRef<HTMLAudioElement>(null);
  const [info, setInfo] = useState<Info>({});
  const [cursor, setCursor] = useState<CursorFile | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState((capture.durationMs ?? 0) / 1000);
  const [volumes, setVolumes] = useState({ system: 1, mic: 1 });
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);

  // What the recording has besides the video: read when another recording is shown.
  useEffect(() => {
    let alive = true;
    setInfo({});
    setCursor(null);
    images.current.clear();
    setPlaying(false);
    setTime(0);
    setFailed(false);
    setDuration((capture.durationMs ?? 0) / 1000);
    void (async () => {
      try {
        const i = (await (await fetch(recordingUrl(session, capture, "recording.json"))).json()) as Info;
        if (!alive) return;
        setInfo(i);
        if (i.cursorFile) {
          const text = await (await fetch(recordingUrl(session, capture, i.cursorFile))).text();
          if (alive) setCursor(parseCursorFile(text));
        }
      } catch {
        /* a recording without the extra files plays the video only */
      }
    })();
    return () => {
      alive = false;
    };
  }, [session.id, capture.id]);

  const audios = useCallback(() => [sys.current, mic.current].filter((a): a is HTMLAudioElement => a !== null), []);

  // Draw the cursor for the time of the video.
  const draw = useCallback(() => {
    const c = canvas.current;
    const v = video.current;
    const s = stage.current;
    if (!c || !v || !s) return;
    const box = s.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(box.width * ratio);
    const h = Math.round(box.height * ratio);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    if (!cursor || !v.videoWidth) return;
    const state = cursorAt(cursor.samples, v.currentTime);
    if (!state || !state.visible) return;
    // The video fills the stage as large as it fits (object-fit: contain): the cursor is drawn in the same scale.
    const scale = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
    const ox = (box.width - v.videoWidth * scale) / 2;
    const oy = (box.height - v.videoHeight * scale) / 2;
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
    g.drawImage(
      img,
      (ox + (state.x - shape.hx) * scale) * ratio,
      (oy + (state.y - shape.hy) * scale) * ratio,
      shape.w * scale * ratio,
      shape.h * scale * ratio,
    );
  }, [cursor, session, capture]);

  // While playing: the cursor follows every picture, and an audio track that drifted is brought back.
  useEffect(() => {
    draw();
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        setTime(v.currentTime);
        for (const a of audios()) if (Math.abs(a.currentTime - v.currentTime) > DRIFT) a.currentTime = v.currentTime;
      }
      draw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, draw, audios]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(el);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    if (sys.current) sys.current.volume = volumes.system;
    if (mic.current) mic.current.volume = volumes.mic;
  }, [volumes, info]);

  useEffect(() => {
    const onFull = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      for (const a of audios()) a.currentTime = v.currentTime;
      void v.play().catch(() => setFailed(true));
      for (const a of audios()) void a.play().catch(() => undefined);
    } else {
      v.pause();
      for (const a of audios()) a.pause();
    }
  }, [audios]);

  // Space plays and pauses (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const seek = (to: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = to;
    for (const a of audios()) a.currentTime = to;
    setTime(to);
    draw();
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.current?.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className={`recplayer${full ? " recplayer--full" : ""}`} ref={wrap}>
      <div className="recplayer__stage" ref={stage} onClick={toggle}>
        <video
          ref={video}
          className="recplayer__video"
          src={recordingUrl(session, capture, "screen.mp4")}
          crossOrigin="anonymous"
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
            draw();
          }}
          onSeeked={() => draw()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            for (const a of audios()) a.pause();
          }}
          onError={() => setFailed(true)}
        />
        <canvas className="recplayer__cursor" ref={canvas} aria-hidden="true" />
        {failed && <p className="recplayer__error">{t("rec.loadFailed")}</p>}
      </div>
      {info.systemFile && <audio ref={sys} src={recordingUrl(session, capture, info.systemFile)} preload="auto" crossOrigin="anonymous" />}
      {info.micFile && <audio ref={mic} src={recordingUrl(session, capture, info.micFile)} preload="auto" crossOrigin="anonymous" />}

      <div className="recplayer__bar">
        <button type="button" className="recplayer__btn" onClick={toggle} title={playing ? t("rec.pause") : t("rec.play")} aria-label={playing ? t("rec.pause") : t("rec.play")}>
          <AppIcon name={playing ? "pause" : "play"} size={18} />
        </button>
        <span className="recplayer__time" dir="ltr">
          {formatTime(time)}
        </span>
        <input
          type="range"
          className="recplayer__seek"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={t("rec.seek")}
          dir="ltr"
        />
        <span className="recplayer__time" dir="ltr">
          {formatTime(duration)}
        </span>
        {info.systemFile && (
          <label className="recplayer__vol" title={t("rec.soundToggle")}>
            <AppIcon name="speaker" size={16} />
            <input type="range" min={0} max={1} step={0.05} value={volumes.system} onChange={(e) => setVolumes((v) => ({ ...v, system: Number(e.target.value) }))} aria-label={t("rec.soundToggle")} dir="ltr" />
          </label>
        )}
        {info.micFile && (
          <label className="recplayer__vol" title={t("rec.micToggle")}>
            <AppIcon name="mic" size={16} />
            <input type="range" min={0} max={1} step={0.05} value={volumes.mic} onChange={(e) => setVolumes((v) => ({ ...v, mic: Number(e.target.value) }))} aria-label={t("rec.micToggle")} dir="ltr" />
          </label>
        )}
        <button type="button" className="recplayer__btn" onClick={toggleFull} title={full ? t("rec.exitFullscreen") : t("rec.fullscreen")} aria-label={full ? t("rec.exitFullscreen") : t("rec.fullscreen")}>
          <AppIcon name="fullscreen" size={18} />
        </button>
        <button type="button" className="recplayer__studio" disabled title={t("soon.label")} aria-label={`${t("rec.studio")} (${t("soon.label")})`}>
          {t("rec.studio")}
        </button>
      </div>
    </div>
  );
}
