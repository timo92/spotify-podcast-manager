import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  groupNotesByShow,
  localDate,
  notesInRange,
  presetRange,
  type DateRange,
  type EpisodeNote,
  type PeriodPreset,
} from '@podcast/shared';
import { Icon } from '../components/Icon';
import { NoteText, PositionButton } from '../components/Notes';
import { Chip, Cover, Empty, ErrorBox, Segmented, Spinner } from '../components/ui';
import { api, TIME_ZONE } from '../lib/api';
import { cx } from '../lib/cx';
import { formatRelative } from '../lib/format';
import { episodeItem } from '../lib/player';
import { qk } from '../lib/queries';
import { readStored, readStoredJson, writeStored } from '../lib/storage';
import styles from './NotesTab.module.css';

type Grouping = 'list' | 'show';
type Period = { preset: 'all' | PeriodPreset } | { preset: 'custom'; from?: string; to?: string };

const PRESETS: PeriodPreset[] = ['week', 'last30', 'year'];
const GROUPING_KEY = 'pm.notes.grouping';
const PERIOD_KEY = 'pm.notes.period';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The grouping and period chosen last in this browser. */
function readChoices(): { grouping: Grouping; period: Period } {
  const grouping: Grouping = readStored(GROUPING_KEY) === 'show' ? 'show' : 'list';
  let period: Period = { preset: 'all' };
  const raw = readStoredJson(PERIOD_KEY);
  if (raw && typeof raw === 'object' && 'preset' in raw) {
    const p = raw as { preset: unknown; from?: unknown; to?: unknown };
    if (p.preset === 'custom') {
      const date = (v: unknown) => (typeof v === 'string' && DATE_RE.test(v) ? v : undefined);
      period = { preset: 'custom', from: date(p.from), to: date(p.to) };
    } else if (PRESETS.includes(p.preset as PeriodPreset)) {
      period = { preset: p.preset as PeriodPreset };
    }
  }
  return { grouping, period };
}

function rangeOf(period: Period, today: string): DateRange {
  if (period.preset === 'all') return {};
  if (period.preset === 'custom') return { from: period.from || undefined, to: period.to || undefined };
  return presetRange(period.preset, today);
}

/**
 * Verlauf → Notizen: one card per note, optionally grouped by podcast and
 * limited to a period of when they were written. The search works within that
 * result.
 */
export function NotesTab({ onOpen }: { onOpen: (showId: string, episodeId: string) => void }) {
  const { t } = useTranslation('history');
  const notes = useQuery({ queryKey: qk.notes, queryFn: api.notes });
  const shows = useQuery({ queryKey: qk.shows, queryFn: api.shows });
  const [stored] = useState(readChoices);
  const [grouping, setGrouping] = useState<Grouping>(stored.grouping);
  const [period, setPeriod] = useState<Period>(stored.period);
  const [query, setQuery] = useState('');

  useEffect(() => {
    writeStored(GROUPING_KEY, grouping);
    writeStored(PERIOD_KEY, JSON.stringify(period));
  }, [grouping, period]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inPeriod = notesInRange(notes.data ?? [], rangeOf(period, localDate(Date.now(), TIME_ZONE)), TIME_ZONE);
    return inPeriod.filter(
      (n) =>
        !q ||
        n.text.toLowerCase().includes(q) ||
        (n.episodeName ?? '').toLowerCase().includes(q) ||
        (n.showName ?? '').toLowerCase().includes(q),
    );
  }, [notes.data, period, query]);
  const covers = useMemo(() => new Map((shows.data ?? []).map((s) => [s.id, s.imageUrl])), [shows.data]);

  if (notes.isLoading) return <Spinner />;
  if (notes.error) return <ErrorBox error={notes.error} />;
  if (!notes.data?.length) {
    return (
      <Empty title={t('notesEmptyTitle')}>
        <Trans t={t} i18nKey="notesEmptyText" components={{ icon: <Icon name="note" size={14} /> }} />
      </Empty>
    );
  }

  const card = (n: EpisodeNote, showName: boolean) => (
    <NoteCard key={`${n.showId}-${n.episodeId}-${n.id}`} note={n} showName={showName} onOpen={onOpen} />
  );

  return (
    <>
      <div className={styles.controls}>
        <Segmented
          label={t('notes.grouping')}
          value={grouping}
          onChange={setGrouping}
          options={[
            { value: 'list', label: t('notes.list') },
            { value: 'show', label: t('notes.byShow') },
          ]}
        />
        <div className="chips" role="toolbar" aria-label={t('notes.period')}>
          <Chip active={period.preset === 'all'} onClick={() => setPeriod({ preset: 'all' })}>
            {t('notes.periodAll')}
          </Chip>
          {PRESETS.map((p) => (
            <Chip key={p} active={period.preset === p} onClick={() => setPeriod({ preset: p })}>
              {t(`notes.preset.${p}`)}
            </Chip>
          ))}
          <Chip active={period.preset === 'custom'} onClick={() => setPeriod({ preset: 'custom' })}>
            {t('notes.custom')}
          </Chip>
        </div>
        {period.preset === 'custom' && (
          <div className={styles.dates}>
            <label>
              <span className="small">{t('notes.from')}</span>
              <input
                type="date"
                value={period.from ?? ''}
                max={period.to}
                onChange={(e) => setPeriod({ ...period, from: e.target.value || undefined })}
              />
            </label>
            <label>
              <span className="small">{t('notes.to')}</span>
              <input
                type="date"
                value={period.to ?? ''}
                min={period.from}
                onChange={(e) => setPeriod({ ...period, to: e.target.value || undefined })}
              />
            </label>
          </div>
        )}
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder={t('notesSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {list.length === 0 && <Empty title={t('notes.noneFound')} />}
      {grouping === 'list' ? (
        <div className="card-list">{list.map((n) => card(n, true))}</div>
      ) : (
        groupNotesByShow(list).map((g) => (
          <section key={g.showId} className="section" aria-label={g.showName}>
            <Link to={`/podcasts/${encodeURIComponent(g.showId)}`} className={styles.groupHead}>
              <Cover src={covers.get(g.showId)} alt={g.showName ?? ''} size={40} />
              <span className="grow">
                <strong>{g.showName}</strong>
                <span className="muted small">{t('notes.count', { count: g.notes.length })}</span>
              </span>
            </Link>
            <div className="card-list">{g.notes.map((n) => card(n, false))}</div>
          </section>
        ))
      )}
    </>
  );
}

function NoteCard({
  note,
  showName,
  onOpen,
}: {
  note: EpisodeNote;
  showName: boolean;
  onOpen: (showId: string, episodeId: string) => void;
}) {
  const item = episodeItem(note);
  return (
    <article className={cx('card', styles.noteCard)}>
      <div className="row-between">
        <div className="grow">
          {showName && (
            <Link to={`/podcasts/${encodeURIComponent(note.showId)}`} className="show-name">
              {note.showName}
            </Link>
          )}
          <button type="button" className="episode-title linklike" onClick={() => onOpen(note.showId, note.episodeId)}>
            {note.episodeName ?? note.episodeId}
          </button>
        </div>
        <span className="muted tiny">{formatRelative(note.createdAt)}</span>
      </div>
      <div className={styles.noteBody}>
        {note.positionMs !== null && <PositionButton ms={note.positionMs} item={item} />}
        <NoteText note={note} item={item} />
      </div>
    </article>
  );
}
