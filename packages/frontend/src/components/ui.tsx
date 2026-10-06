import { useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { EpisodeStatus } from '@podcast/shared';
import { itemForKey } from '../lib/focus';
import { statusLabel } from '../lib/format';
import { usePopover } from '../lib/use-popover';
import { Icon, type IconName } from './Icon';

export function Cover({ src, alt, size = 56 }: { src?: string; alt: string; size?: number }) {
  return src ? (
    <img className="cover" src={src} alt={alt} width={size} height={size} loading="lazy" />
  ) : (
    <div className="cover cover-empty" style={{ width: size, height: size }} aria-hidden>
      {alt.slice(0, 1)}
    </div>
  );
}

export type BadgeTone = 'new' | 'continue' | 'next' | 'pinned' | 'done' | 'skipped' | 'muted' | 'warn';

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<EpisodeStatus, BadgeTone> = {
  UNSEEN: 'muted',
  IN_PROGRESS: 'continue',
  COMPLETED: 'done',
  SKIPPED: 'skipped',
};

export function StatusBadge({ status, isNew }: { status: EpisodeStatus; isNew?: boolean }) {
  const { t } = useTranslation();
  if (isNew && status === 'UNSEEN') return <Badge tone="new">{t('ui.new')}</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{statusLabel(status)}</Badge>;
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  variant = 'ghost',
  size = 20,
  className = '',
  ...popup
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  variant?: 'ghost' | 'primary' | 'soft';
  size?: number;
  className?: string;
  /** For a button that opens a popover (see usePopover). */
  ref?: Ref<HTMLButtonElement>;
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
}) {
  return (
    <button
      {...popup}
      type="button"
      className={`icon-btn icon-btn-${variant}${active ? ' is-active' : ''} ${className}`.trim()}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  href?: string;
  hidden?: boolean;
}

/** Small popover menu ("⋯"). */
export function Menu({ items }: { items: MenuItem[] }) {
  const { t } = useTranslation();
  const { open, close, rootProps, triggerProps } = usePopover();
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the keys are handled for the menu items inside
    <div className="menu" {...rootProps}>
      <IconButton icon="more" label={t('ui.moreActions')} active={open} {...triggerProps} />
      {open && (
        <div className="menu-pop" role="menu">
          {items
            .filter((i) => !i.hidden)
            .map((item) =>
              item.href ? (
                <a
                  key={item.label}
                  role="menuitem"
                  className="menu-item"
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                >
                  {item.icon && <Icon name={item.icon} size={18} />}
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                >
                  {item.icon && <Icon name={item.icon} size={18} />}
                  {item.label}
                </button>
              ),
            )}
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chosen = options.findIndex((o) => o.value === value);
  // Roving tabindex: Tab reaches the chosen option, the arrow keys choose another one.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = itemForKey(options, options[chosen] ?? null, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[options.indexOf(next)]?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label} ref={ref}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === Math.max(0, chosen) ? 0 : -1}
          onKeyDown={onKeyDown}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
    </label>
  );
}

export function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button type="button" className={`chip${active ? ' is-active' : ''}`} onClick={onClick} aria-pressed={active}>
      {children}
      {count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Spinner() {
  const { t } = useTranslation();
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      <span>{t('ui.loading')}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="banner banner-error" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          {t('ui.retry')}
        </button>
      )}
    </div>
  );
}
