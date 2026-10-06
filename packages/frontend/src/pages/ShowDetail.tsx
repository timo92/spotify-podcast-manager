import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { EpisodeView, Show, ShowSettingsPatch } from '@podcast/shared';
import { PlayButton } from '../components/EpisodeCard';
import { EpisodeRow } from '../components/EpisodeRow';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { Icon } from '../components/Icon';
import { ShowSchedule } from '../components/ShowSchedule';
import { ListenOnSpotify, SpotifyAttribution } from '../components/SpotifyAttribution';
import { Badge, Chip, Cover, Empty, ErrorBox, ProgressBar, Segmented, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatDeletionDate, formatDuration, formatRelative, formatReleaseDate, modeHint } from '../lib/format';
import { qk, useInvalidateLibrary, useSettings } from '../lib/queries';
import { useToast } from '../lib/toast';
import styles from './ShowDetail.module.css';
import { modeOptions, progressText } from './Shows';

type Filter = 'alle' | 'ungehoert' | 'gehoert' | 'uebersprungen' | 'neu' | 'begonnen';

const FILTERS: { value: Filter; test: (e: EpisodeView) => boolean }[] = [
  { value: 'alle', test: () => true },
  { value: 'ungehoert', test: (e) => e.status === 'UNSEEN' || e.status === 'IN_PROGRESS' },
  { value: 'neu', test: (e) => e.isNew },
  { value: 'begonnen', test: (e) => e.status === 'IN_PROGRESS' },
  { value: 'gehoert', test: (e) => e.status === 'COMPLETED' },
  { value: 'uebersprungen', test: (e) => e.status === 'SKIPPED' },
];

const PAGE = 60;

