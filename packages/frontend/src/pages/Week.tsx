import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { removeRule, removeWeekday, replaceRule, type PlannedItem, type ScheduleRule, type Weekday } from '@podcast/shared';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Icon } from '../components/Icon';
import { PlanItemRow, PlanList } from '../components/PlanItem';
import { ScheduleRuleSheet } from '../components/ScheduleRuleSheet';
import { Empty, ErrorBox, IconButton, Spinner } from '../components/ui';
import { useSaveSchedule } from '../lib/actions';
import { api } from '../lib/api';
import { dayPartLabel, formatDayMonth, formatDuration, formatWeekdays, weekdayLong, weekdayShort } from '../lib/format';
import { cx } from '../lib/cx';
import { qk } from '../lib/queries';
import styles from './Week.module.css';

export function WeekPage() {
  const week = useQuery({ queryKey: qk.week, queryFn: api.week });
  const schedule = useQuery({ queryKey: qk.schedule, queryFn: api.schedule });
  const save = useSaveSchedule();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<Weekday[] | null>(null);
  const [editingRule, setEditingRule] = useState<ScheduleRule | null>(null);
  const [removing, setRemoving] = useState<{ rule: ScheduleRule; item: PlannedItem; weekday: Weekday } | null>(null);
  const [open, setOpen] = useState<{ showId: string; episodeId: string } | null>(null);

  const rules = schedule.data?.rules ?? [];
  const slotCount = rules.reduce((n, r) => n + r.weekdays.length, 0);

  const ruleOf = (item: PlannedItem) => rules.find((r) => r.id === item.ruleId) ?? null;

  /** A rule with one day goes at once; otherwise the user picks the day or the whole rule. */
  function remove(item: PlannedItem, weekday: Weekday) {
    const rule = ruleOf(item);
    if (!rule) return;
    if (rule.weekdays.length > 1) setRemoving({ rule, item, weekday });
    else void save(removeRule(rules, rule.id), `${item.show.name} am ${weekdayLong(weekday)} entfernt`);
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
        <div className={styles.week}>
          {week.data.days.map((day) => (
            <section key={day.date} className={cx('card', styles.day, day.isToday && styles.isToday)}>
              <div className={styles.dayHead}>
                <h2 className="h3">
                  {day.isToday ? 'Heute' : weekdayLong(day.weekday)}
                  <span className="muted small"> · {day.isToday ? weekdayShort(day.weekday) + ', ' : ''}{formatDayMonth(day.date)}</span>
                </h2>
                {day.openMs > 0 && <span className="muted small">{formatDuration(day.openMs)}</span>}
                {editing && (
                  <IconButton icon="plus" label={`Termin am ${weekdayLong(day.weekday)} hinzufügen`} onClick={() => setAdding([day.weekday])} />
                )}
              </div>
              {day.items.length === 0 ? (
                <p className={cx('muted small', styles.dayEmpty)}>Nichts geplant</p>
              ) : (
                <PlanList>
                  {day.items.map((item) => (
                    <PlanItemRow
                      key={item.ruleId}
                      item={item}
                      isToday={day.isToday}
                      onOpen={(showId, episodeId) => setOpen({ showId, episodeId })}
                      onEdit={editing ? () => setEditingRule(ruleOf(item)) : undefined}
                      onRemove={editing ? () => remove(item, day.weekday) : undefined}
                    />
                  ))}
                </PlanList>
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
        <ScheduleRuleSheet
          initialDays={adding}
          onClose={() => setAdding(null)}
          onSave={(rule, showName) => {
            setAdding(null);
            void save([...rules, rule], `${showName} eingeplant`);
          }}
        />
      )}
      {editingRule && (
        <ScheduleRuleSheet
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSave={(rule, showName) => {
            setEditingRule(null);
            void save(
              replaceRule(rules, rule),
              `${showName}: ${formatWeekdays(rule.weekdays)} · ${dayPartLabel(rule.part)}`,
            );
          }}
          onDelete={() => {
            setEditingRule(null);
            void save(removeRule(rules, editingRule.id), 'Regel entfernt');
          }}
        />
      )}
      {removing && (
        <RemoveSlotSheet
          {...removing}
          onClose={() => setRemoving(null)}
          onRemoveDay={() => {
            setRemoving(null);
            void save(
              removeWeekday(rules, removing.rule.id, removing.weekday),
              `${removing.item.show.name} am ${weekdayLong(removing.weekday)} entfernt`,
            );
          }}
          onRemoveRule={() => {
            setRemoving(null);
            void save(removeRule(rules, removing.rule.id), `${removing.item.show.name}: Regel entfernt`);
          }}
        />
      )}
      {open && <EpisodeSheet {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RemoveSlotSheet({
  rule,
  item,
  weekday,
  onClose,
  onRemoveDay,
  onRemoveRule,
}: {
  rule: ScheduleRule;
  item: PlannedItem;
  weekday: Weekday;
  onClose: () => void;
  onRemoveDay: () => void;
  onRemoveRule: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Termin entfernen" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Termin entfernen</h2>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>
        <p>
          {item.show.name} ist für {formatWeekdays(rule.weekdays)} · {dayPartLabel(rule.part)} geplant.
        </p>
        <button className="btn btn-block" onClick={onRemoveDay}>
          Nur am {weekdayLong(weekday)}
        </button>
        <button className="btn btn-danger btn-block" onClick={onRemoveRule}>
          Ganze Regel ({formatWeekdays(rule.weekdays)})
        </button>
      </div>
    </div>
  );
}
