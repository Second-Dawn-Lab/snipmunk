// Turning a key press into the text of a shortcut ("Ctrl+Alt+PrintScreen"). The set of keys matches the backend's
// (dawn-hotkeys): letters, digits, F1 to F12, Space, PrintScreen and a few navigation keys.

const NAMED: Record<string, string> = {
  Space: "Space",
  PrintScreen: "PrintScreen",
  Pause: "Pause",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/** The key part of a shortcut for a key event's `code`, or null when the key cannot be part of a shortcut. */
export function keyName(e: { code: string }): string | null {
  const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code) ?? /^(F(?:[1-9]|1[0-2]))$/.exec(e.code);
  if (m) return m[1];
  return NAMED[e.code] ?? null;
}

export interface Pressed {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** "Ctrl+Alt+PrintScreen". Null without a modifier or with an unsupported key. */
export function buildShortcut(e: Pressed): string | null {
  const key = keyName(e);
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean);
  if (!key || mods.length === 0) return null;
  return `${mods.join("+")}+${key}`;
}

/** Print Screen only sends a key-up event to a web page, so the recorder listens to it as well. */
export const KEY_UP_ONLY = ["PrintScreen"];
