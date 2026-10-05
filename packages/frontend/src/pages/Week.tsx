import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlannedItem, ScheduleRule, Weekday } from '@podcast/shared';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Icon } from '../components/Icon';
import { PlanItemRow } from '../components/PlanItem';
import { ScheduleRuleSheet } from '../components/ScheduleRuleSheet';
import { Empty, ErrorBox, IconButton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { DAY_PART_LABEL, formatDayMonth, formatDuration, formatWeekdays, WEEKDAY_LONG, WEEKDAY_SHORT } from '../lib/format';
import { qk, useInvalidateLibrary } from '../lib/queries';
import { useToast } from '../lib/toast';

export function WeekPage() {
  const week = useQuery({ queryKey: qk.week, queryFn: api.week });
  const schedule = useQuery({ queryKey: qk.schedule, queryFn: api.schedule });
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<Weekday[] | null>(null);
  const [editingRule, setEditingRule] = useState<ScheduleRule | null>(null);
  const [removing, setRemoving] = useState<{ rule: ScheduleRule; item: PlannedItem; weekday: Weekday } | null>(null);
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

  const ruleOf = (item: PlannedItem) => rules.find((r) => r.id === item.ruleId) ?? null;

  /** A rule with one day goes at once; otherwise the user picks the day or the whole rule. */
  function remove(item: PlannedItem, weekday: Weekday) {
    const rule = ruleOf(item);
    if (!rule) return;
    if (rule.weekdays.length > 1) setRemoving({ rule, item, weekday });
    else void save(withoutRule(rules, rule.id), `${item.show.name} am ${WEEKDAY_LONG[weekday]} entfernt`);
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
                      onEdit={editing ? () => setEditingRule(ruleOf(item)) : undefined}
                      onRemove={editing ? () => remove(item, day.weekday) : undefined}
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
              rules.map((r) => (r.id === rule.id ? rule : r)),
              `${showName}: ${formatWeekdays(rule.weekdays)} · ${DAY_PART_LABEL[rule.part]}`,
            );
          }}
          onDelete={() => {
            setEditingRule(null);
            void save(withoutRule(rules, editingRule.id), 'Regel entfernt');
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
              withoutDay(rules, removing.rule.id, removing.weekday),
              `${removing.item.show.name} am ${WEEKDAY_LONG[removing.weekday]} entfernt`,
            );
          }}
          onRemoveRule={() => {
            setRemoving(null);
            void save(withoutRule(rules, removing.rule.id), `${removing.item.show.name}: Regel entfernt`);
          }}
        />
      )}
      {open && <EpisodeSheet {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Removes the whole rule, i.e. all of its slots. */
function withoutRule(rules: ScheduleRule[], ruleId: string): ScheduleRule[] {
  return rules.filter((r) => r.id !== ruleId);
}

/** Removes one weekday from a rule, and the rule once it has no weekday left. */
function withoutDay(rules: ScheduleRule[], ruleId: string, weekday: Weekday): ScheduleRule[] {
  return rules
    .map((r) => (r.id === ruleId ? { ...r, weekdays: r.weekdays.filter((d) => d !== weekday) } : r))
    .filter((r) => r.weekdays.length > 0);
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
          {item.show.name} ist für {formatWeekdays(rule.weekdays)} · {DAY_PART_LABEL[rule.part]} geplant.
        </p>
        <button className="btn btn-block" onClick={onRemoveDay}>
          Nur am {WEEKDAY_LONG[weekday]}
        </button>
        <button className="btn btn-danger btn-block" onClick={onRemoveRule}>
          Ganze Regel ({formatWeekdays(rule.weekdays)})
        </button>
      </div>
    </div>
  );
}
