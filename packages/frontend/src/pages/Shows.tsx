import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { ConsumptionMode, Show } from '@podcast/shared';
import { Icon } from '../components/Icon';
import { SpotifyAttribution } from '../components/SpotifyAttribution';
import { Badge, Chip, Cover, Empty, ErrorBox, IconButton, ProgressBar, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatRelative, MODE_HINT, MODE_LABEL } from '../lib/format';
import { qk, useInvalidateLibrary, useSettings } from '../lib/queries';
import { useToast } from '../lib/toast';

export const MODE_OPTIONS: { value: ConsumptionMode; label: string; hint: string }[] = (
  ['LATEST', 'SEQUENTIAL', 'MANUAL'] as ConsumptionMode[]
).map((m) => ({ value: m, label: MODE_LABEL[m], hint: MODE_HINT[m] }));

export function progressText(show: Show): { text: string; tone?: 'new' | 'muted' } {
  const s = show.summary;
  if (!s || s.total === 0) return { text: 'Noch keine Folgen', tone: 'muted' };
  const next = s.nextEpisode;
  if (show.pinnedEpisodeId && next?.id === show.pinnedEpisodeId) return { text: `Gewählt: Folge ${next.index} / ${s.total}` };
  switch (show.mode) {
    case 'LATEST':
      if (!next) return { text: 'Keine neue Folge', tone: 'muted' };
      return next.isNew ? { text: '● Neue Folge verfügbar', tone: 'new' } : { text: 'Neueste Folge offen' };
    case 'SEQUENTIAL':
      if (!next) return { text: `Alle ${s.total} Folgen erledigt`, tone: 'muted' };
      return { text: `Folge ${next.index} / ${s.total}` };
    default:
      return { text: 'Keine Folge gewählt', tone: 'muted' };
  }
}

