import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EpisodeStatus } from '@podcast/shared';
import { STATUS_LABEL } from '../lib/format';
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
  if (isNew && status === 'UNSEEN') return <Badge tone="new">Neu</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  variant = 'ghost',
  size = 20,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  variant?: 'ghost' | 'primary' | 'soft';
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-${variant}${active ? ' is-active' : ''}`}
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
  danger?: boolean;
  hidden?: boolean;
}

/** Small popover menu ("⋯"). */
export function Menu({ items, label = 'Weitere Aktionen' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <IconButton icon="more" label={label} onClick={() => setOpen((o) => !o)} active={open} />
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
                  onClick={() => setOpen(false)}
                >
                  {item.icon && <Icon name={item.icon} size={18} />}
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  className={`menu-item${item.danger ? ' is-danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
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
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
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
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
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

export function Spinner({ label = 'Lädt…' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="banner banner-error" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}
