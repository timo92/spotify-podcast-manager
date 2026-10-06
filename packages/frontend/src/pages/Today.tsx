import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { EpisodeCard } from '../components/EpisodeCard';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { PlanItemRow, PlanList } from '../components/PlanItem';
import { Cover, Empty, ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatLongDate, formatRelative, greeting, syncError } from '../lib/format';
import { qk, useStatus } from '../lib/queries';
import styles from './Today.module.css';

export function TodayPage() {
  const { t } = useTranslation('today');
  const { data: status } = useStatus();
  const today = useQuery({ queryKey: qk.today, queryFn: api.today });
  const [params] = useSearchParams();
  const [open, setOpen] = useState<{ showId: string; episodeId: string } | null>(null);
  const onOpen = (showId: string, episodeId: string) => setOpen({ showId, episodeId });

  const syncing = status?.sync?.status === 'running';
  const welcome = params.get('welcome') === '1';
  const name = status?.user?.displayName?.split(' ')[0];
  const data = today.data;

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <p className="muted">
          {formatLongDate(new Date())}
          {data && data.newCount > 0 && ` · ${t('newEpisodes', { count: data.newCount })}`}
        </p>
        <SpotifyAttribution on="page" />
      </header>

      {syncing && (welcome || !data?.recommended.length) && (
        <div className="banner banner-info">
          <span>{t('importing')}</span>
        </div>
      )}
      {data && data.needsReviewCount > 0 && !syncing && (
        <div className="banner banner-info">
          <span>{t('review', { count: data.needsReviewCount })}</span>
          <Link className="btn btn-small" to="/podcasts?pruefen=1">
            {t('reviewNow')}
          </Link>
        </div>
      )}
      {status?.sync?.status === 'error' && (
        <ErrorBox error={t('lastSyncFailed', { error: syncError(status.sync) || t('unknownError') })} />
      )}

      {today.isLoading && <Spinner />}
      {today.error && <ErrorBox error={today.error} onRetry={() => void today.refetch()} />}

      {data && (
        <>
          {data.plan.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('plan')}</h2>
                <Link to="/woche" className="small">
                  {t('weekPlan')}
                </Link>
              </div>
              <PlanList card>
                {data.plan.map((item) => (
                  <PlanItemRow key={item.ruleId} item={item} isToday onOpen={onOpen} />
                ))}
              </PlanList>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>{data.plan.length ? t('alsoRecommended') : t('recommended')}</h2>
              {data.budgetMinutes > 0 && (
                <span
                  className={cx(
                    styles.budget,
                    data.budgetFit === 'perfect' && styles.perfect,
                    data.budgetFit === 'over' && styles.over,
                  )}
                >
                  {t('budget', { used: data.recommendedMinutes, budget: data.budgetMinutes })}
                  {data.budgetFit === 'perfect' && ` · ${t('budgetFits')}`}
                  {data.budgetFit === 'over' &&
                    ` · ${data.recommendedMinutes <= data.budgetMinutes * 1.2 ? t('budgetSlightlyOver') : t('budgetOver')}`}
                </span>
              )}
            </div>
            {data.recommended.length === 0 ? (
              <Empty
                title={
                  data.more.length
                    ? data.plan.length
                      ? t('emptyPlanFull')
                      : t('emptyNothingFits')
                    : t('emptyAllHeard')
                }
              >
                {data.more.length ? t('emptyMore') : syncing ? t('emptyImporting') : t('emptyNothingOpen')}
              </Empty>
            ) : (
              <div className="card-list">
                {data.recommended.map((item) => (
                  <EpisodeCard key={item.episode.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            )}
          </section>

          {data.more.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('more')}</h2>
                <span className="muted small">{t('outsideBudget')}</span>
              </div>
              <div className="card-list">
                {data.more.map((item) => (
                  <EpisodeCard key={item.episode.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            </section>
          )}

          {data.noNewEpisode.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('noNewEpisode')}</h2>
              </div>
              <div className={styles.pills}>
                {data.noNewEpisode.map((s) => (
                  <Link key={s.id} to={`/podcasts/${encodeURIComponent(s.id)}`} className={styles.pill}>
                    <Cover src={s.imageUrl} alt={s.name} size={28} />
                    <span>{s.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.recent.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('recent')}</h2>
                <Link to="/verlauf" className="small">
                  {t('all')}
                </Link>
              </div>
              <ul className="simple-list">
                {data.recent.map((r) => (
                  <li key={`${r.showId}-${r.episodeId}`}>
                    <button type="button" className="linklike" onClick={() => onOpen(r.showId, r.episodeId)}>
                      {r.episodeName}
                    </button>
                    <span className="muted small">
                      {r.showName} · {formatRelative(r.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {open && <EpisodeSheet {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}
