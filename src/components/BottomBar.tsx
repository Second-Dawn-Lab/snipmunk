import { Select } from "@seconddawn/ui";
import { useT } from "../i18n";
import type { CopyMode } from "../settings/defaults";
import { AppIcon } from "./AppIcons";

/** "n selected", the copy mode, Save and Copy. With nothing selected Copy reads "Copy all (n)" and copies the whole group. */
export function BottomBar(props: {
  selectedCount: number;
  /** A capture is shown in the preview (Copy and Save use it when nothing is selected). */
  hasCapture: boolean;
  copyMode: CopyMode;
  onCopyMode: (mode: CopyMode) => void;
  onCopy: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  const none = props.selectedCount === 0;
  // Nothing selected: Copy and Save take the capture shown in the preview. Select all makes them take everything.
  const label = none ? t("bottom.copy") : t("bottom.copyN", { count: props.selectedCount });
  const empty = none && !props.hasCapture;
  return (
    <footer className="bottombar">
      <span className="bottombar__count" aria-live="polite">
        {t("bottom.selected", { count: props.selectedCount })}
      </span>
      <span className="bottombar__spacer" />
      <Select
        label={t("bottom.copyMode")}
        value={props.copyMode}
        onChange={props.onCopyMode}
        options={[
          { value: "separate", label: t("copyMode.separate") },
          { value: "stack", label: t("copyMode.stack") },
          { value: "grid", label: t("copyMode.grid") },
        ]}
      />
      <button type="button" className="dw-btn" disabled={empty || props.busy} title={t("bottom.saveTip")} onClick={props.onSave}>
        <AppIcon name="save" size={16} />
        {t("bottom.save")}
      </button>
      <button type="button" className="dw-btn dw-btn--primary" disabled={empty || props.busy} title={t("bottom.copyTip")} onClick={props.onCopy}>
        <AppIcon name="copy" size={16} />
        {label}
      </button>
    </footer>
  );
}
