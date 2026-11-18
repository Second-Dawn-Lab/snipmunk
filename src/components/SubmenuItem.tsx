import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AppIconName } from "./AppIcons";
import { MenuItem } from "./MenuItem";
import { inSafeTriangle, insideRect, OPEN_DELAY, placeFlyout, submenuKey, type FlyoutPlacement, type Point } from "./submenu";

const FOCUSABLE = '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"]),[data-menu-focus]';

/**
 * A menu entry with a flyout beside it, like the submenus of Windows menus: it opens when the pointer rests on the entry
 * for a moment, on a click, and with → (← in right-to-left layouts); ← (→ in RTL) or Esc closes it and the focus goes back
 * to the entry. Moving the pointer diagonally towards the open flyout, across the entries in between, does not close it.
 * Works inside the card/tab context menus and inside popover menus.
 */
export function SubmenuItem(props: { label: string; icon?: AppIconName; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<FlyoutPlacement | null>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const lastInParent = useRef<Point | null>(null);
  const rtl = () => document.documentElement.dir === "rtl";

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  useEffect(() => clearTimers, []);

  const focusParent = () => wrap.current?.querySelector<HTMLElement>("button")?.focus();
  const focusFirst = () =>
    requestAnimationFrame(() => fly.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());

  const close = useCallback((refocus: boolean) => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setOpen(false);
    if (refocus) focusParent();
  }, []);

  // Place the flyout before it is painted, and again when its content changes size.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const w = wrap.current;
      const f = fly.current;
      if (!w || !f) return;
      f.style.maxHeight = "none";
      const r = w.getBoundingClientRect();
      setPlace(
        placeFlyout({
          parent: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          panel: { width: f.offsetWidth, height: f.scrollHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          rtl: rtl(),
        }),
      );
    };
    measure();
    const f = fly.current;
    const observer = f ? new ResizeObserver(measure) : null;
    if (f) observer?.observe(f);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // While open: keep it open over the entry, the flyout and the safe triangle; close it a moment after the pointer leaves.
  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const w = wrap.current;
      const f = fly.current;
      if (!w || !f) return;
      const p = { x: e.clientX, y: e.clientY };
      const wr = w.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      const parentRect = { left: wr.left, top: wr.top, right: wr.right, bottom: wr.bottom };
      const flyRect = { left: fr.left, top: fr.top, right: fr.right, bottom: fr.bottom };
      if (insideRect(parentRect, p)) lastInParent.current = p;
      const inside = insideRect(parentRect, p) || insideRect(flyRect, p);
      const side = fr.left >= wr.left + wr.width / 2 ? "right" : "left";
      const safe = !inside && lastInParent.current !== null && inSafeTriangle(lastInParent.current, p, flyRect, side);
      if (inside || safe) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      } else if (closeTimer.current === undefined) {
        closeTimer.current = window.setTimeout(() => close(false), OPEN_DELAY);
      }
    };
    // Esc closes only the flyout, also when the focus is still on the entry.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onEsc, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onEsc, true);
    };
  }, [open, close]);

  const onFlyoutKeyDown = (e: React.KeyboardEvent) => {
    const k = submenuKey(e.key, rtl());
    if (k === "close") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      const items = Array.from(fly.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const at = items.indexOf(document.activeElement as HTMLElement);
      const go = (to: number) => {
        e.preventDefault();
        items[(to + items.length) % items.length]?.focus();
      };
      if (e.key === "ArrowDown") go(at + 1);
      else if (e.key === "ArrowUp") go(at < 0 ? items.length - 1 : at - 1);
      else if (e.key === "Home") go(0);
      else go(items.length - 1);
      // The menu around must not also move.
      e.stopPropagation();
    }
  };

  const onParentKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== wrap.current?.querySelector("button")) return;
    const opens = submenuKey(e.key, rtl()) === "open" || e.key === "Enter" || e.key === " ";
    if (opens) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      focusFirst();
    }
  };

  return (
    <div
      ref={wrap}
      onPointerEnter={() => {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
        if (!open) {
          window.clearTimeout(openTimer.current);
          openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
        }
      }}
      onPointerLeave={() => window.clearTimeout(openTimer.current)}
      onKeyDown={onParentKeyDown}
    >
      <MenuItem
        label={props.label}
        icon={props.icon}
        expanded={open}
        onSelect={() => {
          window.clearTimeout(openTimer.current);
          setOpen(true);
        }}
      >
        <span className="menuitem__arrow ctxmenu__caret" aria-hidden="true">
          ▸
        </span>
      </MenuItem>
      {open && (
        <div
          ref={fly}
          data-flyout
          className={`ctxmenu ctxmenu--flyout${place ? "" : " ctxmenu--measuring"}`}
          role="menu"
          aria-label={props.label}
          style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight } : undefined}
          onKeyDown={onFlyoutKeyDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}
