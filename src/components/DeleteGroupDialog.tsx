import { Button, Dialog, Select } from "@seconddawn/ui";
import { useEffect, useState } from "react";
import { defaultMoveTarget, moveTargets, type DeleteChoice } from "../groupRules";
import { useT } from "../i18n";
import type { Group } from "../ipc";

/** Asked when a group that has captures is deleted: move them to another group, or delete them with it. */
export function DeleteGroupDialog(props: {
  group: Group | null;
  groups: Group[];
  onCancel: () => void;
  onConfirm: (group: Group, choice: DeleteChoice) => void;
}) {
  const { t } = useT();
  const { group } = props;
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [target, setTarget] = useState<string>("");

  // Each time the dialog opens: move the captures to the neighbouring tab.
  useEffect(() => {
    if (!group) return;
    setMode("move");
    setTarget(defaultMoveTarget(props.groups, group.id) ?? "");
  }, [group, props.groups]);

  const targets = group ? moveTargets(props.groups, group.id) : [];
  const choice: DeleteChoice = mode === "move" && target ? { mode: "move", targetId: target } : { mode: "delete" };

  return (
    <Dialog
      open={group !== null}
      title={t("groups.deleteTitle")}
      onClose={props.onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={props.onCancel}>
            {t("session.cancel")}
          </Button>
          <Button variant="danger" onClick={() => group && props.onConfirm(group, choice)}>
            {t("groups.deleteConfirm")}
          </Button>
        </>
      }
    >
      {group && (
        <div className="deletegroup">
          <p>{t("groups.deleteHas", { name: group.name, count: group.captures.length })}</p>
          <label className="deletegroup__option">
            <input type="radio" name="delete-group-mode" checked={mode === "move"} onChange={() => setMode("move")} />
            <span>{t("groups.optMove")}</span>
            <Select
              label={t("groups.moveTarget")}
              value={target}
              disabled={mode !== "move"}
              onChange={setTarget}
              options={targets.map((g) => ({ value: g.id, label: `${g.emoji ? `${g.emoji} ` : ""}${g.name}` }))}
            />
          </label>
          <label className="deletegroup__option">
            <input type="radio" name="delete-group-mode" checked={mode === "delete"} onChange={() => setMode("delete")} />
            <span>{t("groups.optDelete")}</span>
          </label>
        </div>
      )}
    </Dialog>
  );
}
