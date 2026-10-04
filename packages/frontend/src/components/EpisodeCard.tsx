import type { TodayItem } from '@podcast/shared';
import { useEpisodeActions } from '../lib/actions';
import { formatDuration, formatReleaseDate, TODAY_LABEL } from '../lib/format';
import { usePlayer, type PlayableItem } from '../lib/player';
import { Icon } from './Icon';
import { Badge, Cover, IconButton, Menu, ProgressBar, type BadgeTone } from './ui';

const LABEL_TONE: Record<TodayItem['label'], BadgeTone> = {
  NEU: 'new',
  WEITER: 'continue',
  NAECHSTE: 'next',
  GEWAEHLT: 'pinned',
};

export function PlayButton({
  item,
  compact,
  primary = true,
}: {
  item: PlayableItem;
  compact?: boolean;
  primary?: boolean;
}) {
  const player = usePlayer();
  const playing = player.nowPlaying?.episodeId === item.episode.id;
  const label = player.target.kind === 'app' ? 'In Spotify öffnen' : playing ? 'Läuft' : 'Abspielen';
  if (compact) {
    return (
      <IconButton
        icon={playing && !player.nowPlaying?.paused ? 'pause' : 'play'}
        label={label}
        variant={primary ? 'primary' : 'soft'}
        disabled={player.busy}
        onClick={() => (playing ? player.togglePause() : void player.play(item))}
      />
    );
  }
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={player.busy}
      onClick={() => (playing ? player.togglePause() : void player.play(item))}
    >
      <Icon name={player.target.kind === 'app' ? 'external' : playing && !player.nowPlaying?.paused ? 'pause' : 'play'} size={18} />
      {label}
    </button>
  );
}

export function EpisodeCard({ item, onOpen }: { item: TodayItem; onOpen: (showId: string, episodeId: string) => void }) {
  const { show, episode } = item;
  const actions = useEpisodeActions();
  const started = episode.status === 'IN_PROGRESS' && episode.remainingMs < episode.durationMs;
  const position =
    show.mode === 'SEQUENTIAL' || item.label === 'GEWAEHLT' ? `Folge ${episode.index} / ${show.total}` : null;

  return (
    <article className="card episode-card">
      <a
        className="episode-card-cover"
        href={`/podcasts/${encodeURIComponent(show.id)}`}
        onClick={(e) => {
          e.preventDefault();
          onOpen(show.id, episode.id);
        }}
        aria-label={`Details zu ${episode.name}`}
      >
        <Cover src={episode.imageUrl ?? show.imageUrl} alt={show.name} size={72} />
      </a>
      <div className="episode-card-body">
        <div className="episode-card-meta">
          <span className="show-name">{show.name}</span>
          <Badge tone={LABEL_TONE[item.label]}>{TODAY_LABEL[item.label]}</Badge>
          {position && <span className="muted small">{position}</span>}
        </div>
        <button type="button" className="episode-title linklike" onClick={() => onOpen(show.id, episode.id)}>
          {episode.name}
        </button>
        <div className="muted small">
          {formatReleaseDate(episode.releaseDate)} ·{' '}
          {started ? `noch ${formatDuration(episode.remainingMs)}` : formatDuration(episode.durationMs)}
        </div>
        {started && <ProgressBar value={episode.durationMs - episode.remainingMs} max={episode.durationMs} label="Fortschritt" />}
        <div className="episode-card-actions">
          <PlayButton item={{ show, episode }} />
          <IconButton icon="check" label="Als gehört markieren" variant="soft" onClick={() => actions.setStatus(episode, 'COMPLETED')} />
          <IconButton icon="skip" label="Überspringen" variant="soft" onClick={() => actions.setStatus(episode, 'SKIPPED')} />
          <Menu
            items={[
              { label: 'In Spotify öffnen', icon: 'external', href: episode.spotifyUrl },
              { label: 'Details', icon: 'list', onClick: () => onOpen(show.id, episode.id) },
              {
                label: 'Alle früheren als gehört',
                icon: 'check',
                onClick: () => actions.completeBefore(episode),
                hidden: show.mode !== 'SEQUENTIAL' || episode.index <= 1,
              },
            ]}
          />
        </div>
      </div>
    </article>
  );
}
