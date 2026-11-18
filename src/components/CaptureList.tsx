import { Button, EmptyState, Select } from "@seconddawn/ui";
import { GALLERY_VIEWS, type GalleryView } from "../gallery/layout";
import { directionOf } from "../language";
import { useT } from "../i18n";
import type { Capture, Session } from "../ipc";
import type { SortMode } from "../sessionModel";
import { AppIcon, type AppIconName } from "./AppIcons";
import { Gallery, type GalleryActions } from "./Gallery";
import { hotkeyLabel } from "./hotkeyLabel";

const VIEW_ICON: Record<GalleryView, AppIconName> = {
  list: "viewList",
  medium: "viewMedium",
  large: "viewLarge",
};

/** "Captures (n)" with the view toggle, the sort order, select all / clear all and the gallery. */
export function CaptureList(props: {
  session: Session;
  groupId: string;
  captures: Capture[];
  view: GalleryView;
  activeId: string | null;
  selected: ReadonlySet<string>;
  renamingId: string | null;
  sort: SortMode;
  hotkey: string;
  actions: GalleryActions;
  onSort: (mode: SortMode) => void;
  onView: (view: GalleryView) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const { t, locale } = useT();
  const title = t("captures.title", { count: props.captures.length });
  const viewLabel = (v: GalleryView) => t(`view.${v}`);

  return (
    <section className="capturelist" aria-label={title}>
      <div className="capturelist__head">
        <h2 className="capturelist__title">{title}</h2>
        <div className="viewtoggle" role="radiogroup" aria-label={t("view.label")}>
          {GALLERY_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={props.view === v}
              className={"viewtoggle__btn" + (props.view === v ? " viewtoggle__btn--on" : "")}
              aria-label={viewLabel(v)}
              title={viewLabel(v)}
              onClick={() => props.onView(v)}
            >
              <AppIcon name={VIEW_ICON[v]} size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="capturelist__bulk">
        <Select
          label={t("captures.sort")}
          value={props.sort}
          onChange={props.onSort}
          options={[
            { value: "newest", label: t("captures.sortNewest") },
            { value: "oldest", label: t("captures.sortOldest") },
            { value: "custom", label: t("captures.sortCustom") },
          ]}
        />
        <Button variant="ghost" disabled={props.captures.length === 0} onClick={props.onSelectAll}>
          {t("captures.selectAll")}
        </Button>
        <Button variant="ghost" disabled={props.selected.size === 0} onClick={props.onClearAll}>
          {t("captures.clearAll")}
        </Button>
      </div>

      {props.captures.length === 0 ? (
        <EmptyState icon="scan" title={t("captures.emptyTitle")}>
          {t("captures.emptyBody", { hotkey: hotkeyLabel(props.hotkey, locale) })}
        </EmptyState>
      ) : (
        <Gallery
          key={props.groupId}
          session={props.session}
          groupId={props.groupId}
          captures={props.captures}
          view={props.view}
          activeId={props.activeId}
          selected={props.selected}
          renamingId={props.renamingId}
          actions={props.actions}
          label={title}
          rtl={directionOf(locale) === "rtl"}
        />
      )}
    </section>
  );
}
