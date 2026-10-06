import { useEffect, type ReactNode } from 'react';

/**
 * A bottom sheet: a modal dialog over a backdrop. Escape closes it, and so
 * does a click on the backdrop; the sheet's content provides its own close
 * action for touch and keyboard users.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a backdrop click is a mouse shortcut; Escape closes the sheet from the keyboard
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
