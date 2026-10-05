import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { EpisodeCard } from '../components/EpisodeCard';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { PlanItemRow } from '../components/PlanItem';
import { Cover, Empty, ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatRelative, greeting } from '../lib/format';
import { qk, useStatus } from '../lib/queries';

export function TodayPage() {
  const { data: status } = useStatus();
  const today = useQuery({ queryKey: qk.today, queryFn: api.today });
  const [params] = useSearchParams();
  const [open, setOpen] = useState<{ showId: string; episodeId: string } | null>(null);
  const onOpen = (showId: string, episodeId: string) => setOpen({ showId, episodeId });

  const syncing = status?.sync?.status === 'running';
  const welcome = params.get('welcome') === '1';
  const name = status?.user?.displayName?.split(' ')[0];
  const t = today.data;

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <p className="muted">
          {new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          {t && t.newCount > 0 && ` · ${t.newCount} neue ${t.newCount === 1 ? 'Folge' : 'Folgen'}`}
        </p>
        <SpotifyAttribution on="page" />
      </header>

      {syncing && (welcome || !t?.recommended.length) && (
        <div className="banner banner-info">
          <span>Deine Podcasts werden aus Spotify importiert. Das dauert beim ersten Mal einen Moment…</span>
        </div>
      )}
      {t && t.needsReviewCount > 0 && !syncing && (
        <div className="banner banner-info">
          <span>
            {t.needsReviewCount} {t.needsReviewCount === 1 ? 'Podcast wartet' : 'Podcasts warten'} auf deine Einordnung
            (Aktualität oder Reihenfolge?).
          </span>
          <Link className="btn btn-small" to="/podcasts?pruefen=1">
            Jetzt prüfen
          </Link>
        </div>
      )}
      {status?.sync?.status === 'error' && (
        <ErrorBox error={`Letzter Sync fehlgeschlagen: ${status.sync.error ?? 'unbekannter Fehler'}`} />
      )}

      {today.isLoading && <Spinner />}
      {today.error && <ErrorBox error={today.error} onRetry={() => void today.refetch()} />}

      {t && (
        <>
          {t.plan.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Dein Plan für heute</h2>
                <Link to="/woche" className="small">
                  Wochenplan
                </Link>
              </div>
              <ul className="plan-list card">
                {t.plan.map((item) => (
                  <PlanItemRow key={item.ruleId} item={item} isToday onOpen={onOpen} />
                ))}
              </ul>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>{t.plan.length ? 'Außerdem empfohlen' : 'Heute empfohlen'}</h2>
              {t.budgetMinutes > 0 && (
                <span className={`budget budget-${t.budgetFit}`}>
                  {t.recommendedMinutes} / {t.budgetMinutes} min
                  {t.budgetFit === 'perfect' && ' · passt'}
                  {t.budgetFit === 'over' && (t.recommendedMinutes <= t.budgetMinutes * 1.2 ? ' · knapp drüber' : ' · über Budget')}
                </span>
              )}
            </div>
            {t.recommended.length === 0 ? (
              <Empty title={t.more.length ? (t.plan.length ? 'Budget durch deinen Plan ausgeschöpft' : 'Nichts passt ins Zeitbudget') : 'Alles gehört!'}>
                {t.more.length
                  ? 'Unten findest du weitere Folgen – oder erhöhe dein Budget in den Einstellungen.'
                  : syncing
                    ? 'Sobald der Import fertig ist, erscheinen hier deine Folgen.'
                    : 'Keine offenen Folgen. Zeit für etwas Neues?'}
              </Empty>
            ) : (
              <div className="card-list">
                {t.recommended.map((item) => (
                  <EpisodeCard key={item.episode.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            )}
          </section>

          {t.more.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Weitere Folgen</h2>
                <span className="muted small">außerhalb des Budgets</span>
              </div>
              <div className="card-list">
                {t.more.map((item) => (
                  <EpisodeCard key={item.episode.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            </section>
          )}

          {t.noNewEpisode.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Keine neue Folge</h2>
              </div>
              <div className="pill-list">
                {t.noNewEpisode.map((s) => (
                  <Link key={s.id} to={`/podcasts/${encodeURIComponent(s.id)}`} className="pill">
                    <Cover src={s.imageUrl} alt={s.name} size={28} />
                    <span>{s.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {t.recent.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Zuletzt gehört</h2>
                <Link to="/verlauf" className="small">
                  Alle
                </Link>
              </div>
              <ul className="simple-list">
                {t.recent.map((r) => (
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
