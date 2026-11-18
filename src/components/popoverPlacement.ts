// Where a popover opens so that it stays inside its window. This follows Owl-L's dropdown placement model
// (dropdownPlacement.ts there): shift sideways to fit, open upwards when there is more room above, and shrink the
// scrolling area when neither side has enough room. On top of that it knows the writing direction: "start" and
// "end" are the leading and trailing edge of the trigger, so they swap in right-to-left layouts.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopoverInput {
  /** The trigger, in viewport coordinates. */
  trigger: Box;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Which edge of the trigger the popover lines up with. */
  align: "start" | "end" | "center";
  rtl: boolean;
  /** Space kept free at the window edges. */
  margin?: number;
  /** Space between the trigger and the popover. */
  gap?: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  /** Opens above the trigger. */
  flipUp: boolean;
  /** The popover scrolls when it is taller than this. */
  maxHeight: number;
  maxWidth: number;
}

/** A popover never gets shorter than about two rows, so it stays usable. */
export const MIN_HEIGHT = 80;

export function placePopover(input: PopoverInput): PopoverPlacement {
  const { trigger, panel, viewport, align, rtl, margin = 8, gap = 6 } = input;
  const maxWidth = Math.max(120, viewport.width - 2 * margin);
  const width = Math.min(panel.width, maxWidth);

  // Line up with the leading (start) or trailing (end) edge of the trigger.
  const startsAtLeft = align === "start" ? !rtl : align === "end" ? rtl : false;
  let ideal: number;
  if (align === "center") ideal = (trigger.left + trigger.right) / 2 - width / 2;
  else if (startsAtLeft) ideal = trigger.left;
  else ideal = trigger.right - width;
  const left = Math.min(Math.max(ideal, margin), Math.max(margin, viewport.width - margin - width));

  const below = viewport.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const flipUp = panel.height > below && above > below;
  const room = Math.max(MIN_HEIGHT, flipUp ? above : below);
  const height = Math.min(panel.height, room);
  const top = flipUp ? trigger.top - gap - height : trigger.bottom + gap;

  return { left, top, flipUp, maxHeight: room, maxWidth };
}
