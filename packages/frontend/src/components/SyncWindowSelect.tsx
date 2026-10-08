import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SyncWindowSelect.module.css';

/** Common windows in days; 0 stands for all episodes. */
const PRESETS = [0, 7, 14, 30, 90, 365];

/**
 * How far back a podcast's episodes are synced (0 = all), chosen from common
 * windows. A window set elsewhere (e.g. through the API) is offered as well.
 */
export function SyncWindowSelect({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (days: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = `${id}-hint`;
  const options = PRESETS.includes(value) ? PRESETS : [...PRESETS, value].sort((a, b) => a - b);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((days) => (
          <option key={days} value={days}>
            {days === 0 ? t('syncWindow.all') : t('syncWindow.days', { count: days })}
          </option>
        ))}
      </select>
      {hint && (
        <small id={hintId} className="muted">
          {hint}
        </small>
      )}
    </div>
  );
}
