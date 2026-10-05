import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { removeRule, replaceRule, type ScheduleRule } from '@podcast/shared';
import { Link } from 'react-router-dom';
import { useSaveSchedule } from '../lib/actions';
import { cx } from '../lib/cx';
import { api } from '../lib/api';
import { DAY_PART_LABEL, formatWeekdays } from '../lib/format';
import { qk } from '../lib/queries';
import { Icon } from './Icon';
import { ScheduleRuleSheet } from './ScheduleRuleSheet';
import styles from './ShowSchedule.module.css';
import { IconButton, Spinner } from './ui';

/** A podcast's rules in the weekly plan, editable with the same sheet as on Woche. */
export function ShowSchedule({ showId, showName }: { showId: string; showName: string }) {
  const schedule = useQuery({ queryKey: qk.schedule, queryFn: api.schedule });
  const save = useSaveSchedule();
  const [editing, setEditing] = useState<ScheduleRule | 'new' | null>(null);

  const rules = schedule.data?.rules ?? [];
  const own = rules.filter((r) => r.showId === showId);
  const label = (r: ScheduleRule) => `${formatWeekdays(r.weekdays)} · ${DAY_PART_LABEL[r.part]}`;

  return (
    <section className="card settings-card">
      <div className="row-between">
        <h2 className="h3">Wochenplan</h2>
        <button className="btn btn-small" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> Termin
        </button>
      </div>
      {schedule.isLoading ? (
        <Spinner />
      ) : own.length === 0 ? (
        <p className="muted small">Nicht im Wochenplan.</p>
      ) : (
        <ul className={styles.rules}>
          {own.map((r) => (
            <li key={r.id}>
              <Icon name="calendar" size={18} />
              <span className={cx('grow', styles.rule)}>{label(r)}</span>
              <IconButton icon="note" label={`${label(r)} bearbeiten`} onClick={() => setEditing(r)} />
              <IconButton
                icon="close"
                label={`${label(r)} entfernen`}
                onClick={() => void save(removeRule(rules, r.id), `${showName}: ${label(r)} entfernt`)}
              />
            </li>
          ))}
        </ul>
      )}
      <Link to="/woche" className="small">
        Zum Wochenplan
      </Link>

      {editing && (
        <ScheduleRuleSheet
          rule={editing === 'new' ? undefined : editing}
          showId={showId}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            setEditing(null);
            void save(
              editing === 'new' ? [...rules, rule] : replaceRule(rules, rule),
              `${showName}: ${label(rule)}`,
            );
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  setEditing(null);
                  void save(removeRule(rules, editing.id), `${showName}: ${label(editing)} entfernt`);
                }
          }
        />
      )}
    </section>
  );
}
