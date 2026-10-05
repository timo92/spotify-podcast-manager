import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { removeRule, replaceRule, type ScheduleRule } from '@podcast/shared';
import { Link } from 'react-router-dom';
import { useSaveSchedule } from '../lib/actions';
import { cx } from '../lib/cx';
import { api } from '../lib/api';
import { formatRule } from '../lib/format';
import { qk } from '../lib/queries';
import { Icon } from './Icon';
import { ScheduleRuleSheet } from './ScheduleRuleSheet';
import styles from './ShowSchedule.module.css';
import { IconButton, Spinner } from './ui';

/** A podcast's rules in the weekly plan, editable with the same sheet as on Woche. */
export function ShowSchedule({ showId, showName }: { showId: string; showName: string }) {
  const { t } = useTranslation('plan');
  const schedule = useQuery({ queryKey: qk.schedule, queryFn: api.schedule });
  const save = useSaveSchedule();
  const [editing, setEditing] = useState<ScheduleRule | 'new' | null>(null);

  const rules = schedule.data?.rules ?? [];
  const own = rules.filter((r) => r.showId === showId);

  return (
    <section className="card settings-card">
      <div className="row-between">
        <h2 className="h3">{t('show.title')}</h2>
        <button className="btn btn-small" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> {t('show.add')}
        </button>
      </div>
      {schedule.isLoading ? (
        <Spinner />
      ) : own.length === 0 ? (
        <p className="muted small">{t('show.notPlanned')}</p>
      ) : (
        <ul className={styles.rules}>
          {own.map((r) => (
            <li key={r.id}>
              <Icon name="calendar" size={18} />
              <span className={cx('grow', styles.rule)}>{formatRule(r)}</span>
              <IconButton icon="note" label={t('show.editRule', { rule: formatRule(r) })} onClick={() => setEditing(r)} />
              <IconButton
                icon="close"
                label={t('show.removeRule', { rule: formatRule(r) })}
                onClick={() =>
                  void save(
                    (current) => removeRule(current, r.id),
                    t('toast.showRuleRemovedNamed', { show: showName, rule: formatRule(r) }),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <Link to="/woche" className="small">
        {t('show.toWeek')}
      </Link>

      {editing && (
        <ScheduleRuleSheet
          rule={editing === 'new' ? undefined : editing}
          showId={showId}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            setEditing(null);
            void save(
              (current) => (editing === 'new' ? [...current, rule] : replaceRule(current, rule)),
              `${showName}: ${formatRule(rule)}`,
            );
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  setEditing(null);
                  void save(
                    (current) => removeRule(current, editing.id),
                    t('toast.showRuleRemovedNamed', { show: showName, rule: formatRule(editing) }),
                  );
                }
          }
        />
      )}
    </section>
  );
}
