// While the main window stays minimized or in the tray, the page drops what it can load again from disk.

/** How long the window is out of sight before the caches go: a short look at another window costs nothing. */
export const DROP_AFTER_MS = 20_000;

/** Run `drop` once the window has been out of sight for `delay`. Returns what to call with every change of visibility. */
export function dropWhenAway(drop: () => void, delay: number = DROP_AFTER_MS): { seen: (visible: boolean) => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    seen: (visible) => {
      if (visible) stop();
      else if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          drop();
        }, delay);
      }
    },
    stop,
  };
}
