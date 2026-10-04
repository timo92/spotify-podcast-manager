import type { EpisodeView, Show } from '@podcast/shared';
import { useEpisodeActions } from '../lib/actions';
import { formatDuration, formatReleaseDate } from '../lib/format';
import { PlayButton } from './EpisodeCard';
import { Icon } from './Icon';
import { Badge, IconButton, Menu, StatusBadge } from './ui';

export function EpisodeRow({
  show,
  episode,
  isNext,
  onOpen,
}: {
  show: Show;
  episode: EpisodeView;
  isNext: boolean;
  onOpen: (episodeId: string) => void;
}) {
  const actions = useEpisodeActions();
  const done = episode.status === 'COMPLETED';
  const pinned = show.pinnedEpisodeId === episode.id;
  return (
    <li className={`episode-row${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`}>
      <span className="episode-index">{episode.index}</span>
      <div className="episode-row-main">
        <button type="button" className="episode-title linklike" onClick={() => onOpen(episode.id)}>
          {episode.name}
        </button>
        <div className="episode-row-meta muted small">
          <span>{formatReleaseDate(episode.releaseDate)}</span>
          <span>{formatDuration(episode.durationMs)}</span>
          {(episode.status !== 'UNSEEN' || episode.isNew) && <StatusBadge status={episode.status} isNew={episode.isNew} />}
          {isNext && <Badge tone="next">Als Nächstes</Badge>}
          {pinned && <Badge tone="pinned">Gewählt</Badge>}
          {episode.statusSource === 'spotify' && <span title="Status stammt aus Spotify">· Spotify</span>}
          {episode.hasNote && (
            <button type="button" className="note-flag" onClick={() => onOpen(episode.id)} title="Notiz vorhanden">
              <Icon name="note" size={14} /> Notiz
            </button>
          )}
        </div>
      </div>
      <div className="episode-row-actions">
        <PlayButton item={{ show, episode }} compact primary={isNext} />
        <IconButton
          icon="check"
          label={done ? 'Als ungehört markieren' : 'Als gehört markieren'}
          active={done}
          onClick={() => actions.setStatus(episode, done ? 'UNSEEN' : 'COMPLETED')}
        />
        <Menu
          items={[
            { label: 'Überspringen', icon: 'skip', onClick: () => actions.setStatus(episode, 'SKIPPED'), hidden: episode.status === 'SKIPPED' },
            { label: 'Als ungehört markieren', icon: 'undo', onClick: () => actions.setStatus(episode, 'UNSEEN'), hidden: episode.status === 'UNSEEN' },
            {
              label: pinned ? 'Auswahl aufheben' : 'Als nächste Folge festlegen',
              icon: 'pin',
              onClick: () => actions.pin(show.id, pinned ? null : episode.id, show.pinnedEpisodeId),
            },
            { label: 'Alle früheren als gehört', icon: 'check', onClick: () => actions.completeBefore(episode), hidden: episode.index <= 1 },
            { label: 'Status zurücksetzen (Spotify)', icon: 'refresh', onClick: () => actions.resetStatus(episode), hidden: episode.statusSource !== 'local' },
            { label: 'In Spotify öffnen', icon: 'external', href: episode.spotifyUrl },
          ]}
        />
      </div>
    </li>
  );
}
