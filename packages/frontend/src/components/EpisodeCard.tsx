import { useTranslation } from 'react-i18next';
import type { TodayItem } from '@podcast/shared';
import { useEpisodeActions } from '../lib/actions';
import { cx } from '../lib/cx';
import { formatDuration, formatReleaseDate, todayLabel } from '../lib/format';
import { usePlayer, type PlayableItem } from '../lib/player';
import styles from './EpisodeCard.module.css';
import { Icon } from './Icon';
import { Badge, Cover, IconButton, Menu, ProgressBar, type BadgeTone } from './ui';
import { LISTEN_ON_SPOTIFY, PLAY_ON_SPOTIFY } from './SpotifyAttribution';

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
  const { t } = useTranslation('episode');
  const player = usePlayer();
  const np = player.nowPlaying;
  const playing = np?.episodeId === item.episode.id;
  // Playing outside the browser can't be paused from here, so it is only shown.
  if (playing && np.target.kind !== 'browser' && !np.paused) {
    const device = np.deviceName ?? (np.target.kind === 'device' ? np.target.name : undefined);
    const status = device ? t('play.playingOn', { device }) : t('play.playingInSpotify');
    return compact ? (
      <IconButton icon="device" label={status} variant={primary ? 'primary' : 'soft'} disabled />
    ) : (
      <button type="button" className={cx('btn btn-primary', styles.playingElsewhere)} title={status} disabled>
        <Icon name="device" size={18} />
        <span className="ellipsis">{status}</span>
      </button>
    );
  }
  // Only the browser player can be paused from here; paused elsewhere, the button plays again.
  const inBrowser = playing && np.target.kind === 'browser';
  const onClick = () => (inBrowser ? player.togglePause() : void player.play(item));
  // "PLAY ON SPOTIFY" stays in English, as the Spotify design guidelines give it.
  const label = player.target.kind === 'app' ? PLAY_ON_SPOTIFY : inBrowser ? t('play.playing') : t('play.play');
  if (compact) {
    return (
      <IconButton
        icon={inBrowser && !np.paused ? 'pause' : 'play'}
        label={label}
        variant={primary ? 'primary' : 'soft'}
        disabled={player.busy}
        onClick={onClick}
      />
    );
  }
  return (
    <button type="button" className="btn btn-primary" disabled={player.busy} onClick={onClick}>
      <Icon name={player.target.kind === 'app' ? 'external' : inBrowser && !np.paused ? 'pause' : 'play'} size={18} />
      {label}
    </button>
  );
}

export function EpisodeCard({
  item,
  onOpen,
}: {
  item: TodayItem;
  onOpen: (showId: string, episodeId: string) => void;
}) {
  const { t } = useTranslation('episode');
  const { show, episode } = item;
  const actions = useEpisodeActions();
  const started = episode.status === 'IN_PROGRESS' && episode.remainingMs < episode.durationMs;
  const position =
    show.mode === 'SEQUENTIAL' || item.label === 'GEWAEHLT'
      ? t('episode.ofTotal', { ns: 'common', index: episode.index, total: show.total })
      : null;

  return (
    <article className={cx('card', styles.card)}>
      <a
        href={`/podcasts/${encodeURIComponent(show.id)}`}
        onClick={(e) => {
          e.preventDefault();
          onOpen(show.id, episode.id);
        }}
        aria-label={t('card.details', { name: episode.name })}
      >
        <Cover src={episode.imageUrl ?? show.imageUrl} alt={show.name} size={72} />
      </a>
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className="show-name">{show.name}</span>
          <Badge tone={LABEL_TONE[item.label]}>{todayLabel(item.label)}</Badge>
          {position && <span className="muted small">{position}</span>}
        </div>
        <button type="button" className="episode-title linklike" onClick={() => onOpen(show.id, episode.id)}>
          {episode.name}
        </button>
        <div className="muted small">
          {formatReleaseDate(episode.releaseDate)} ·{' '}
          {started
            ? t('episode.remaining', { ns: 'common', time: formatDuration(episode.remainingMs) })
            : formatDuration(episode.durationMs)}
        </div>
        {started && (
          <ProgressBar
            value={episode.durationMs - episode.remainingMs}
            max={episode.durationMs}
            label={t('card.progress')}
          />
        )}
        <div className={styles.actions}>
          <PlayButton item={{ show, episode }} />
          <IconButton
            icon="check"
            label={t('episode.markPlayed', { ns: 'common' })}
            variant="soft"
            onClick={() => void actions.setStatus(episode, 'COMPLETED')}
          />
          <IconButton
            icon="skip"
            label={t('action.skip')}
            variant="soft"
            onClick={() => void actions.setStatus(episode, 'SKIPPED')}
          />
          <Menu
            items={[
              { label: LISTEN_ON_SPOTIFY, icon: 'external', href: episode.spotifyUrl },
              { label: t('action.details'), icon: 'list', onClick: () => onOpen(show.id, episode.id) },
              {
                label: t('action.completeBeforeMenu'),
                icon: 'check',
                onClick: () => void actions.completeBefore(episode),
                hidden: show.mode !== 'SEQUENTIAL' || episode.index <= 1,
              },
            ]}
          />
        </div>
      </div>
    </article>
  );
}
