import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { placePopover, type PopoverPlacement } from "./popoverPlacement";

const FOCUSABLE =
  '[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled),[role="menuitemcheckbox"]:not(:disabled),button:not(:disabled),input:not(:disabled),[tabindex="0"]';

/**
 * A trigger plus a floating panel. The panel is placed with `placePopover` (stays inside the window, flips up when
 * there is no room below, mirrors in right-to-left layouts). Esc and a click outside close it and the focus goes back
 * to the trigger; moving the focus out of it closes it too. Arrow keys move through a menu's items.
 */
export function Pop(props: {
  open: boolean;
  onClose: () => void;
  /** The element that opens the popover (a button, or a group of buttons). */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  /** "menu" lets the arrow keys move between items; "dialog" is for panels with sliders and swatches. */
  kind?: "menu" | "dialog";
  label: string;
  className?: string;
}) {
  const { open, onClose, align = "start", kind = "dialog" } = props;
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlacement | null>(null);
  const id = useId();

  const reposition = useCallback(() => {
    const w = wrap.current;
    const p = panel.current;
    if (!w || !p) return;
    const r = w.getBoundingClientRect();
    // Measure the natural size: no height limit while measuring.
    p.style.maxHeight = "none";
    setPlace(
      placePopover({
        trigger: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        panel: { width: p.offsetWidth, height: p.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
        rtl: document.documentElement.dir === "rtl",
      }),
    );
  }, [align]);

  // Place the panel before it is painted, and again when the window or the panel's content changes size.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    reposition();
    const p = panel.current;
    const observer = p ? new ResizeObserver(reposition) : null;
    if (p) observer?.observe(p);
    window.addEventListener("resize", reposition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  // Move the focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>('[data-autofocus],' + FOCUSABLE);
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  const closeAndRefocus = () => {
    onClose();
    wrap.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeAndRefocus();
      return;
    }
    if (kind === "menu" && panel.current?.contains(e.target as Node)) {
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const at = items.indexOf(document.activeElement as HTMLElement);
      const move = (to: number) => {
        e.preventDefault();
        items[(to + items.length) % items.length]?.focus();
      };
      if (e.key === "ArrowDown") move(at + 1);
      else if (e.key === "ArrowUp") move(at < 0 ? items.length - 1 : at - 1);
      else if (e.key === "Home") move(0);
      else if (e.key === "End") move(items.length - 1);
    } else if (kind === "menu" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // From the trigger: into the menu.
      const items = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items?.length) {
        e.preventDefault();
        items[e.key === "ArrowDown" ? 0 : items.length - 1].focus();
      }
    }
  };

  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (open && next && wrap.current && !wrap.current.contains(next)) onClose();
  };

  return (
    <span className="pop" ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
      {props.trigger}
      {open && (
        <div
          ref={panel}
          id={id}
          className={`pop__panel${place ? "" : " pop__panel--measuring"}${props.className ? ` ${props.className}` : ""}`}
          role={kind === "menu" ? "menu" : "dialog"}
          aria-label={props.label}
          style={
            place
              ? { left: place.left, top: place.top, maxHeight: place.maxHeight, maxWidth: place.maxWidth }
              : undefined
          }
        >
          {props.children}
        </div>
      )}
    </span>
  );
}