export function ShowDetailPage() {
  const { id = '' } = useParams();
  const detail = useQuery({ queryKey: qk.show(id), queryFn: () => api.show(id) });
  const { t } = useTranslation('shows');
  const { data: settings } = useSettings();
  const invalidate = useInvalidateLibrary();
  const qc = useQueryClient();
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>('alle');
  const [query, setQuery] = useState('');
  const [sortAsc, setSortAsc] = useState<boolean | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [openEpisode, setOpenEpisode] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const show = detail.data?.show;
  const asc = sortAsc ?? show?.mode === 'SEQUENTIAL';

  const episodes = useMemo(() => {
    const all = detail.data?.episodes ?? [];
    const test = FILTERS.find((x) => x.value === filter)?.test ?? (() => true);
    const q = query.trim().toLowerCase();
    const list = all.filter(
      (e) => test(e) && (!q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)),
    );
    return asc ? list : [...list].reverse();
  }, [detail.data, filter, query, asc]);

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !show)
    return (
      <ErrorBox error={detail.error ?? t('ui.notFound', { ns: 'common' })} onRetry={() => void detail.refetch()} />
    );

  const s = show.summary;
  const next = s?.nextEpisode ?? null;
  const all = detail.data?.episodes ?? [];
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, all.filter(f.test).length]));
  const showId = show.id;

  /**
   * Shows the change at once, so a second click builds on the first (e.g. two
   * categories in a row), and restores the previous state if saving fails.
   */
  async function update(patch: ShowSettingsPatch) {
    const key = qk.show(showId);
    const before = qc.getQueryData<typeof detail.data>(key);
    const withShow = (change: (cur: Show) => Show) => (old: typeof detail.data) =>
      old ? { ...old, show: change(old.show) } : old;
    qc.setQueryData(
      key,
      withShow((cur) => ({ ...cur, ...patch })),
    );
    try {
      const updated = await api.updateShow(showId, patch);
      qc.setQueryData(
        key,
        withShow(() => updated),
      );
      await invalidate();
    } catch (e) {
      qc.setQueryData(key, before);
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  const categories = [...new Set([...(settings?.categories ?? []), ...show.categories])];

  return (
    <div className="page">
      <Link to="/podcasts" className={styles.backLink}>
        <Icon name="back" size={18} /> {t('detail.back')}
      </Link>

      <header className={styles.hero}>
        <Cover src={show.imageUrl} alt={show.name} size={120} />
        <div className={styles.heroText}>
          <h1>{show.name}</h1>
          {show.publisher && <div className="muted">{show.publisher}</div>}
          <div className="badges">
            {!show.followed && (
              <Badge tone="warn">
                {t('detail.unfollowed')}
                {show.unfollowedAt && ` – ${t('detail.removedOn', { date: formatDeletionDate(show.unfollowedAt) })}`}
              </Badge>
            )}
            {show.paused && <Badge tone="muted">{t('ui.paused', { ns: 'common' })}</Badge>}
            {s && s.newCount > 0 && <Badge tone="new">{t('card.newCount', { count: s.newCount })}</Badge>}
          </div>
          <div className="row gap wrap">
            <ListenOnSpotify href={show.spotifyUrl} small />
            <button
              className="btn btn-small"
              onClick={() =>
                void api
                  .syncShow(show.id)
                  .then(() => {
                    toast({ message: t('detail.reloading') });
                    return qc.invalidateQueries({ queryKey: qk.status });
                  })
                  .catch((e: Error) => toast({ message: e.message, tone: 'error' }))
              }
            >
              <Icon name="refresh" size={16} /> {t('detail.reload')}
            </button>
          </div>
          <SpotifyAttribution href={show.spotifyUrl} on="page" />
        </div>
      </header>

      {show.description && (
        <button
          type="button"
          className={cx('description', styles.descriptionToggle, !showDescription && styles.clamp)}
          aria-expanded={showDescription}
          onClick={() => setShowDescription((v) => !v)}
        >
          {show.description}
        </button>
      )}

      {next && (
        <section className={cx('card', styles.nextCard)}>
          <div className="muted small">{show.mode === 'LATEST' ? t('detail.newest') : t('detail.next')}</div>
          <button type="button" className="episode-title linklike" onClick={() => setOpenEpisode(next.id)}>
            {next.name}
          </button>
          <div className="muted small">
            {t('episode.number', { ns: 'common', index: next.index })} · {formatReleaseDate(next.releaseDate)} ·{' '}
            {formatDuration(next.remainingMs)}
            {next.remainingMs < next.durationMs && ` ${t('detail.left')}`}
          </div>
          <div className="row gap">
            <PlayButton item={{ show, episode: next }} />
          </div>
        </section>
      )}

      <section className="card settings-card">
        <h2 className="h3">{t('detail.settings')}</h2>
        <Segmented
          label={t('ui.mode', { ns: 'common' })}
          value={show.mode}
          options={modeOptions()}
          onChange={(mode) => void update({ mode })}
        />
        <p className="muted small">{modeHint(show.mode)}</p>
        <div className="chips">
          {categories.map((c) => (
            <Chip
              key={c}
              active={show.categories.includes(c)}
              onClick={() =>
                void update({
                  categories: show.categories.includes(c)
                    ? show.categories.filter((x) => x !== c)
                    : [...show.categories, c],
                })
              }
            >
              {c}
            </Chip>
          ))}
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              const c = newCategory.trim();
              if (!c) return;
              setNewCategory('');
              void update({ categories: [...show.categories, c] });
            }}
          >
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder={t('ui.categoryPlaceholder', { ns: 'common' })}
              aria-label={t('ui.newCategory', { ns: 'common' })}
            />
          </form>
        </div>
        <Toggle
          label={t('detail.pause')}
          hint={t('detail.pauseHint')}
          checked={show.paused}
          onChange={(paused) => void update({ paused })}
        />
        <Toggle
          label={t('detail.hide')}
          hint={t('detail.hideHint')}
          checked={show.hiddenFromToday}
          onChange={(hiddenFromToday) => void update({ hiddenFromToday })}
        />
        {show.mode === 'SEQUENTIAL' && (
          <Toggle
            label={t('detail.reoffer')}
            hint={t('detail.reofferHint')}
            checked={show.reofferSkipped}
            onChange={(reofferSkipped) => void update({ reofferSkipped })}
          />
        )}
        {show.needsReview && (
          <button className="btn btn-primary btn-small" onClick={() => void update({ needsReview: false })}>
            <Icon name="check" size={16} /> {t('detail.confirm')}
          </button>
        )}
      </section>

      <ShowSchedule showId={show.id} showName={show.name} />

      {s && s.total > 0 && (
        <section className="stack-sm">
          <div className="row-between small">
            <strong>{progressText(show).text}</strong>
            <span className="muted">
              {t('detail.counts', { played: s.completed, skipped: s.skipped, open: s.unseen + s.inProgress })}
            </span>
          </div>
          <ProgressBar value={s.completed + s.skipped} max={s.total} label={t('ui.progress', { ns: 'common' })} />
          <div className="muted tiny">{t('detail.synced', { when: formatRelative(show.lastSyncedAt) })}</div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{t('detail.episodes')}</h2>
          <button className="btn btn-small" onClick={() => setSortAsc(!asc)} aria-label={t('detail.reverse')}>
            <Icon name="sort" size={16} /> {asc ? t('detail.oldestFirst') : t('detail.newestFirst')}
          </button>
        </div>
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder={t('detail.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
        <div className="chips" role="toolbar" aria-label={t('ui.filter', { ns: 'common' })}>
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              active={filter === f.value}
              count={counts[f.value]}
              onClick={() => {
                setFilter(f.value);
                setLimit(PAGE);
              }}
            >
              {t(`detail.filter.${f.value}`)}
            </Chip>
          ))}
        </div>
        {episodes.length === 0 ? (
          <Empty title={t('detail.noneFound')} />
        ) : (
          <ul className={styles.episodes}>
            {episodes.slice(0, limit).map((e) => (
              <EpisodeRow key={e.id} show={show} episode={e} isNext={next?.id === e.id} onOpen={setOpenEpisode} />
            ))}
          </ul>
        )}
        {episodes.length > limit && (
          <button className="btn btn-block" onClick={() => setLimit((l) => l + PAGE * 2)}>
            {t('detail.more', { count: Math.min(PAGE * 2, episodes.length - limit), rest: episodes.length - limit })}
          </button>
        )}
      </section>

      {openEpisode && <EpisodeSheet showId={show.id} episodeId={openEpisode} onClose={() => setOpenEpisode(null)} />}
    </div>
  );
}
