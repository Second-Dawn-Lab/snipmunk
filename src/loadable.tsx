// A component whose code is loaded when it is first needed. Unlike React.lazy with Suspense, it renders at once when the
// code is already there, and it shows the code as soon as it arrives (React holds a Suspense fallback for at least 300 ms,
// which would be felt at start-up and at every first change of mode).
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

export interface Loadable<P> {
  (props: P): ReactNode;
  /** Fetch the code now, so the first render has it. */
  preload: () => Promise<void>;
}

export function loadable<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode = null): Loadable<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (component) => void (loaded = component),
      (error: unknown) => {
        pending = null; // the next use tries again
        throw error;
      },
    ));
  function View(props: P) {
    const [, arrived] = useState(false);
    useEffect(() => {
      let alive = true;
      if (!loaded) void preload().then(() => alive && arrived(true));
      return () => {
        alive = false;
      };
    }, []);
    const Component = loaded;
    return Component ? <Component {...props} /> : fallback;
  }
  return Object.assign(View, { preload });
}
