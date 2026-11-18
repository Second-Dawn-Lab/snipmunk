import { useEffect, useRef, useState } from "react";
import { isImportDrag, planDrop, type DropPlan } from "./fileTypes";

/** A drag of files (or web content) over the window. `target` is the group tab under the pointer, `null` for the list. */
export interface FileDragState {
  target: string | null;
}

/**
 * Files dragged into the window from Explorer or a browser. The window's own drop handling is used (the main window is
 * created with `dragDropEnabled: false`): unlike Tauri's native file drop it also hands over images dragged from
 * browsers, and it reports where the pointer is as a DOM element, so a group tab can be a drop target. Internal drags
 * (reordering, moving to a tab) use pointer events and never reach this.
 */
export function useFileDrop(onDrop: (plan: DropPlan<File>, target: string | null) => void): FileDragState | null {
  const [state, setState] = useState<FileDragState | null>(null);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    const wants = (e: DragEvent) => !!e.dataTransfer && isImportDrag(Array.from(e.dataTransfer.types));
    const tabOf = (e: DragEvent) =>
      (e.target as Element | null)?.closest?.("[data-tab-id]")?.getAttribute("data-tab-id") ?? null;

    const over = (e: DragEvent) => {
      if (!wants(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      const target = tabOf(e);
      setState((s) => (s && s.target === target ? s : { target }));
    };
    const leave = (e: DragEvent) => {
      // Leaving the window: no element is entered.
      if (e.relatedTarget === null) setState(null);
    };
    const drop = (e: DragEvent) => {
      if (!wants(e)) return;
      e.preventDefault();
      setState(null);
      const dt = e.dataTransfer;
      if (!dt) return;
      // Read everything now: the data is gone once the event has been handled.
      const files = Array.from(dt.files);
      const plan = planDrop({ files, uriList: dt.getData("text/uri-list"), html: dt.getData("text/html") });
      handler.current(plan, tabOf(e));
    };
    const end = () => setState(null);

    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", over);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", end);
    };
  }, []);

  return state;
}
