import { Icon } from "@seconddawn/ui";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type { Group } from "../ipc";

/** The tabs of the groups, with "+" to add one. Double-click a tab to rename it. */
export function GroupTabs(props: {
  groups: Group[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (group: Group) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const canDelete = props.groups.length > 1;

  return (
    <div className="grouptabs" role="tablist" aria-label={t("groups.label")}>
      {props.groups.map((g) =>
        editing === g.id ? (
          <RenameInput
            key={g.id}
            initial={g.name}
            label={t("groups.rename")}
            onDone={(name) => {
              setEditing(null);
              if (name && name !== g.name) props.onRename(g.id, name);
            }}
          />
        ) : (
          <div
            key={g.id}
            role="tab"
            aria-selected={g.id === props.activeId}
            tabIndex={0}
            className={g.id === props.activeId ? "grouptab grouptab--active" : "grouptab"}
            title={t("groups.rename")}
            onClick={() => props.onSelect(g.id)}
            onDoubleClick={() => setEditing(g.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") props.onSelect(g.id);
              if (e.key === "F2") setEditing(g.id);
            }}
          >
            <span className="grouptab__name">{g.name}</span>
            {canDelete && (
              <button
                type="button"
                className="grouptab__close"
                aria-label={t("groups.delete")}
                title={t("groups.delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete(g);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        ),
      )}
      <button
        type="button"
        className="grouptab grouptab--add"
        aria-label={t("groups.add")}
        title={t("groups.add")}
        onClick={props.onAdd}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

/** A text box that selects its content, commits on Enter or blur and cancels on Escape. */
export function RenameInput(props: {
  initial: string;
  label: string;
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(props.initial);
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    props.onDone(commit ? value.trim() : null);
  };

  return (
    <input
      ref={ref}
      className={props.className ?? "grouptab grouptab--input"}
      aria-label={props.label}
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}
