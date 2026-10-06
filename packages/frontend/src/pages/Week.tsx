import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  removeRule,
  removeWeekday,
  replaceRule,
  type PlannedItem,
  type ScheduleRule,
  type Weekday,
} from '@podcast/shared';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Icon } from '../components/Icon';
import { PlanItemRow, PlanList } from '../components/PlanItem';
import { ScheduleRuleSheet } from '../components/ScheduleRuleSheet';
import { Empty, ErrorBox, IconButton, Spinner } from '../components/ui';
import { useSaveSchedule } from '../lib/actions';
import { api } from '../lib/api';
import { formatDayMonth, formatDuration, formatRule, formatWeekdays, weekdayLong, weekdayShort } from '../lib/format';
import { cx } from '../lib/cx';
import { qk } from '../lib/queries';
import styles from './Week.module.css';
import { Sheet } from '../components/Sheet';

export function WeekPage() {
  const { t } = useTranslation('plan');
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
    else {
      void save(
        (current) => removeRule(current, rule.id),
        t('toast.dayRemoved', { show: item.show.name, day: weekdayLong(weekday) }),
      );
    }
  }

  const weekOpenMs = (week.data?.days ?? []).reduce((sum, d) => sum + d.openMs, 0);

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>{t('week.title')}</h1>
          <p className="muted">
            {slotCount
              ? t('week.slots', { count: slotCount }) +
                (weekOpenMs > 0 ? ` · ${t('week.open', { open: formatDuration(weekOpenMs) })}` : '')
              : t('week.intro')}
          </p>
          <SpotifyAttribution on="page" />
        </div>
        {rules.length > 0 && (
          <button
            type="button"
            className={`btn btn-small${editing ? ' btn-primary' : ''}`}
            onClick={() => setEditing((e) => !e)}
          >
            <Icon name={editing ? 'check' : 'note'} size={16} />{' '}
            {editing ? t('ui.done', { ns: 'common' }) : t('ui.edit', { ns: 'common' })}
          </button>
        )}
      </header>

      {(week.isLoading || schedule.isLoading) && <Spinner />}
      {week.error && <ErrorBox error={week.error} onRetry={() => void week.refetch()} />}
      {!week.error && schedule.error && <ErrorBox error={schedule.error} onRetry={() => void schedule.refetch()} />}

      {schedule.data && rules.length === 0 && (
        <Empty title={t('week.emptyTitle')}>
          <p>{t('week.emptyText')}</p>
          <button className="btn btn-primary" onClick={() => setAdding([1, 2, 3, 4, 5])}>
            <Icon name="plus" size={18} /> {t('week.firstSlot')}
          </button>
        </Empty>
      )}

      {week.data && rules.length > 0 && (
        <div className={styles.week}>
          {week.data.days.map((day) => (
            <section key={day.date} className={cx('card', styles.day, day.isToday && styles.isToday)}>
              <div className={styles.dayHead}>
                <h2 className="h3">
                  {day.isToday ? t('week.today') : weekdayLong(day.weekday)}
                  <span className="muted small">
                    {' '}
                    · {day.isToday ? weekdayShort(day.weekday) + ', ' : ''}
                    {formatDayMonth(day.date)}
                  </span>
                </h2>
                {day.openMs > 0 && <span className="muted small">{formatDuration(day.openMs)}</span>}
                {editing && (
                  <IconButton
                    icon="plus"
                    label={t('week.addOn', { day: weekdayLong(day.weekday) })}
                    onClick={() => setAdding([day.weekday])}
                  />
                )}
              </div>
              {day.items.length === 0 ? (
                <p className={cx('muted small', styles.dayEmpty)}>{t('week.nothingPlanned')}</p>
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
            <Icon name="plus" size={18} /> {t('week.addSlot')}
          </button>
          <p className="muted small">{t('week.footnote')}</p>
        </div>
      )}

      {adding && (
        <ScheduleRuleSheet
          initialDays={adding}
          onClose={() => setAdding(null)}
          onSave={(rule, showName) => {
            setAdding(null);
            void save((current) => [...current, rule], t('toast.planned', { show: showName }));
          }}
        />
      )}
      {editingRule && (
        <ScheduleRuleSheet
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSave={(rule, showName) => {
            setEditingRule(null);
            void save((current) => replaceRule(current, rule), `${showName}: ${formatRule(rule)}`);
          }}
          onDelete={() => {
            setEditingRule(null);
            void save((current) => removeRule(current, editingRule.id), t('toast.ruleRemoved'));
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
              (current) => removeWeekday(current, removing.rule.id, removing.weekday),
              t('toast.dayRemoved', { show: removing.item.show.name, day: weekdayLong(removing.weekday) }),
            );
          }}
          onRemoveRule={() => {
            setRemoving(null);
            void save(
              (current) => removeRule(current, removing.rule.id),
              t('toast.showRuleRemoved', { show: removing.item.show.name }),
            );
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
  const { t } = useTranslation('plan');
  return (
    <Sheet title={t('remove.title')} onClose={onClose}>
      <p>{t('remove.text', { show: item.show.name, rule: formatRule(rule) })}</p>
      <button className="btn btn-block" onClick={onRemoveDay}>
        {t('remove.onlyDay', { day: weekdayLong(weekday) })}
      </button>
      <button className="btn btn-danger btn-block" onClick={onRemoveRule}>
        {t('remove.wholeRule', { days: formatWeekdays(rule.weekdays) })}
      </button>
    </Sheet>
  );
}
