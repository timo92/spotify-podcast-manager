import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { EpisodeView, ShowSettingsPatch } from '@podcast/shared';
import { PlayButton } from '../components/EpisodeCard';
import { EpisodeRow } from '../components/EpisodeRow';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { Icon } from '../components/Icon';
import { ListenOnSpotify, SpotifyAttribution } from '../components/SpotifyAttribution';
import { Badge, Chip, Cover, Empty, ErrorBox, ProgressBar, Segmented, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { formatDeletionDate, formatDuration, formatRelative, formatReleaseDate, MODE_HINT } from '../lib/format';
import { qk, useInvalidateLibrary, useSettings } from '../lib/queries';
import { useToast } from '../lib/toast';
import { MODE_OPTIONS, progressText } from './Shows';

type Filter = 'alle' | 'ungehoert' | 'gehoert' | 'uebersprungen' | 'neu' | 'begonnen';

const FILTERS: { value: Filter; label: string; test: (e: EpisodeView) => boolean }[] = [
  { value: 'alle', label: 'Alle', test: () => true },
  { value: 'ungehoert', label: 'Ungehört', test: (e) => e.status === 'UNSEEN' || e.status === 'IN_PROGRESS' },
  { value: 'neu', label: 'Neu', test: (e) => e.isNew },
  { value: 'begonnen', label: 'Begonnen', test: (e) => e.status === 'IN_PROGRESS' },
  { value: 'gehoert', label: 'Gehört', test: (e) => e.status === 'COMPLETED' },
  { value: 'uebersprungen', label: 'Übersprungen', test: (e) => e.status === 'SKIPPED' },
];

const PAGE = 60;

export function ShowDetailPage() {
  const { id = '' } = useParams();
  const detail = useQuery({ queryKey: qk.show(id), queryFn: () => api.show(id) });
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
    const f = FILTERS.find((x) => x.value === filter)!;
    const q = query.trim().toLowerCase();
    const list = all.filter((e) => f.test(e) && (!q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)));
    return asc ? list : [...list].reverse();
  }, [detail.data, filter, query, asc]);

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !show) return <ErrorBox error={detail.error ?? 'Nicht gefunden'} onRetry={() => void detail.refetch()} />;

  const s = show.summary;
  const next = s?.nextEpisode ?? null;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, detail.data!.episodes.filter(f.test).length]));

  async function update(patch: ShowSettingsPatch) {
    try {
      const updated = await api.updateShow(show!.id, patch);
      qc.setQueryData(qk.show(show!.id), (old: typeof detail.data) => (old ? { ...old, show: updated } : old));
      await invalidate();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  const categories = [...new Set([...(settings?.categories ?? []), ...show.categories])];

  return (
    <div className="page">
      <Link to="/podcasts" className="back-link">
        <Icon name="back" size={18} /> Podcasts
      </Link>

      <header className="show-hero">
        <Cover src={show.imageUrl} alt={show.name} size={120} />
        <div className="show-hero-text">
          <h1>{show.name}</h1>
          {show.publisher && <div className="muted">{show.publisher}</div>}
          <div className="badges">
            {!show.followed && (
              <Badge tone="warn">
                Nicht mehr in deiner Spotify-Bibliothek
                {show.unfollowedAt && ` – wird am ${formatDeletionDate(show.unfollowedAt)} entfernt`}
              </Badge>
            )}
            {show.paused && <Badge tone="muted">Pausiert</Badge>}
            {s && s.newCount > 0 && <Badge tone="new">{s.newCount} neu</Badge>}
          </div>
          <div className="row gap wrap">
            <ListenOnSpotify href={show.spotifyUrl} small />
            <button
              className="btn btn-small"
              onClick={() =>
                api
                  .syncShow(show.id)
                  .then(() => {
                    toast({ message: 'Folgen werden neu geladen…' });
                    return qc.invalidateQueries({ queryKey: qk.status });
                  })
                  .catch((e: Error) => toast({ message: e.message, tone: 'error' }))
              }
            >
              <Icon name="refresh" size={16} /> Neu laden
            </button>
          </div>
          <SpotifyAttribution href={show.spotifyUrl} on="page" />
        </div>
      </header>

      {show.description && (
        <p className={`description${showDescription ? '' : ' clamp'}`} onClick={() => setShowDescription((v) => !v)}>
          {show.description}
        </p>
      )}

      {next && (
        <section className="card next-card">
          <div className="muted small">{show.mode === 'LATEST' ? 'Neueste Folge' : 'Als Nächstes'}</div>
          <button type="button" className="episode-title linklike" onClick={() => setOpenEpisode(next.id)}>
            {next.name}
          </button>
          <div className="muted small">
            Folge {next.index} · {formatReleaseDate(next.releaseDate)} · {formatDuration(next.remainingMs)}
            {next.remainingMs < next.durationMs && ' übrig'}
          </div>
          <div className="row gap">
            <PlayButton item={{ show, episode: next }} />
          </div>
        </section>
      )}

      <section className="card settings-card">
        <h2 className="h3">Einordnung</h2>
        <Segmented label="Modus" value={show.mode} options={MODE_OPTIONS} onChange={(mode) => void update({ mode })} />
        <p className="muted small">{MODE_HINT[show.mode]}</p>
        <div className="chips">
          {categories.map((c) => (
            <Chip
              key={c}
              active={show.categories.includes(c)}
              onClick={() =>
                void update({
                  categories: show.categories.includes(c) ? show.categories.filter((x) => x !== c) : [...show.categories, c],
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
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="+ Kategorie" aria-label="Neue Kategorie" />
          </form>
        </div>
        <Toggle label="Pausieren" hint="Vorübergehend nicht auf „Heute“ vorschlagen" checked={show.paused} onChange={(paused) => void update({ paused })} />
        <Toggle
          label="Nicht auf „Heute“ anzeigen"
          hint="Bleibt in der Übersicht, wird aber nie vorgeschlagen"
          checked={show.hiddenFromToday}
          onChange={(hiddenFromToday) => void update({ hiddenFromToday })}
        />
        {show.mode === 'SEQUENTIAL' && (
          <Toggle
            label="Übersprungene erneut anbieten"
            hint="Wenn alles andere gehört ist"
            checked={show.reofferSkipped}
            onChange={(reofferSkipped) => void update({ reofferSkipped })}
          />
        )}
        {show.needsReview && (
          <button className="btn btn-primary btn-small" onClick={() => void update({ needsReview: false })}>
            <Icon name="check" size={16} /> Einordnung bestätigen
          </button>
        )}
      </section>

      {s && s.total > 0 && (
        <section className="stack-sm">
          <div className="row-between small">
            <strong>{progressText(show).text}</strong>
            <span className="muted">
              {s.completed} gehört · {s.skipped} übersprungen · {s.unseen + s.inProgress} offen
            </span>
          </div>
          <ProgressBar value={s.completed + s.skipped} max={s.total} label="Fortschritt" />
          <div className="muted tiny">Synchronisiert {formatRelative(show.lastSyncedAt)}</div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Folgen</h2>
          <button className="btn btn-small" onClick={() => setSortAsc(!asc)} aria-label="Sortierung umkehren">
            <Icon name="sort" size={16} /> {asc ? 'Älteste zuerst' : 'Neueste zuerst'}
          </button>
        </div>
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Folgen durchsuchen"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
        <div className="chips" role="toolbar" aria-label="Filter">
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
              {f.label}
            </Chip>
          ))}
        </div>
        {episodes.length === 0 ? (
          <Empty title="Keine Folgen gefunden" />
        ) : (
          <ul className="episode-list">
            {episodes.slice(0, limit).map((e) => (
              <EpisodeRow key={e.id} show={show} episode={e} isNext={next?.id === e.id} onOpen={setOpenEpisode} />
            ))}
          </ul>
        )}
        {episodes.length > limit && (
          <button className="btn btn-block" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Weitere {Math.min(PAGE * 2, episodes.length - limit)} von {episodes.length - limit} anzeigen
          </button>
        )}
      </section>

      {openEpisode && <EpisodeSheet showId={show.id} episodeId={openEpisode} onClose={() => setOpenEpisode(null)} />}
    </div>
  );
}
