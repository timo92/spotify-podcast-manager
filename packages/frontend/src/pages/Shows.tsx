import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import type { Show } from '@podcast/shared';
import { Icon } from '../components/Icon';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Badge, Chip, Cover, Empty, ErrorBox, IconButton, ProgressBar, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatRelative, modeHint, modeLabel, modeOptions, progressText } from '../lib/format';
import { useRun } from '../lib/actions';
import { qk, useSettings } from '../lib/queries';
import styles from './Shows.module.css';

export function ShowsPage() {
  const { t } = useTranslation('shows');
  const shows = useQuery({ queryKey: qk.shows, queryFn: api.shows });
  const { data: settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const reviewMode = params.get('pruefen') === '1';
  const [filter, setFilter] = useState<string>('alle');
  const [reorder, setReorder] = useState(false);
  const [order, setOrder] = useState<Show[] | null>(null);
  const run = useRun();

  const list = order ?? shows.data ?? [];
  const reviewCount = (shows.data ?? []).filter((s) => s.needsReview).length;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of shows.data ?? []) for (const c of s.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shows.data]);

  const visible = list.filter((s) => {
    if (reviewMode) return s.needsReview;
    if (reorder) return true;
    if (filter === 'alle') return s.followed;
    if (filter === 'pausiert') return s.paused || s.hiddenFromToday;
    if (filter === 'entfolgt') return !s.followed;
    return s.categories.includes(filter) && s.followed;
  });

  async function move(index: number, delta: number) {
    const next = [...list];
    const target = index + delta;
    const moving = next[index];
    const other = next[target];
    if (!moving || !other) return;
    next[index] = other;
    next[target] = moving;
    const previous = order;
    setOrder(next);
    await run(() => api.reorder(next.map((s) => s.id)), { revert: () => setOrder(previous) });
  }

  async function confirmAll() {
    const confirm = () => Promise.all(visible.map((s) => api.updateShow(s.id, { needsReview: false })));
    if (await run(confirm, { message: t('list.allConfirmed') })) setParams({});
  }

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>{reviewMode ? t('list.titleReview') : t('list.title')}</h1>
          <p className="muted">
            {reviewMode
              ? t('list.introReview')
              : t('list.intro', { count: (shows.data ?? []).filter((s) => s.followed).length })}
          </p>
          <SpotifyAttribution on="page" />
        </div>
        {!reviewMode && (
          <button
            type="button"
            className={`btn btn-small${reorder ? ' btn-primary' : ''}`}
            onClick={() => {
              // Leaving the reorder mode shows the stored order again.
              if (reorder) setOrder(null);
              setReorder(!reorder);
            }}
          >
            <Icon name="sort" size={18} /> {reorder ? t('ui.done', { ns: 'common' }) : t('list.priority')}
          </button>
        )}
      </header>

      {!reviewMode && reviewCount > 0 && (
        <div className="banner banner-info">
          <span>{t('list.reviewBanner', { count: reviewCount })}</span>
          <Link className="btn btn-small" to="?pruefen=1">
            {t('list.review')}
          </Link>
        </div>
      )}
      {reviewMode && (
        <div className="row gap">
          <button className="btn btn-primary" onClick={() => void confirmAll()} disabled={!visible.length}>
            <Icon name="check" size={18} /> {t('list.confirmAll')}
          </button>
          <Link className="btn" to="/podcasts">
            {t('ui.back', { ns: 'common' })}
          </Link>
        </div>
      )}
      {reorder && <p className="muted small">{t('list.priorityHint')}</p>}

      {!reviewMode && !reorder && (
        <div className="chips" role="toolbar" aria-label={t('ui.filter', { ns: 'common' })}>
          <Chip active={filter === 'alle'} onClick={() => setFilter('alle')}>
            {t('ui.all', { ns: 'common' })}
          </Chip>
          {categoryCounts.map(([c, n]) => (
            <Chip key={c} active={filter === c} onClick={() => setFilter(c)} count={n}>
              {c}
            </Chip>
          ))}
          <Chip active={filter === 'pausiert'} onClick={() => setFilter('pausiert')}>
            {t('ui.paused', { ns: 'common' })}
          </Chip>
          {(shows.data ?? []).some((s) => !s.followed) && (
            <Chip active={filter === 'entfolgt'} onClick={() => setFilter('entfolgt')}>
              {t('list.unfollowed')}
            </Chip>
          )}
        </div>
      )}

      {shows.isLoading && <Spinner />}
      {shows.error && <ErrorBox error={shows.error} onRetry={() => void shows.refetch()} />}
      {shows.data && visible.length === 0 && (
        <Empty title={reviewMode ? t('list.emptyReview') : t('list.empty')}>
          {reviewMode ? <Link to="/podcasts">{t('list.toOverview')}</Link> : t('list.emptyText')}
        </Empty>
      )}

      <div className="card-list">
        {visible.map((show, i) =>
          reviewMode ? (
            <ReviewCard key={show.id} show={show} categories={settings?.categories ?? []} />
          ) : (
            <div key={show.id} className={styles.rowWrap}>
              {reorder && (
                <div className={styles.reorder}>
                  <IconButton icon="up" label={t('list.moveUp')} onClick={() => void move(i, -1)} disabled={i === 0} />
                  <IconButton
                    icon="down"
                    label={t('list.moveDown')}
                    onClick={() => void move(i, 1)}
                    disabled={i === visible.length - 1}
                  />
                </div>
              )}
              <ShowCard show={show} rank={reorder ? i + 1 : undefined} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ShowCard({ show, rank }: { show: Show; rank?: number }) {
  const { t } = useTranslation('shows');
  const s = show.summary;
  const progress = progressText(show);
  return (
    <Link to={`/podcasts/${encodeURIComponent(show.id)}`} className={cx('card', styles.card)}>
      {rank !== undefined && <span className={styles.rank}>{rank}</span>}
      <Cover src={show.imageUrl} alt={show.name} size={64} />
      <div className={styles.body}>
        <div className={styles.title}>
          <strong>{show.name}</strong>
          {s && s.newCount > 0 && <Badge tone="new">{t('card.newCount', { count: s.newCount })}</Badge>}
          {show.paused && <Badge tone="muted">{t('ui.paused', { ns: 'common' })}</Badge>}
          {show.hiddenFromToday && <Badge tone="muted">{t('card.notOnToday')}</Badge>}
          {show.needsReview && <Badge tone="warn">{t('card.review')}</Badge>}
        </div>
        <div className="muted small">
          {modeLabel(show.mode)}
          {show.categories.length > 0 && ` · ${show.categories.join(', ')}`}
        </div>
        <div className={`small ${progress.tone === 'new' ? 'text-new' : progress.tone === 'muted' ? 'muted' : ''}`}>
          {progress.text}
        </div>
        {s?.nextEpisode && (
          <div className="small ellipsis">
            <span className="muted">{t('card.next')} </span>
            {s.nextEpisode.name}
          </div>
        )}
        {s?.lastCompleted && (
          <div className="small ellipsis muted">
            {t('card.lastPlayed', { name: s.lastCompleted.name })}
            {s.lastCompleted.at && ` · ${formatRelative(s.lastCompleted.at)}`}
          </div>
        )}
        {show.mode === 'SEQUENTIAL' && s && s.total > 0 && (
          <ProgressBar value={s.completed + s.skipped} max={s.total} label={t('ui.progress', { ns: 'common' })} />
        )}
        <div className="muted tiny">
          {t('card.synced', { when: formatRelative(show.lastSyncedAt) })}
          {show.lastSyncError && <span className="text-error"> · {t('card.syncError')}</span>}
        </div>
      </div>
    </Link>
  );
}

function ReviewCard({ show, categories }: { show: Show; categories: string[] }) {
  const { t } = useTranslation('shows');
  const run = useRun();
  const [mode, setMode] = useState(show.mode);
  const [cats, setCats] = useState(show.categories);

  /** Saves a choice; `revert` puts back one the card already shows if saving fails. */
  const save = (patch: Parameters<typeof api.updateShow>[1], revert?: () => void) =>
    run(() => api.updateShow(show.id, patch), { revert });

  return (
    <div className={cx('card', styles.reviewCard)}>
      <div className="row gap">
        <Cover src={show.imageUrl} alt={show.name} size={56} />
        <div className="grow">
          <strong>{show.name}</strong>
          <div className="muted small">{t('review.episodes', { count: show.summary?.total ?? 0 })}</div>
        </div>
      </div>
      <Segmented
        label={t('ui.mode', { ns: 'common' })}
        value={mode}
        options={modeOptions()}
        onChange={(m) => {
          const before = mode;
          setMode(m);
          void save({ mode: m }, () => setMode(before));
        }}
      />
      <div className="muted small">{modeHint(mode)}</div>
      <div className="chips">
        {categories.map((c) => (
          <Chip
            key={c}
            active={cats.includes(c)}
            onClick={() => {
              const before = cats;
              const next = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
              setCats(next);
              void save({ categories: next }, () => setCats(before));
            }}
          >
            {c}
          </Chip>
        ))}
      </div>
      <div className="row gap">
        <button className="btn btn-primary btn-small" onClick={() => void save({ needsReview: false })}>
          <Icon name="check" size={16} /> {t('review.ok')}
        </button>
        <button className="btn btn-small" onClick={() => void save({ needsReview: false, hiddenFromToday: true })}>
          {t('review.notOnToday')}
        </button>
      </div>
    </div>
  );
}
