import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { useT } from "../i18n";
import { isTauri } from "../ipc";
import { AppIcon } from "./AppIcons";
import { withClose, type FileEntry } from "./fileEntries";
import { hotkeyLabel } from "./hotkeyLabel";
import { MenuItem } from "./MenuItem";
import { Pop } from "./Pop";

/** The File menu of the top bar: one icon button in every mode, with the entries of the mode on show. */
export function FileMenu(props: { entries: readonly FileEntry[] }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  // "Close Snipmunk" does what the window's close button does (keep running, quit or ask, as the settings say).
  const closeWindow = () => void (isTauri && getCurrentWindow().close());
  return (
    <Pop
      open={open}
      onClose={() => setOpen(false)}
      kind="menu"
      label={t("proj.file")}
      trigger={
        <button type="button" className="dw-iconbtn filemenu" aria-haspopup="menu" aria-expanded={open} aria-label={t("proj.file")} title={t("proj.file")} onClick={() => setOpen((o) => !o)}>
          <AppIcon name="hamburger" size={18} />
        </button>
      }
    >
      {withClose(t, props.entries, closeWindow).map((e) =>
        e.kind === "separator" ? (
          <hr key={e.id} className="ctxmenu__sep" />
        ) : e.kind === "heading" ? (
          <div key={e.id} className="menuitem__heading">
            {e.label}
          </div>
        ) : (
          <MenuItem
            key={e.id}
            label={e.label}
            hint={e.hint ? hotkeyLabel(e.hint, locale) : undefined}
            disabled={e.disabled}
            danger={e.danger}
            onSelect={() => {
              setOpen(false);
              e.run();
            }}
          />
        ),
      )}
    </Pop>
  );
}
