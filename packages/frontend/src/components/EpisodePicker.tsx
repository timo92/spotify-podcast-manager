import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ShowLite } from '@podcast/shared';
import { useEpisodeActions } from '../lib/actions';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatDuration, formatReleaseDate } from '../lib/format';
import { qk } from '../lib/queries';
import styles from './EpisodePicker.module.css';
import { SpotifyAttribution } from './SpotifyAttribution';
import { Cover, Empty, ErrorBox, IconButton, Spinner, StatusBadge } from './ui';

/**
 * Picks the next episode of a podcast in place (pins it, like "Als nächste
 * Folge festlegen"). Lists the open episodes, newest first.
 */
export function EpisodePickerSheet({ show, onClose }: { show: ShowLite; onClose: () => void }) {
  const { t } = useTranslation('plan');
  const detail = useQuery({ queryKey: qk.show(show.id), queryFn: () => api.show(show.id) });
  const actions = useEpisodeActions();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (detail.data?.episodes ?? [])
      .filter((e) => e.status === 'UNSEEN' || e.status === 'IN_PROGRESS')
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .reverse();
  }, [detail.data, query]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('picker.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <h2>{t('picker.title')}</h2>
          <IconButton icon="close" label={t('ui.close', { ns: 'common' })} onClick={onClose} />
        </div>
        <div className="row gap">
          <Cover src={show.imageUrl} alt={show.name} size={40} />
          <strong className="grow">{show.name}</strong>
        </div>
        <SpotifyAttribution href={detail.data?.show.spotifyUrl} />
        <input
          type="search"
          placeholder={t('picker.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {detail.isLoading && <Spinner />}
        {detail.error && <ErrorBox error={detail.error} onRetry={() => void detail.refetch()} />}
        {detail.data && open.length === 0 && <Empty title={t('picker.empty')} />}
        {open.length > 0 && (
          <ul className="pick-list">
            {open.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="pick"
                  onClick={() => {
                    onClose();
                    void actions.pin(show.id, e.id, detail.data?.show.pinnedEpisodeId ?? null);
                  }}
                >
                  <span className={cx('grow', styles.text)}>
                    <span className={styles.title}>{e.name}</span>
                    <span className="muted tiny">
                      {t('episode.number', { ns: 'common', index: e.index })} · {formatReleaseDate(e.releaseDate)} ·{' '}
                      {formatDuration(e.durationMs)}
                    </span>
                  </span>
                  <StatusBadge status={e.status} isNew={e.isNew} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Link to={`/podcasts/${encodeURIComponent(show.id)}`} className="small" onClick={onClose}>
          {t('picker.allEpisodes')}
        </Link>
      </div>
    </div>
  );
}
