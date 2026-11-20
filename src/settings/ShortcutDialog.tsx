import { Button, Dialog } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { hotkeyLabel } from "../components/hotkeyLabel";
import { useT } from "../i18n";
import { ipc, type ShortcutCheck } from "../ipc";
import { defaultSettings } from "./defaults";
import { buildShortcut, keyName, KEY_UP_ONLY, type Pressed } from "./shortcutKeys";

/** A shortcut drawn as keys: Ctrl + Alt + PrintScreen. */
export function Kbd({ keys }: { keys: string }) {
  const { locale } = useT();
  return (
    <span className="kbds" dir="ltr">
      {hotkeyLabel(keys, locale)
        .replace(/[⁦⁩]/g, "")
        .split("+")
        .map((k, i) => (
          <kbd key={`${k}${i}`}>{k.trim()}</kbd>
        ))}
    </span>
  );
}

/** Records a new shortcut from the keyboard and checks it with the backend (valid, used by Windows or other programs). */
export function ShortcutDialog(props: {
  current: string;
  /** The shortcut that resets to (the default of this shortcut). */
  fallback?: string;
  /** The other shortcut of Snipmunk: the same keys cannot be used for both. */
  other?: string;
  onSave: (shortcut: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [pressed, setPressed] = useState<Pressed | null>(null);
  const [check, setCheck] = useState<ShortcutCheck | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [text, setText] = useState<string | null>(null);

  const candidate = pressed ? buildShortcut(pressed) : text;

  useEffect(() => {
    if (!candidate) {
      setCheck(null);
      return;
    }
    let stale = false;
    void ipc.checkShortcut(candidate).then((c) => !stale && setCheck(c));
    return () => {
      stale = true;
    };
  }, [candidate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") return;
      // Print Screen only reports a key-up to a page; every other key is read on key-down.
      const wanted = e.type === "keyup" ? KEY_UP_ONLY.includes(e.code) : true;
      if (!wanted) return;
      e.preventDefault();
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const next = { code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey };
      setUnsupported(keyName(next) === null);
      setText(null);
      setPressed(next);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, []);

  const [otherCanonical, setOtherCanonical] = useState<string | null>(null);
  useEffect(() => {
    if (!props.other) return;
    void ipc.checkShortcut(props.other).then((c) => setOtherCanonical(c.canonical ?? null));
  }, [props.other]);
  const conflict = !!check?.canonical && check.canonical === otherCanonical;
  const usable = !!candidate && !!check?.valid && !!check.canonical && !conflict;
  const useDefault = () => {
    setPressed(null);
    setUnsupported(false);
    setText(props.fallback ?? defaultSettings.captureHotkey);
  };

  return (
    <Dialog
      open
      title={t("shortcuts.title")}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={useDefault}>
            {t("shortcuts.reset")}
          </Button>
          <Button onClick={props.onClose}>{t("session.cancel")}</Button>
          <Button variant="primary" disabled={!usable} onClick={() => check?.canonical && props.onSave(check.canonical)}>
            {t("shortcuts.save")}
          </Button>
        </>
      }
    >
      <p>{t("shortcuts.press")}</p>
      <div className="shortcut-capture" aria-live="polite">
        <Kbd keys={candidate ?? props.current} />
      </div>
      <p className="shortcut-hint">{t("shortcuts.hint")}</p>
      {check?.error && <p className="shortcut-warn">{check.error}</p>}
      {unsupported && <p className="shortcut-warn">{t("shortcuts.unsupportedKey")}</p>}
      {conflict && <p className="shortcut-warn">{t("shortcuts.conflict")}</p>}
      {check?.warning === "windows" && <p className="shortcut-warn">{t("shortcuts.warn.windows")}</p>}
      {check?.warning === "shared" && <p className="shortcut-warn">{t("shortcuts.warn.shared")}</p>}
    </Dialog>
  );
}
