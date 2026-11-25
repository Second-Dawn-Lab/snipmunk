import { useState } from "react";
import { AppIcon } from "../components/AppIcons";
import { MenuItem } from "../components/MenuItem";
import { Pop } from "../components/Pop";
import { useT } from "../i18n";

/** The area new steps are recorded with: as before, or chosen again (another day, another monitor). */
export const MORE_AREAS = ["same", "active", "screen", "window", "region"] as const;
export type MoreArea = (typeof MORE_AREAS)[number];

/** "Record more steps" (the area as before) with a menu to choose the area again. */
export function RecordMore(props: { onRecord: (area: MoreArea) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Pop
      open={open}
      onClose={() => setOpen(false)}
      kind="menu"
      label={t("guide.recordMore.menu")}
      align="end"
      trigger={
        <span className="gsplit">
          <button type="button" className="gsplit__main" onClick={() => props.onRecord("same")}>
            {t("guide.recordMore")}
          </button>
          <button type="button" className="gsplit__more" aria-haspopup="menu" aria-expanded={open} aria-label={t("guide.recordMore.menu")} title={t("guide.recordMore.menu")} onClick={() => setOpen((o) => !o)}>
            <AppIcon name="chevron" size={13} />
          </button>
        </span>
      }
    >
      <div className="menuitem__heading">{t("guide.recordMore.menu")}</div>
      {MORE_AREAS.map((a) => (
        <MenuItem
          key={a}
          role="menuitemradio"
          checked={a === "same"}
          label={a === "same" ? t("guide.recordMore.same") : t(`guide.area.${a}`)}
          onSelect={() => (setOpen(false), props.onRecord(a))}
        />
      ))}
    </Pop>
  );
}
