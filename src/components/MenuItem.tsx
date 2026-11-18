import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "./AppIcons";

/** One entry of a popover menu: icon, label, optional shortcut, check mark for radio and checkbox entries. */
export function MenuItem(props: {
  label: string;
  icon?: AppIconName;
  hint?: string;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  checked?: boolean;
  /** Looks and acts disabled but keeps its tooltip (a disabled button shows none in every browser). */
  soon?: string;
  disabled?: boolean;
  expanded?: boolean;
  /** A destructive entry (Delete). */
  danger?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
}) {
  const { role = "menuitem" } = props;
  const inert = props.disabled || props.soon !== undefined;
  return (
    <button
      type="button"
      role={role}
      className={props.danger ? "menuitem menuitem--danger" : "menuitem"}
      aria-checked={role === "menuitem" ? undefined : !!props.checked}
      aria-disabled={inert || undefined}
      aria-expanded={props.expanded}
      title={props.soon}
      onClick={() => !inert && props.onSelect?.()}
    >
      <span className="menuitem__check">{props.checked && <AppIcon name="check" size={15} />}</span>
      {props.icon && <AppIcon name={props.icon} size={16} />}
      <span className="menuitem__label">{props.label}</span>
      {props.hint && (
        <kbd className="menuitem__hint" dir="ltr">
          {props.hint}
        </kbd>
      )}
      {props.children}
    </button>
  );
}
