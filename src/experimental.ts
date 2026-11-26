import { useEffect, useState } from "react";
import { ipc } from "./ipc";

let cached: Promise<boolean> | null = null;

/** Is the parked scrolling screenshot switched on? Asked once; false in a release build (which has no such command),
 * outside Tauri and when the call fails. */
export function experimentalScroll(): Promise<boolean> {
  cached ??= import.meta.env.DEV ? ipc.experimentalScroll().catch(() => false) : Promise.resolve(false);
  return cached;
}

/** For components: the answer, false until it is known. */
export function useExperimentalScroll(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void experimentalScroll().then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}