export function ShowsPage() {
  const shows = useQuery({ queryKey: qk.shows, queryFn: api.shows });
  const { data: settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const reviewMode = params.get('pruefen') === '1';
  const [filter, setFilter] = useState<string>('alle');
  const [reorder, setReorder] = useState(false);
  const [order, setOrder] = useState<Show[] | null>(null);
  const invalidate = useInvalidateLibrary();
  const toast = useToast();

  useEffect(() => {
    if (!reorder) setOrder(null);
  }, [reorder]);

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
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    try {
      await api.reorder(next.map((s) => s.id));
      await invalidate();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  async function confirmAll() {
    try {
      await Promise.all(visible.map((s) => api.updateShow(s.id, { needsReview: false })));
      await invalidate();
      setParams({});
      toast({ message: 'Alle Podcasts bestätigt', tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>{reviewMode ? 'Podcasts einordnen' : 'Meine Podcasts'}</h1>
          <p className="muted">
            {reviewMode
              ? 'Wähle pro Podcast, ob du immer die neueste Folge hörst oder ihn der Reihe nach durcharbeitest.'
              : `${(shows.data ?? []).filter((s) => s.followed).length} Podcasts aus deiner Spotify-Bibliothek`}
          </p>
          <SpotifyAttribution on="page" />
        </div>
        {!reviewMode && (
          <button type="button" className={`btn btn-small${reorder ? ' btn-primary' : ''}`} onClick={() => setReorder((r) => !r)}>
            <Icon name="sort" size={18} /> {reorder ? 'Fertig' : 'Priorität'}
          </button>
        )}
      </header>

      {!reviewMode && reviewCount > 0 && (
        <div className="banner banner-info">
          <span>
            {reviewCount} {reviewCount === 1 ? 'neuer Podcast' : 'neue Podcasts'} – Modus und Kategorie wurden geraten.
          </span>
          <Link className="btn btn-small" to="?pruefen=1">
            Prüfen
          </Link>
        </div>
      )}
      {reviewMode && (
        <div className="row gap">
          <button className="btn btn-primary" onClick={() => void confirmAll()} disabled={!visible.length}>
            <Icon name="check" size={18} /> Alle bestätigen
          </button>
          <Link className="btn" to="/podcasts">
            Zurück
          </Link>
        </div>
      )}
      {reorder && <p className="muted small">Höhere Priorität = weiter oben auf „Heute“ und zuerst im Zeitbudget.</p>}

      {!reviewMode && !reorder && (
        <div className="chips" role="toolbar" aria-label="Filter">
          <Chip active={filter === 'alle'} onClick={() => setFilter('alle')}>
            Alle
          </Chip>
          {categoryCounts.map(([c, n]) => (
            <Chip key={c} active={filter === c} onClick={() => setFilter(c)} count={n}>
              {c}
            </Chip>
          ))}
          <Chip active={filter === 'pausiert'} onClick={() => setFilter('pausiert')}>
            Pausiert
          </Chip>
          {(shows.data ?? []).some((s) => !s.followed) && (
            <Chip active={filter === 'entfolgt'} onClick={() => setFilter('entfolgt')}>
              Nicht mehr gefolgt
            </Chip>
          )}
        </div>
      )}

      {shows.isLoading && <Spinner />}
      {shows.error && <ErrorBox error={shows.error} onRetry={() => void shows.refetch()} />}
      {shows.data && visible.length === 0 && (
        <Empty title={reviewMode ? 'Alles eingeordnet' : 'Keine Podcasts'}>
          {reviewMode ? (
            <Link to="/podcasts">Zur Übersicht</Link>
          ) : (
            'Folge Podcasts in Spotify und synchronisiere – sie erscheinen dann hier.'
          )}
        </Empty>
      )}

      <div className="card-list">
        {visible.map((show, i) =>
          reviewMode ? (
            <ReviewCard key={show.id} show={show} categories={settings?.categories ?? []} />
          ) : (
            <div key={show.id} className="show-row-wrap">
              {reorder && (
                <div className="reorder">
                  <IconButton icon="up" label="Nach oben" onClick={() => void move(i, -1)} disabled={i === 0} />
                  <IconButton icon="down" label="Nach unten" onClick={() => void move(i, 1)} disabled={i === visible.length - 1} />
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
  const s = show.summary;
  const progress = progressText(show);
  return (
    <Link to={`/podcasts/${encodeURIComponent(show.id)}`} className="card show-card">
      {rank !== undefined && <span className="rank">{rank}</span>}
      <Cover src={show.imageUrl} alt={show.name} size={64} />
      <div className="show-card-body">
        <div className="show-card-title">
          <strong>{show.name}</strong>
          {s && s.newCount > 0 && <Badge tone="new">{s.newCount} neu</Badge>}
          {show.paused && <Badge tone="muted">Pausiert</Badge>}
          {show.hiddenFromToday && <Badge tone="muted">Nicht auf Heute</Badge>}
          {show.needsReview && <Badge tone="warn">Prüfen</Badge>}
        </div>
        <div className="muted small">
          {MODE_LABEL[show.mode]}
          {show.categories.length > 0 && ` · ${show.categories.join(', ')}`}
        </div>
        <div className={`small ${progress.tone === 'new' ? 'text-new' : progress.tone === 'muted' ? 'muted' : ''}`}>
          {progress.text}
        </div>
        {s?.nextEpisode && (
          <div className="small ellipsis">
            <span className="muted">Als Nächstes: </span>
            {s.nextEpisode.name}
          </div>
        )}
        {s?.lastCompleted && (
          <div className="small ellipsis muted">
            Zuletzt gehört: {s.lastCompleted.name}
            {s.lastCompleted.at && ` · ${formatRelative(s.lastCompleted.at)}`}
          </div>
        )}
        {show.mode === 'SEQUENTIAL' && s && s.total > 0 && (
          <ProgressBar value={s.completed + s.skipped} max={s.total} label="Fortschritt" />
        )}
        <div className="muted tiny">
          Sync {formatRelative(show.lastSyncedAt)}
          {show.lastSyncError && <span className="text-error"> · Fehler beim letzten Sync</span>}
        </div>
      </div>
    </Link>
  );
}

function ReviewCard({ show, categories }: { show: Show; categories: string[] }) {
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  const [mode, setMode] = useState(show.mode);
  const [cats, setCats] = useState(show.categories);

  async function save(patch: Parameters<typeof api.updateShow>[1]) {
    try {
      await api.updateShow(show.id, patch);
      await invalidate();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  return (
    <div className="card review-card">
      <div className="row gap">
        <Cover src={show.imageUrl} alt={show.name} size={56} />
        <div className="grow">
          <strong>{show.name}</strong>
          <div className="muted small">{show.summary?.total ?? 0} Folgen</div>
        </div>
      </div>
      <Segmented
        label="Modus"
        value={mode}
        options={MODE_OPTIONS}
        onChange={(m) => {
          setMode(m);
          void save({ mode: m });
        }}
      />
      <div className="muted small">{MODE_HINT[mode]}</div>
      <div className="chips">
        {categories.map((c) => (
          <Chip
            key={c}
            active={cats.includes(c)}
            onClick={() => {
              const next = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
              setCats(next);
              void save({ categories: next });
            }}
          >
            {c}
          </Chip>
        ))}
      </div>
      <div className="row gap">
        <button className="btn btn-primary btn-small" onClick={() => void save({ needsReview: false })}>
          <Icon name="check" size={16} /> Passt
        </button>
        <button className="btn btn-small" onClick={() => void save({ needsReview: false, hiddenFromToday: true })}>
          Nicht auf „Heute“
        </button>
      </div>
    </div>
  );
}
