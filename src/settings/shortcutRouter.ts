// The capture shortcut inside Snipmunk's own windows. The keyboard hook of the backend sees keys in other programs, but
// while the main or settings window has the focus WebView2 takes the key first. So the page matches the shortcut too
// and reports it (`shortcut_fired`); the backend runs each key press once, whichever of the two saw it first.
// Same idea as Owl-L's shortcutRouter.

import { KEY_UP_ONLY, keyName } from "./shortcutKeys";

export interface Parsed {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  win: boolean;
  /** As `keyName` spells it: "A", "5", "F8", "Space", "PrintScreen". */
  key: string;
}

/** Other spellings the backend accepts (the setting can be written by hand). */
const ALIASES: Record<string, string> = {
  PRTSCN: "PrintScreen",
  PRTSC: "PrintScreen",
  PRINT: "PrintScreen",
  PRINTSCR: "PrintScreen",
  PRINTSCREEN: "PrintScreen",
  SNAPSHOT: "PrintScreen",
  INS: "Insert",
  DEL: "Delete",
  PGUP: "PageUp",
  PGDN: "PageDown",
};
const NAMED = ["Space", "Pause", "Insert", "Delete", "Home", "End", "PageUp", "PageDown"];

/** "Ctrl+Alt+PrintScreen". Null for anything that is not a modifier plus a supported key. */
export function parseShortcut(text: string): Parsed | null {
  const parts = text.split("+").map((p) => p.trim());
  const raw = parts.pop();
  if (!raw || parts.length === 0) return null;
  const upper = raw.toUpperCase();
  const named = NAMED.find((n) => n.toUpperCase() === upper);
  let key: string | undefined = ALIASES[upper] ?? named;
  if (!key && /^[A-Z0-9]$/.test(upper)) key = upper;
  if (!key && /^F([1-9]|1[0-2])$/.test(upper)) key = upper;
  if (!key) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if ([...mods].some((m) => !["ctrl", "alt", "shift", "win"].includes(m)) || mods.size !== parts.length) return null;
  return { ctrl: mods.has("ctrl"), alt: mods.has("alt"), shift: mods.has("shift"), win: mods.has("win"), key };
}

/** The parts of a keyboard event the router reads. */
export interface KeyLike {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** AltGr (Ctrl+Alt on many keyboard layouts) types characters; with a letter or digit it is never a shortcut. */
  altGraph?: boolean;
}

/** Everyday editing keys: Ctrl plus one of these in a text box is editing, not a shortcut. */
const EDITING_KEYS = new Set(["C", "V", "X", "A", "Z", "Y"]);

export class ShortcutRouter {
  private parsed: Parsed | null;
  /** The key-up-only key (PrintScreen) was seen going down since it last went up. */
  private downSeen = false;

  constructor(shortcut: string | null) {
    this.parsed = shortcut ? parseShortcut(shortcut) : null;
  }

  /**
   * Feed one key event. `editable`: the focus is in a text box. True when the shortcut fired: the page then stops the
   * web view from using the key and reports it to the backend.
   *
   * Print Screen only sends a key-up to a web page on Windows (some setups send both), so for such keys the key-up
   * counts, unless its key-down was seen already.
   */
  onKey(e: KeyLike, type: "keydown" | "keyup", editable: boolean): boolean {
    const p = this.parsed;
    if (!p) return false;
    if (keyName(e) !== p.key) return false;
    const upOnly = KEY_UP_ONLY.includes(p.key);
    if (type === "keyup") {
      const seenDown = this.downSeen;
      if (upOnly) this.downSeen = false;
      if (!upOnly || seenDown) return false;
    } else {
      if (e.repeat) return false;
      if (upOnly) this.downSeen = true;
    }
    if (!(p.ctrl === e.ctrlKey && p.alt === e.altKey && p.shift === e.shiftKey && p.win === e.metaKey)) return false;
    if (e.altGraph && /^[A-Z0-9]$/.test(p.key)) return false;
    if (editable) {
      // Shift alone types a capital letter and Ctrl+V and friends edit: those stay with the text box.
      if (!p.ctrl && !p.alt && !p.win) return false;
      if (p.ctrl && !p.alt && !p.shift && !p.win && EDITING_KEYS.has(p.key)) return false;
    }
    return true;
  }
}

/** Is the focus in a place where typed keys edit text? */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes((el as HTMLInputElement).type);
}
