// Shows a shortcut such as "Ctrl+Alt+PrintScreen" the way the keys are printed on a keyboard of the language.

const KEYS: Record<string, Record<string, string>> = {
  de: { Ctrl: "Strg", Shift: "Umschalt", PrintScreen: "Druck", Delete: "Entf" },
  fr: { Shift: "Maj", PrintScreen: "Impr. écran", Delete: "Suppr" },
  es: { Shift: "Mayús", PrintScreen: "ImprPant", Delete: "Supr" },
  it: { Shift: "Maiusc", PrintScreen: "Stamp", Delete: "Canc" },
};

const RTL = ["ar", "ur", "fa", "he"];

/**
 * The shortcut for display. Key names that differ in the language are translated; in right-to-left languages the
 * shortcut is wrapped in a left-to-right isolate so that "Ctrl+0" is not reordered next to Arabic or Urdu text.
 */
export function hotkeyLabel(hotkey: string, locale: string): string {
  const base = locale.split("-")[0];
  const names = KEYS[base] ?? {};
  const text = hotkey
    .split("+")
    .map((k) => names[k] ?? k)
    .join("+");
  return RTL.includes(base) ? `⁦${text}⁩` : text;
}
