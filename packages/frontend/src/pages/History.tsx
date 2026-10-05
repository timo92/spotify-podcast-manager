import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import type { EpisodeProgress } from '@podcast/shared';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Icon } from '../components/Icon';
import { NoteText } from '../components/Notes';
import { Empty, ErrorBox, Segmented, Spinner } from '../components/ui';
import i18n from '../i18n';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatDuration, formatLongDate, formatRelative } from '../lib/format';
import { qk } from '../lib/queries';
import styles from './History.module.css';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return i18n.t('time.today');
  if (diff === 1) return i18n.t('time.yesterday');
  return formatLongDate(d);
}

type Tab = 'gehoert' | 'notizen';

export function HistoryPage() {
  const { t } = useTranslation('history');
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'notizen' ? 'notizen' : 'gehoert';
  const [open, setOpen] = useState<{ showId: string; episodeId: string } | null>(null);
  const onOpen = (showId: string, episodeId: string) => setOpen({ showId, episodeId });

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('title')}</h1>
        <SpotifyAttribution on="page" />
      </header>
      <Segmented
        label={t('view')}
        value={tab}
        onChange={(next) => setParams(next === 'notizen' ? { tab: 'notizen' } : {})}
        options={[
          { value: 'gehoert', label: t('tabPlayed') },
          { value: 'notizen', label: t('tabNotes') },
        ]}
      />
      {tab === 'gehoert' ? <Listened onOpen={onOpen} /> : <Notes onOpen={onOpen} />}
      {open && <EpisodeSheet {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Notes({ onOpen }: { onOpen: (showId: string, episodeId: string) => void }) {
  const { t } = useTranslation('history');
  const notes = useQuery({ queryKey: qk.notes, queryFn: api.notes });
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes.data ?? []).filter(
      (n) =>
        !q ||
        n.text.toLowerCase().includes(q) ||
        (n.episodeName ?? '').toLowerCase().includes(q) ||
        (n.showName ?? '').toLowerCase().includes(q),
    );
  }, [notes.data, query]);

  return (
    <>
      {notes.isLoading && <Spinner />}
      {notes.error && <ErrorBox error={notes.error} />}
      {notes.data?.length === 0 && (
        <Empty title={t('notesEmptyTitle')}>
          <Trans t={t} i18nKey="notesEmptyText" components={{ icon: <Icon name="note" size={14} /> }} />
        </Empty>
      )}
      {!!notes.data?.length && (
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder={t('notesSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      <div className="card-list">
        {list.map((n) => (
          <article key={`${n.showId}-${n.episodeId}`} className={cx('card', styles.noteCard)}>
            <div className="row-between">
              <div className="grow">
                <Link to={`/podcasts/${encodeURIComponent(n.showId)}`} className="show-name">
                  {n.showName}
                </Link>
                <button type="button" className="episode-title linklike" onClick={() => onOpen(n.showId, n.episodeId)}>
                  {n.episodeName ?? n.episodeId}
                </button>
              </div>
              <span className="muted tiny">{formatRelative(n.updatedAt)}</span>
            </div>
            <NoteText
              note={n}
              item={{
                show: { id: n.showId, name: n.showName ?? '' },
                episode: {
                  id: n.episodeId,
                  name: n.episodeName ?? '',
                  durationMs: 0,
                  spotifyUrl: `https://open.spotify.com/episode/${n.episodeId}`,
                  status: 'UNSEEN',
                  statusSource: 'default',
                },
              }}
            />
          </article>
        ))}
      </div>
    </>
  );
}

function Listened({ onOpen }: { onOpen: (showId: string, episodeId: string) => void }) {
  const { t } = useTranslation('history');
  const history = useQuery({ queryKey: qk.history, queryFn: () => api.history(200) });

  const groups: [string, EpisodeProgress[]][] = [];
  for (const p of history.data ?? []) {
    const label = dayLabel(p.listenedAt ?? p.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(p);
    else groups.push([label, [p]]);
  }
  const totalMs = (history.data ?? [])
    .filter((p) => Date.now() - Date.parse(p.listenedAt ?? p.updatedAt) < 7 * 86_400_000)
    .reduce((sum, p) => sum + (p.durationMs ?? 0), 0);

  return (
    <>
      <p className="muted">{totalMs > 0 ? t('lastWeek', { time: formatDuration(totalMs) }) : t('recent')}</p>
      {history.isLoading && <Spinner />}
      {history.error && <ErrorBox error={history.error} />}
      {history.data?.length === 0 && (
        <Empty title={t('emptyTitle')}>{t('emptyText')}</Empty>
      )}
      {groups.map(([label, items]) => (
        <section key={label} className="section">
          <h2 className="h3">{label}</h2>
          <ul className="simple-list">
            {items.map((p) => (
              <li key={`${p.showId}-${p.episodeId}`}>
                <button type="button" className="linklike" onClick={() => onOpen(p.showId, p.episodeId)}>
                  {p.episodeName ?? p.episodeId}
                </button>
                <span className="muted small">
                  <Link to={`/podcasts/${encodeURIComponent(p.showId)}`}>{p.showName}</Link>
                  {p.durationMs ? ` · ${formatDuration(p.durationMs)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
