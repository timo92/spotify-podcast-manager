import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlannedItem } from '@podcast/shared';
import { Link } from 'react-router-dom';
import { useEpisodeActions } from '../lib/actions';
import { cx } from '../lib/cx';
import { dayPartLabel, formatDuration, formatReleaseDate } from '../lib/format';
import { PlayButton } from './EpisodeCard';
import { EpisodePickerSheet } from './EpisodePicker';
import { Icon } from './Icon';
import styles from './PlanItem.module.css';
import { Cover, IconButton } from './ui';

/** The list holding PlanItemRows; `card` puts it on a card of its own. */
export function PlanList({ card, children }: { card?: boolean; children: ReactNode }) {
  return <ul className={cx(styles.list, card && 'card', card && styles.inCard)}>{children}</ul>;
}

/** One slot of the weekly plan with its concrete episode. */
export function PlanItemRow({
  item,
  isToday,
  onOpen,
  onEdit,
  onRemove,
}: {
  item: PlannedItem;
  isToday: boolean;
  onOpen: (showId: string, episodeId: string) => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation('plan');
  const actions = useEpisodeActions();
  const [picking, setPicking] = useState(false);
  const ep = item.episode;
  // A manual podcast without a chosen episode: offer the choice right here.
  const canPick = !ep && item.show.mode === 'MANUAL';
  const done = item.state === 'done';
  // A paused podcast keeps its slot, shown dimmed and without play actions.
  const open = ep && !item.paused && (item.state === 'next' || item.state === 'upcoming');
  const started = ep && ep.remainingMs < ep.durationMs && !done;
  const showPath = `/podcasts/${encodeURIComponent(item.show.id)}`;
  const emptyText =
    item.state === 'latest'
      ? t('slot.latest')
      : item.show.mode === 'MANUAL'
        ? t('slot.noneChosen')
        : t('slot.allHeard');

  return (
    <li className={cx(styles.item, done && styles.isDone, item.paused && styles.isPaused)}>
      <span className={styles.part}>{dayPartLabel(item.part)}</span>
      {/* Same target as the name; hidden from assistive tech and the tab order to avoid a duplicate link. */}
      <Link to={showPath} className={styles.cover} tabIndex={-1} aria-hidden>
        <Cover src={ep?.imageUrl ?? item.show.imageUrl} alt={item.show.name} size={44} />
      </Link>
      <div className={styles.body}>
        <Link to={showPath} className="show-name">
          {item.show.name}
        </Link>
        {ep ? (
          <button type="button" className="episode-title linklike" onClick={() => onOpen(item.show.id, ep.id)}>
            {ep.name}
          </button>
        ) : (
          <span className="muted small">{emptyText}</span>
        )}
        {ep && (
          <span className="muted tiny">
            {item.show.mode === 'SEQUENTIAL' && `${t('episode.number', { ns: 'common', index: ep.index })} · `}
            {formatReleaseDate(ep.releaseDate)} ·{' '}
            {done
              ? t('slot.heard')
              : started
                ? t('episode.remaining', { ns: 'common', time: formatDuration(ep.remainingMs) })
                : formatDuration(ep.durationMs)}
            {item.state === 'upcoming' && ` · ${t('slot.expected')}`}
          </span>
        )}
        {item.paused && <span className="muted tiny">{t('ui.paused', { ns: 'common' })}</span>}
      </div>
      <div className={styles.actions}>
        {done && (
          <span className={styles.doneCheck} title={t('slot.heardToday')}>
            <Icon name="check" size={18} />
          </span>
        )}
        {open && (
          <PlayButton item={{ show: item.show, episode: ep }} compact primary={isToday && item.state === 'next'} />
        )}
        {open && isToday && item.state === 'next' && (
          <IconButton
            icon="check"
            label={t('episode.markPlayed', { ns: 'common' })}
            onClick={() => void actions.setStatus(ep, 'COMPLETED')}
          />
        )}
        {canPick && (
          <button type="button" className="btn btn-small" onClick={() => setPicking(true)}>
            {t('slot.pick')}
          </button>
        )}
        {onEdit && <IconButton icon="note" label={t('slot.edit')} onClick={onEdit} />}
        {onRemove && <IconButton icon="close" label={t('slot.remove')} onClick={onRemove} />}
      </div>
      {picking && <EpisodePickerSheet show={item.show} onClose={() => setPicking(false)} />}
    </li>
  );
}
