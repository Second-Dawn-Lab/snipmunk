import { Button, EmptyState, Icon, Select } from "@seconddawn/ui";
import { useState } from "react";
import { useT } from "../i18n";
import { thumbUrl, type Capture, type Session } from "../ipc";
import { formatTime, type SortMode } from "../sessionModel";
import { RenameInput } from "./GroupTabs";
import { hotkeyLabel } from "./hotkeyLabel";

/** "Captures (n)", the sort order, select all / clear all and the cards. */
export function CaptureList(props: {
  session: Session;
  captures: Capture[];
  activeId: string | null;
  selected: ReadonlySet<string>;
  sort: SortMode;
  hotkey: string;
  onSort: (mode: SortMode) => void;
  onActivate: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const { t, locale } = useT();
  const [renaming, setRenaming] = useState<string | null>(null);
  // The trash icon of a selected card deletes the whole selection; on any other card, just that card.
  const trashLabel = (id: string, name: string) =>
    props.selected.has(id)
      ? t("captures.deleteSelected", { count: props.selected.size })
      : t("captures.delete", { name });

  return (
    <section className="capturelist" aria-label={t("captures.title", { count: props.captures.length })}>
      <div className="capturelist__head">
        <h2 className="capturelist__title">{t("captures.title", { count: props.captures.length })}</h2>
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
      </div>
      <div className="capturelist__bulk">
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
        <ul className="capturelist__items">
          {props.captures.map((c) => {
            const checked = props.selected.has(c.id);
            return (
              <li
                key={c.id}
                className={
                  "card" + (c.id === props.activeId ? " card--active" : "") + (checked ? " card--checked" : "")
                }
                onClick={() => props.onActivate(c.id)}
              >
                <img
                  className="card__thumb"
                  src={thumbUrl(props.session, c)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
                <div className="card__text">
                  {renaming === c.id ? (
                    <RenameInput
                      className="card__rename"
                      initial={c.name}
                      label={t("captures.rename")}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name && name !== c.name) props.onRename(c.id, name);
                      }}
                    />
                  ) : (
                    <div
                      className="card__name"
                      title={c.name}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenaming(c.id);
                      }}
                    >
                      {c.name}
                    </div>
                  )}
                  <div className="card__time">{formatTime(c.createdAt, locale)}</div>
                </div>
                <input
                  type="checkbox"
                  className="card__check"
                  checked={checked}
                  aria-label={t("captures.select", { name: c.name })}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => props.onToggle(c.id)}
                />
                <button
                  type="button"
                  className="card__trash"
                  aria-label={trashLabel(c.id, c.name)}
                  title={trashLabel(c.id, c.name)}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(c.id);
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
