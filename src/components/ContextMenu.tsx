import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MenuItem } from "./MenuItem";
import { SubmenuItem } from "./SubmenuItem";
import type { AppIconName } from "./AppIcons";
import { placePopover, type PopoverPlacement } from "./popoverPlacement";

export type MenuEntry =
  | {
      kind: "item";
      id: string;
      label: string;
      icon?: AppIconName;
      danger?: boolean;
      /** Looks disabled and cannot be used; `tip` says why. */
      disabled?: boolean;
      tip?: string;
      onSelect: () => void;
    }
  | {
      /** An entry that opens a list (or a grid) of choices under it. */
      kind: "sub";
      id: string;
      label: string;
      icon?: AppIconName;
      children: ReactNode;
    }
  | { kind: "separator"; id: string };

/**
 * A right-click menu at a point of the window. It stays inside the window (and opens to the left of the pointer in a
 * right-to-left layout), moves with the arrow keys, closes with Esc, a click outside, the mouse wheel or a resize.
 * Entries with `kind: "sub"` unfold under themselves, so they work with the keyboard too.
 */
export function ContextMenu(props: {
  x: number;
  y: number;
  label: string;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  const { x, y, onClose } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlacement | null>(null);

  const reposition = () => {
    const p = panel.current;
    if (!p) return;
    p.style.maxHeight = "none";
    setPlace(
      placePopover({
        trigger: { left: x, top: y, right: x, bottom: y },
        panel: { width: p.offsetWidth, height: p.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align: "start",
        rtl: document.documentElement.dir === "rtl",
        gap: 0,
      }),
    );
  };
  useLayoutEffect(() => {
    reposition();
    const p = panel.current;
    const observer = p ? new ResizeObserver(reposition) : null;
    if (p) observer?.observe(p);
    return () => observer?.disconnect();
  }, [x, y]);

  // The latest onClose, so the listeners below are set up once (a new function on every render must not move the focus).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    (first ?? panel.current)?.focus();
    const close = () => closeRef.current();
    const onDown = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close();
    };
    // Esc closes the menu wherever the focus is.
    const onEsc = (e: KeyboardEvent) => {
      // An open flyout takes the first Esc (see SubmenuItem).
      if (e.key !== "Escape" || panel.current?.querySelector("[data-flyout]")) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onEsc, true);
    window.addEventListener("wheel", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(
      panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [data-menu-focus]') ?? [],
    ).filter((el) => el.getAttribute("aria-disabled") !== "true" && !el.closest("[data-flyout]"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={panel}
      className={`ctxmenu${place ? "" : " ctxmenu--measuring"}`}
      role="menu"
      aria-label={props.label}
      tabIndex={-1}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight, maxWidth: place.maxWidth } : undefined}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.entries.map((entry) => {
        if (entry.kind === "separator") return <hr key={entry.id} className="ctxmenu__sep" />;
        if (entry.kind === "sub") {
          return (
            <SubmenuItem key={entry.id} label={entry.label} icon={entry.icon}>
              {entry.children}
            </SubmenuItem>
          );
        }
        return (
          <MenuItem
            key={entry.id}
            label={entry.label}
            icon={entry.icon}
            danger={entry.danger}
            disabled={entry.disabled && entry.tip === undefined}
            soon={entry.disabled ? entry.tip : undefined}
            onSelect={() => {
              onClose();
              entry.onSelect();
            }}
          />
        );
      })}
    </div>
  );
}
