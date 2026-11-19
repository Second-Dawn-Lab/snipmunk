// How the Text tool reacts to clicks, keys and tool changes (no React): one small state machine, so the editor only runs the
// effects it returns.
//
// - Text tool, click on empty canvas: a new box with a cursor. A press elsewhere finishes it and the tool goes back to Select;
//   another text needs the Text tool again.
// - Click on an existing text: it is selected; letting go without dragging edits it (cursor where clicked); dragging moves it.
// - Esc, Ctrl+Enter, another tool or a click elsewhere finish the box; an empty box is removed.

export type TextState =
  | { kind: "idle" }
  /** Typing in the box `id` (`isNew`: it was made by this edit and is removed when it stays empty). */
  | { kind: "editing"; id: string; isNew: boolean }
  /** The pointer is down on an existing text: a drag moves it, letting go edits it. */
  | { kind: "pressed"; id: string; after: TextState };

export type TextEvent =
  /** A pointer press with the Text tool; `hit` is the text under the pointer, `inEditBox` a press inside the box being typed in. */
  | { type: "down"; hit: string | null; inEditBox: boolean }
  | { type: "up"; moved: boolean }
  | { type: "key"; key: "Escape" | "CtrlEnter" }
  | { type: "toolChanged" }
  | { type: "selectedElsewhere" };

export type TextEffect =
  | { type: "finish" }
  | { type: "create" }
  | { type: "select"; id: string }
  | { type: "edit"; id: string; caret: "click" | "end" }
  | { type: "native" };

export interface TextStep {
  state: TextState;
  effects: TextEffect[];
}

const idle: TextState = { kind: "idle" };

export function textStep(state: TextState, ev: TextEvent): TextStep {
  switch (ev.type) {
    case "down": {
      if (state.kind === "editing" && ev.inEditBox) return { state, effects: [{ type: "native" }] };
      // One box per activation: a press elsewhere only finishes the box (the tool goes back to Select).
      if (state.kind === "editing") return { state: idle, effects: [{ type: "finish" }] };
      const finish: TextEffect[] = [];
      if (ev.hit) {
        // Pressing the box that is being typed in (by its border) is a press on a text like any other.
        return { state: { kind: "pressed", id: ev.hit, after: idle }, effects: [...finish, { type: "select", id: ev.hit }] };
      }
      return { state: { kind: "editing", id: "", isNew: true }, effects: [...finish, { type: "create" }] };
    }
    case "up": {
      if (state.kind !== "pressed") return { state, effects: [] };
      if (ev.moved) return { state: state.after, effects: [] };
      return { state: { kind: "editing", id: state.id, isNew: false }, effects: [{ type: "edit", id: state.id, caret: "click" }] };
    }
    case "key":
      return state.kind === "editing" ? { state: idle, effects: [{ type: "finish" }] } : { state, effects: [] };
    case "toolChanged":
    case "selectedElsewhere":
      return state.kind === "editing" ? { state: idle, effects: [{ type: "finish" }] } : { state: idle, effects: [] };
  }
}

/** The id of the box a `create` effect made is known only to the editor; this puts it into the state. */
export function created(state: TextState, id: string): TextState {
  return state.kind === "editing" && state.id === "" ? { kind: "editing", id, isNew: true } : state;
}
