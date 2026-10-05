import { useState, type ReactNode } from 'react';
import type { PlannedItem } from '@podcast/shared';
import { Link } from 'react-router-dom';
import { useEpisodeActions } from '../lib/actions';
import { cx } from '../lib/cx';
import { DAY_PART_LABEL, formatDuration } from '../lib/format';
import { PlayButton } from './EpisodeCard';
import { EpisodePickerSheet } from './EpisodePicker';
import { Icon } from './Icon';
import styles from './PlanItem.module.css';
import { Cover, IconButton } from './ui';

const STATE_TEXT: Partial<Record<PlannedItem['state'], string>> = {
  latest: 'Neueste Folge des Tages',
};

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
  const actions = useEpisodeActions();
  const [picking, setPicking] = useState(false);
  const ep = item.episode;
  // A manual podcast without a chosen episode: offer the choice right here.
  const canPick = !ep && item.show.mode === 'MANUAL';
  const done = item.state === 'done';
  const open = ep && (item.state === 'next' || item.state === 'upcoming');
  const started = ep && ep.remainingMs < ep.durationMs && !done;
  const showPath = `/podcasts/${encodeURIComponent(item.show.id)}`;
  const emptyText =
    STATE_TEXT[item.state] ?? (item.show.mode === 'MANUAL' ? 'Keine Folge gewählt' : 'Alles gehört 🎉');

  return (
    <li className={cx(styles.item, done && styles.isDone)}>
      <span className={styles.part}>{DAY_PART_LABEL[item.part]}</span>
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
            {item.show.mode === 'SEQUENTIAL' && `Folge ${ep.index} · `}
            {done ? 'gehört' : started ? `noch ${formatDuration(ep.remainingMs)}` : formatDuration(ep.durationMs)}
            {item.state === 'upcoming' && ' · voraussichtlich'}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        {done && (
          <span className={styles.doneCheck} title="Heute gehört">
            <Icon name="check" size={18} />
          </span>
        )}
        {open && <PlayButton item={{ show: item.show, episode: ep }} compact primary={isToday && item.state === 'next'} />}
        {open && isToday && item.state === 'next' && (
          <IconButton icon="check" label="Als gehört markieren" onClick={() => actions.setStatus(ep, 'COMPLETED')} />
        )}
        {canPick && (
          <button type="button" className="btn btn-small" onClick={() => setPicking(true)}>
            Folge wählen
          </button>
        )}
        {onEdit && <IconButton icon="note" label="Termin bearbeiten" onClick={onEdit} />}
        {onRemove && <IconButton icon="close" label="Aus dem Wochenplan entfernen" onClick={onRemove} />}
      </div>
      {picking && <EpisodePickerSheet show={item.show} onClose={() => setPicking(false)} />}
    </li>
  );
}
