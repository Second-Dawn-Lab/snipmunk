import { useMemo, useRef } from "react";

/**
 * An object whose functions never change but always call the latest version of `fns`. Memoised list items can take it
 * as a prop and still run the current state's code, so the items do not render again when the window does.
 */
export function useStable<T extends Record<string, (...args: never[]) => unknown>>(fns: T): T {
  const latest = useRef(fns);
  latest.current = fns;
  return useMemo(() => {
    const stable: Record<string, unknown> = {};
    for (const key of Object.keys(fns)) {
      stable[key] = (...args: never[]) => (latest.current[key] as (...a: never[]) => unknown)(...args);
    }
    return stable as T;
    // The set of functions is fixed.
  }, []);
}
