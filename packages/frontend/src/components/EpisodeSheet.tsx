import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useEpisodeActions } from '../lib/actions';
import { formatDateTime, formatDuration, formatReleaseDate } from '../lib/format';
import { usePlayer, type PlayableItem } from '../lib/player';
import { qk } from '../lib/queries';
import { PlayButton } from './EpisodeCard';
import { Icon } from './Icon';
import { NoteEditor } from './Notes';
import { Badge, Cover, ErrorBox, IconButton, ProgressBar, Spinner, StatusBadge } from './ui';

/** Modal with the full episode: description, status and all actions. */
export function EpisodeSheet({ showId, episodeId, onClose }: { showId: string; episodeId: string; onClose: () => void }) {
  const actions = useEpisodeActions();
  const episode = useQuery({ queryKey: qk.episode(showId, episodeId), queryFn: () => api.episode(showId, episodeId) });
  const show = useQuery({ queryKey: qk.show(showId), queryFn: () => api.show(showId) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  const ep = episode.data;
  const s = show.data?.show;
  const pinned = s?.pinnedEpisodeId === episodeId;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Folge" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>
        {episode.isLoading && <Spinner />}
        {episode.error && <ErrorBox error={episode.error} />}
        {ep && (
          <>
            <div className="sheet-hero">
              <Cover src={ep.imageUrl ?? s?.imageUrl} alt={s?.name ?? ''} size={96} />
              <div>
                {s && (
                  <Link to={`/podcasts/${encodeURIComponent(s.id)}`} className="show-name" onClick={onClose}>
                    {s.name}
                  </Link>
                )}
                <h2 className="sheet-title">{ep.name}</h2>
                <div className="muted small">
                  Folge {ep.index} · {formatReleaseDate(ep.releaseDate)} · {formatDuration(ep.durationMs)}
                </div>
                <div className="badges">
                  <StatusBadge status={ep.status} isNew={ep.isNew} />
                  {pinned && <Badge tone="pinned">Als nächste gewählt</Badge>}
                  {ep.statusSource === 'spotify' && <Badge tone="muted">Status aus Spotify</Badge>}
                </div>
              </div>
            </div>
            {ep.remainingMs < ep.durationMs && ep.status !== 'COMPLETED' && (
              <div className="stack-sm">
                <ProgressBar value={ep.durationMs - ep.remainingMs} max={ep.durationMs} label="Fortschritt in Spotify" />
                <span className="muted small">
                  {Math.round(((ep.durationMs - ep.remainingMs) / ep.durationMs) * 100)} % gehört · noch{' '}
                  {formatDuration(ep.remainingMs)}
                </span>
              </div>
            )}
            {ep.listenedAt && <p className="muted small">Gehört am {formatDateTime(ep.listenedAt)}</p>}
            {ep.skippedAt && ep.status === 'SKIPPED' && (
              <p className="muted small">Übersprungen am {formatDateTime(ep.skippedAt)}</p>
            )}

            <div className="sheet-actions">
              {s && <PlayButton item={{ show: s, episode: ep }} />}
              {ep.remainingMs < ep.durationMs && s && <PlayFromStart item={{ show: s, episode: ep }} />}
              <a className="btn" href={ep.spotifyUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={18} /> Spotify
              </a>
            </div>
            <div className="sheet-actions">
              {ep.status !== 'COMPLETED' ? (
                <button className="btn" onClick={() => actions.setStatus(ep, 'COMPLETED')}>
                  <Icon name="check" size={18} /> Gehört
                </button>
              ) : (
                <button className="btn" onClick={() => actions.setStatus(ep, 'UNSEEN')}>
                  <Icon name="undo" size={18} /> Ungehört
                </button>
              )}
              {ep.status !== 'SKIPPED' && (
                <button className="btn" onClick={() => actions.setStatus(ep, 'SKIPPED')}>
                  <Icon name="skip" size={18} /> Überspringen
                </button>
              )}
              {s && (
                <button className="btn" onClick={() => actions.pin(s.id, pinned ? null : ep.id, s.pinnedEpisodeId)}>
                  <Icon name="pin" size={18} /> {pinned ? 'Auswahl aufheben' : 'Als nächste'}
                </button>
              )}
              {ep.index > 1 && (
                <button className="btn" onClick={() => actions.completeBefore(ep)}>
                  Alle früheren gehört
                </button>
              )}
            </div>
            <section className="stack-sm">
              <h3 className="h3">Notizen</h3>
              <NoteEditor showId={showId} episodeId={episodeId} />
            </section>
            {ep.description && <p className="description">{ep.description}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** Spotify resumes automatically; this restarts from the beginning instead. */
function PlayFromStart({ item }: { item: PlayableItem }) {
  const player = usePlayer();
  if (player.target.kind === 'app') return null;
  return (
    <button className="btn" disabled={player.busy} onClick={() => void player.play(item, { fromStart: true })}>
      <Icon name="rewind" size={18} /> Von vorne
    </button>
  );
}
