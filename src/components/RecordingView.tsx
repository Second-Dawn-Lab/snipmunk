import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, recordingUrl, type Capture, type Session } from "../ipc";
import { parseCursorFile, type CursorFile } from "../recording/cursorFile";
import { effectsFromSettings, readEffects, type Effects } from "../recording/effects";
import { defaultSettings, type Settings } from "../settings/defaults";
import { EffectsPanel } from "./EffectsPanel";
import { RecPlayer, type RecInfo } from "./RecPlayer";

/** How long a change of the effects waits for more changes before it is written to the recording. */
const SAVE_DELAY_MS = 300;

/**
 * A recording in the recording tab: the player and, next to it, the effects panel. It reads the recording's files (recording.json,
 * the cursor track), keeps the effects, and saves every change with the recording (so it is still there after a restart and is
 * used by the next export).
 */
export function RecordingView(props: { session: Session; capture: Capture; settings: Settings; onError: (e: unknown) => void }) {
  const { session, capture, onError } = props;
  const [info, setInfo] = useState<RecInfo | null>(null);
  const [cursor, setCursor] = useState<CursorFile | null>(null);
  const defaults = effectsFromSettings(props.settings ?? defaultSettings);
  const [effects, setEffects] = useState<Effects>(defaults);
  const timer = useRef<number | null>(null);
  const pending = useRef<Effects | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) void ipc.setEffects(capture.id, next).catch(onError);
  }, [capture.id, onError]);

  // The files of this recording, read when it is shown.
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setCursor(null);
    void (async () => {
      try {
        const i = (await (await fetch(recordingUrl(session, capture, "recording.json"))).json()) as RecInfo & { effects?: unknown };
        if (!alive) return;
        setInfo(i);
        setEffects(readEffects(i.effects, effectsFromSettings(defaultSettings)));
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
      flush();
    };
  }, [session.id, capture.id]);

  const change = useCallback(
    (next: Effects) => {
      setEffects(next);
      pending.current = next;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const reset = () => {
    // The trim is not an effect of the panel: it stays.
    const next = { ...effectsFromSettings(props.settings ?? defaultSettings), trim: effects.trim };
    change(next);
  };

  return (
    <div className="recview">
      <RecPlayer session={session} capture={capture} info={info} cursor={cursor} effects={effects} onEffects={change} />
      <EffectsPanel effects={effects} hasWebcam={!!info?.webcamFile} onChange={change} onReset={reset} />
    </div>
  );
}
