import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { itemForKey } from './focus';

const MENU_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * A popover menu next to the button that opens it. Spread `rootProps` on the
 * element holding both and `triggerProps` on the button. When it opens, the
 * first menu item gets the focus; the arrow keys, Home and End move between
 * the items. A click outside closes it, and so does Escape, which puts the
 * focus back on the button and doesn't reach a sheet around it.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
    const onDoc = (e: MouseEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const items = [...(rootRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? [])];
      const active = items.find((item) => item === document.activeElement) ?? null;
      const next = itemForKey(items, active, e.key);
      if (!next) return;
      e.preventDefault();
      next.focus();
    },
    [open],
  );

  return {
    open,
    close: useCallback(() => setOpen(false), []),
    rootProps: { ref: rootRef, onKeyDown },
    triggerProps: {
      ref: triggerRef,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      onClick: () => setOpen((o) => !o),
    },
  };
}
