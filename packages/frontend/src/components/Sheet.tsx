import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { focusableIn } from '../lib/focus';
import { IconButton } from './ui';

/** The open sheets, the topmost last; only that one reacts to the keyboard. */
const openSheets: symbol[] = [];

/**
 * A bottom sheet: a modal dialog over a backdrop. It takes the focus when it
 * opens, keeps Tab inside and gives the focus back when it closes. Escape
 * closes it (only the topmost of stacked sheets), and so does a click on the
 * backdrop. With a `title`, the sheet shows it as its heading next to a close
 * button; otherwise its content provides its own close action for touch and
 * keyboard users, and `label` names the dialog.
 */
export function Sheet({
  title,
  label = title,
  onClose,
  children,
}: {
  title?: string;
  label?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = Symbol('sheet');
    openSheets.push(id);
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialog = ref.current;
      if (openSheets.at(-1) !== id || !dialog) return;
      if (e.key === 'Escape') onCloseRef.current();
      else if (e.key === 'Tab') keepTabInside(e, dialog);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets.splice(openSheets.indexOf(id), 1);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a backdrop click is a mouse shortcut; Escape closes the sheet from the keyboard
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        {title && (
          <div className="row-between">
            <h2>{title}</h2>
            <IconButton icon="close" label={t('ui.close')} onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Wraps Tab from the last control to the first (and Shift+Tab back), and pulls a focus that escaped back in. */
function keepTabInside(e: KeyboardEvent, dialog: HTMLElement) {
  const items = focusableIn(dialog);
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;
  let target: HTMLElement | undefined;
  if (!first || !last) target = dialog;
  else if (!(active instanceof Node) || !dialog.contains(active)) target = e.shiftKey ? last : first;
  else if (e.shiftKey && (active === first || active === dialog)) target = last;
  else if (!e.shiftKey && active === last) target = first;
  if (!target) return;
  e.preventDefault();
  target.focus();
}
