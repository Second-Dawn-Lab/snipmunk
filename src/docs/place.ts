// Keeping the view still when the height of something above or at the clicked place changes (no React).

/**
 * The scroll position and the added room above the guide after something moved by `moved` pixels (down: positive), so that it is
 * back where it was. Above the very top there is nothing to scroll to: room is added there instead, and used up again later.
 */
export function placeAfterChange(moved: number, scroll: number, spacer: number): { scroll: number; spacer: number } {
  let delta = moved;
  let room = spacer;
  if (delta > 0 && room > 0) {
    const used = Math.min(room, delta);
    room -= used;
    delta -= used;
  }
  const target = scroll + delta;
  return target < 0 ? { scroll: 0, spacer: room - target } : { scroll: target, spacer: room };
}
