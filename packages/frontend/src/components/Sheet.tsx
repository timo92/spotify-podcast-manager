import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './ui';

/**
 * A bottom sheet: a modal dialog over a backdrop. Escape closes it, and so
 * does a click on the backdrop. With a `title`, the sheet shows it as its
 * heading next to a close button; otherwise its content provides its own close
 * action for touch and keyboard users, and `label` names the dialog.
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a backdrop click is a mouse shortcut; Escape closes the sheet from the keyboard
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
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
