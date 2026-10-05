import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DAY_PARTS, type DayPart, type ScheduleRule, type Weekday } from '@podcast/shared';
import { api } from '../lib/api';
import { dayPartLabel, formatWeekdays, weekdayShort } from '../lib/format';
import { qk } from '../lib/queries';
import { Chip, Cover, IconButton, Segmented, Spinner } from './ui';

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

const PRESETS: { label: string; days: Weekday[] }[] = [
  { label: 'Werktags', days: [1, 2, 3, 4, 5] },
  { label: 'Wochenende', days: [6, 7] },
  { label: 'Täglich', days: ALL_DAYS },
];

/**
 * Adds or edits one rule of the weekly plan: a podcast, its weekdays and the
 * part of day. With `rule`, the podcast is fixed and a change applies to every
 * weekday of that rule. With `showId`, a new rule is created for that podcast;
 * otherwise the podcast is picked here. `onSave` gets the rule with an empty
 * id when it is new (the server assigns one).
 */
export function ScheduleRuleSheet({
  rule,
  showId: fixedShowId,
  initialDays = [],
  onClose,
  onSave,
  onDelete,
}: {
  rule?: ScheduleRule;
  showId?: string;
  initialDays?: Weekday[];
  onClose: () => void;
  onSave: (rule: ScheduleRule, showName: string) => void;
  onDelete?: () => void;
}) {
  const shows = useQuery({ queryKey: qk.shows, queryFn: api.shows });
  const fixed = rule?.showId ?? fixedShowId;
  const [showId, setShowId] = useState<string | null>(fixed ?? null);
  const [days, setDays] = useState<Weekday[]>(rule?.weekdays ?? initialDays);
  const [part, setPart] = useState<DayPart>(rule?.part ?? 'ANYTIME');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (shows.data ?? []).filter((s) => s.followed && (!q || s.name.toLowerCase().includes(q)));
  }, [shows.data, query]);
  const chosen = shows.data?.find((s) => s.id === showId);
  const title = rule ? 'Termin bearbeiten' : 'Termin hinzufügen';

  const toggle = (d: Weekday) =>
    setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort((a, b) => a - b)));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>{title}</h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        <div className="stack-sm">
          <strong className="small">Podcast</strong>
          {chosen ? (
            <div className="row gap">
              <Cover src={chosen.imageUrl} alt={chosen.name} size={40} />
              <strong className="grow">{chosen.name}</strong>
              {!fixed && (
                <button className="btn btn-small" onClick={() => setShowId(null)}>
                  Ändern
                </button>
              )}
            </div>
          ) : fixed ? (
            <Spinner />
          ) : (
            <>
              <input type="search" placeholder="Podcast suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
              {shows.isLoading && <Spinner />}
              <ul className="pick-list">
                {list.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="pick" onClick={() => setShowId(s.id)}>
                      <Cover src={s.imageUrl} alt={s.name} size={36} />
                      <span>{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="stack-sm">
          <strong className="small">Tage</strong>
          <div className="chips">
            {ALL_DAYS.map((d) => (
              <Chip key={d} active={days.includes(d)} onClick={() => toggle(d)}>
                {weekdayShort(d)}
              </Chip>
            ))}
          </div>
          <div className="chips">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn btn-small" onClick={() => setDays(p.days)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="stack-sm">
          <strong className="small">Tageszeit</strong>
          <Segmented
            label="Tageszeit"
            value={part}
            onChange={setPart}
            options={DAY_PARTS.map((p) => ({ value: p, label: dayPartLabel(p) }))}
          />
        </div>

        <p className="muted small">
          {days.length ? `Gilt für ${formatWeekdays(days)} · ${dayPartLabel(part)}` : 'Wähle mindestens einen Tag.'}
        </p>

        <button
          className="btn btn-primary btn-block"
          disabled={!chosen || days.length === 0}
          onClick={() => chosen && onSave({ id: rule?.id ?? '', showId: chosen.id, weekdays: days, part }, chosen.name)}
        >
          {!chosen ? 'Podcast wählen' : rule ? 'Speichern' : `${chosen.name} einplanen`}
        </button>
        {onDelete && (
          <button className="btn btn-block" onClick={onDelete}>
            Ganze Regel entfernen
          </button>
        )}
      </div>
    </div>
  );
}
