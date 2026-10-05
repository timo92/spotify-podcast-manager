import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DAY_PARTS, type DayPart, type ScheduleRule, type Show, type Weekday } from '@podcast/shared';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Icon } from '../components/Icon';
import { PlanItemRow } from '../components/PlanItem';
import { Chip, Cover, Empty, ErrorBox, IconButton, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { DAY_PART_LABEL, formatDayMonth, formatDuration, WEEKDAY_LONG, WEEKDAY_SHORT } from '../lib/format';
import { qk, useInvalidateLibrary } from '../lib/queries';
import { useToast } from '../lib/toast';

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function WeekPage() {
  const week = useQuery({ queryKey: qk.week, queryFn: api.week });
  const schedule = useQuery({ queryKey: qk.schedule, queryFn: api.schedule });
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<Weekday[] | null>(null);
  const [open, setOpen] = useState<{ showId: string; episodeId: string } | null>(null);

  const rules = schedule.data?.rules ?? [];
  const slotCount = rules.reduce((n, r) => n + r.weekdays.length, 0);

  async function save(next: ScheduleRule[], message: string) {
    try {
      const saved = await api.saveSchedule({ rules: next });
      qc.setQueryData(qk.schedule, saved);
      await invalidate();
      toast({ message, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  const weekMinutes = (week.data?.days ?? []).reduce((sum, d) => sum + d.openMs, 0);

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>Wochenplan</h1>
          <p className="muted">
            {slotCount
              ? `${slotCount} feste ${slotCount === 1 ? 'Termin' : 'Termine'} pro Woche · ${formatDuration(weekMinutes)} offen in den nächsten 7 Tagen`
              : 'Lege fest, an welchen Tagen du welchen Podcast hörst.'}
          </p>
          <SpotifyAttribution on="page" />
        </div>
        {rules.length > 0 && (
          <button type="button" className={`btn btn-small${editing ? ' btn-primary' : ''}`} onClick={() => setEditing((e) => !e)}>
            <Icon name={editing ? 'check' : 'note'} size={16} /> {editing ? 'Fertig' : 'Bearbeiten'}
          </button>
        )}
      </header>

      {(week.isLoading || schedule.isLoading) && <Spinner />}
      {week.error && <ErrorBox error={week.error} onRetry={() => void week.refetch()} />}

      {schedule.data && rules.length === 0 && (
        <Empty title="Noch kein Plan">
          <p>
            Zum Beispiel: werktags morgens die Nachrichten, dienstags und donnerstags abends eine Folge deiner
            Geschichtsreihe. Die passende Folge sucht die App jeweils automatisch aus.
          </p>
          <button className="btn btn-primary" onClick={() => setAdding([1, 2, 3, 4, 5])}>
            <Icon name="plus" size={18} /> Ersten Termin anlegen
          </button>
        </Empty>
      )}

      {week.data && rules.length > 0 && (
        <div className="week">
          {week.data.days.map((day) => (
            <section key={day.date} className={`card day-card${day.isToday ? ' is-today' : ''}`}>
              <div className="day-head">
                <h2 className="h3">
                  {day.isToday ? 'Heute' : WEEKDAY_LONG[day.weekday]}
                  <span className="muted small"> · {day.isToday ? WEEKDAY_SHORT[day.weekday] + ', ' : ''}{formatDayMonth(day.date)}</span>
                </h2>
                {day.openMs > 0 && <span className="muted small">{formatDuration(day.openMs)}</span>}
                {editing && (
                  <IconButton icon="plus" label={`Termin am ${WEEKDAY_LONG[day.weekday]} hinzufügen`} onClick={() => setAdding([day.weekday])} />
                )}
              </div>
              {day.items.length === 0 ? (
                <p className="muted small day-empty">Nichts geplant</p>
              ) : (
                <ul className="plan-list">
                  {day.items.map((item) => (
                    <PlanItemRow
                      key={item.ruleId}
                      item={item}
                      isToday={day.isToday}
                      onOpen={(showId, episodeId) => setOpen({ showId, episodeId })}
                      onRemove={
                        editing
                          ? () =>
                              void save(
                                withoutDay(rules, item.ruleId, day.weekday),
                                `${item.show.name} am ${WEEKDAY_LONG[day.weekday]} entfernt`,
                              )
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
          <button className="btn btn-block" onClick={() => setAdding([])}>
            <Icon name="plus" size={18} /> Termin hinzufügen
          </button>
          <p className="muted small">
            Termine wiederholen sich jede Woche. Bei Reihen wird pro Termin die jeweils nächste Folge eingeplant; was du
            heute schon gehört hast, wird abgehakt.
          </p>
        </div>
      )}

      {adding && (
        <AddToPlanSheet
          initialDays={adding}
          onClose={() => setAdding(null)}
          onSave={(showId, days, part, showName) => {
            // The server assigns ids to new rules.
            setAdding(null);
            void save([...rules, { id: '', showId, weekdays: days, part }], `${showName} eingeplant`);
          }}
        />
      )}
      {open && <EpisodeSheet {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Removes one weekday from a rule, and the rule once it has no weekday left. */
function withoutDay(rules: ScheduleRule[], ruleId: string, weekday: Weekday): ScheduleRule[] {
  return rules
    .map((r) => (r.id === ruleId ? { ...r, weekdays: r.weekdays.filter((d) => d !== weekday) } : r))
    .filter((r) => r.weekdays.length > 0);
}

const PRESETS: { label: string; days: Weekday[] }[] = [
  { label: 'Werktags', days: [1, 2, 3, 4, 5] },
  { label: 'Wochenende', days: [6, 7] },
  { label: 'Täglich', days: ALL_DAYS },
];

function AddToPlanSheet({
  initialDays,
  onClose,
  onSave,
}: {
  initialDays: Weekday[];
  onClose: () => void;
  onSave: (showId: string, days: Weekday[], part: DayPart, showName: string) => void;
}) {
  const shows = useQuery({ queryKey: qk.shows, queryFn: api.shows });
  const [showId, setShowId] = useState<string | null>(null);
  const [days, setDays] = useState<Weekday[]>(initialDays);
  const [part, setPart] = useState<DayPart>('ANYTIME');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (shows.data ?? []).filter((s: Show) => s.followed && (!q || s.name.toLowerCase().includes(q)));
  }, [shows.data, query]);
  const chosen = shows.data?.find((s) => s.id === showId);

  const toggle = (d: Weekday) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Termin hinzufügen" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Termin hinzufügen</h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>

        <div className="stack-sm">
          <strong className="small">Podcast</strong>
          {chosen ? (
            <div className="row gap">
              <Cover src={chosen.imageUrl} alt={chosen.name} size={40} />
              <strong className="grow">{chosen.name}</strong>
              <button className="btn btn-small" onClick={() => setShowId(null)}>
                Ändern
              </button>
            </div>
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
                {WEEKDAY_SHORT[d]}
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
            options={DAY_PARTS.map((p) => ({ value: p, label: DAY_PART_LABEL[p] }))}
          />
        </div>

        <button
          className="btn btn-primary btn-block"
          disabled={!chosen || days.length === 0}
          onClick={() => chosen && onSave(chosen.id, days, part, chosen.name)}
        >
          {chosen && days.length
            ? `${chosen.name} an ${days.length === 7 ? 'jedem Tag' : days.map((d) => WEEKDAY_SHORT[d]).join(', ')} einplanen`
            : 'Podcast und Tage wählen'}
        </button>
      </div>
    </div>
  );
}
