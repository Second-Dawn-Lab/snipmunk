// The heavy views are loaded when they are first shown: Documents mode (the paged canvas and its text editor) and the
// video player. Each is unmounted when its mode is left, so its memory can be freed.
import { createElement } from "react";
import { loadable } from "./loadable";

export const DocumentsMode = loadable(
  () => import("./docs/DocumentsMode").then((m) => m.DocumentsMode),
  createElement("main", { className: "panels panels--single" }),
);
export const RecordingView = loadable(() => import("./components/RecordingView").then((m) => m.RecordingView));

/** Load the view of the mode a window starts in before it is first painted, so it is there with the first frame. */
export async function preloadMode(captureKind: string): Promise<void> {
  if (captureKind === "documents") await DocumentsMode.preload();
}
