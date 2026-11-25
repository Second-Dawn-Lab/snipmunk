import { useEffect, useState } from "react";
import { ipc } from "../ipc";

/** The red frame around the window or region a guide records (its own click-through window); dimmed while the guide is paused. */
export function GuideFrame() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    void ipc.guideState().then((s) => setPaused(s.paused)).catch(() => undefined);
    const p = ipc.onGuideState((s) => setPaused(s.paused));
    return () => void p.then((fn) => fn());
  }, []);
  return <div className={`recframe${paused ? " recframe--paused" : ""}`} />;
}
