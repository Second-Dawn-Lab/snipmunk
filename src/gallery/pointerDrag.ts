// Drags inside the window with pointer events.
//
// Tauri's native file drop (and a later native drag out into other apps, tauri-plugin-drag in Phase 6) takes the window's
// HTML5 drag and drop events over on Windows, so internal drags (reordering, moving to a group tab) never use them.
// A drag starts when the pointer has moved a few pixels after pressing, ends on release, and is cancelled by Esc, a
// lost pointer or the window losing focus. Phase 6 can start a native drag from `onMove` once the pointer leaves the
// window (`outside` is true) without changing anything here.
import { exceedsThreshold } from "./reorder";

export interface DragPoint {
  x: number;
  y: number;
  /** The pointer is outside the window (a native drag out would start here). */
  outside: boolean;
}

export interface PointerDragOptions {
  threshold?: number;
  /** The pointer moved far enough: the drag begins. */
  onStart: (p: DragPoint) => void;
  onMove: (p: DragPoint) => void;
  /** The drag is over. `completed` is false when it was cancelled. */
  onEnd: (p: DragPoint, completed: boolean) => void;
}

const point = (e: PointerEvent): DragPoint => ({
  x: e.clientX,
  y: e.clientY,
  outside: e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight,
});

/**
 * Follow the pointer from a press at (`x`, `y`). Returns a function that cancels the drag. Nothing is called for a press
 * that never moves far enough, so an ordinary click still works.
 */
export function beginPointerDrag(origin: { x: number; y: number }, options: PointerDragOptions): () => void {
  let started = false;
  let last: DragPoint = { x: origin.x, y: origin.y, outside: false };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    document.body.classList.remove("is-dragging");
  };

  const finish = (completed: boolean) => {
    cleanup();
    if (!started) return;
    // The click that follows the release of a drag is not a click on the card under the pointer.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    options.onEnd(last, completed);
  };

  function onMove(e: PointerEvent) {
    last = point(e);
    if (!started) {
      if (!exceedsThreshold(e.clientX - origin.x, e.clientY - origin.y, options.threshold)) return;
      started = true;
      document.body.classList.add("is-dragging");
      options.onStart(last);
    }
    options.onMove(last);
  }
  function onUp(e: PointerEvent) {
    last = point(e);
    finish(true);
  }
  function onCancel() {
    finish(false);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (started) {
      e.preventDefault();
      e.stopPropagation();
    }
    finish(false);
  }

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
  return () => finish(false);
}
