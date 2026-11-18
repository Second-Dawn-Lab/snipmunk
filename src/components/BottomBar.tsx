import { Icon, Select } from "@seconddawn/ui";
import { useT } from "../i18n";
import type { CopyMode } from "../settings/defaults";

/** "n selected", the copy mode and the Copy button (not working yet). */
export function BottomBar(props: {
  selectedCount: number;
  copyMode: CopyMode;
  onCopyMode: (mode: CopyMode) => void;
}) {
  const { t } = useT();
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
      <button
        type="button"
        className="dw-btn dw-btn--primary"
        aria-disabled="true"
        title={`${t("bottom.copyTip")} – ${t("soon.label")}`}
      >
        <Icon name="copy" size={16} />
        {t("bottom.copy")}
      </button>
    </footer>
  );
}
