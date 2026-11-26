import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DROP_AFTER_MS, dropWhenAway } from "./memory";

describe("dropping caches while the window is out of sight", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("drops them after a while away, once", () => {
    const drop = vi.fn();
    const watch = dropWhenAway(drop);
    watch.seen(false);
    vi.advanceTimersByTime(DROP_AFTER_MS - 1);
    expect(drop).not.toHaveBeenCalled();
    watch.seen(false); // minimized, then put into the tray: the time still counts from the first
    vi.advanceTimersByTime(1);
    expect(drop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DROP_AFTER_MS * 3);
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it("keeps them when the window comes back in time", () => {
    const drop = vi.fn();
    const watch = dropWhenAway(drop);
    watch.seen(false);
    vi.advanceTimersByTime(DROP_AFTER_MS / 2);
    watch.seen(true);
    vi.advanceTimersByTime(DROP_AFTER_MS);
    expect(drop).not.toHaveBeenCalled();
    watch.seen(false);
    watch.stop();
    vi.advanceTimersByTime(DROP_AFTER_MS);
    expect(drop).not.toHaveBeenCalled();
  });
});
