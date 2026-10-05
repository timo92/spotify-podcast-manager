import type { PlannedItem } from '@podcast/shared';
import { useEpisodeActions } from '../lib/actions';
import { DAY_PART_LABEL, formatDuration } from '../lib/format';
import { PlayButton } from './EpisodeCard';
import { Icon } from './Icon';
import { Cover, IconButton } from './ui';

const STATE_TEXT: Partial<Record<PlannedItem['state'], string>> = {
  latest: 'Neueste Folge des Tages',
};

/** One slot of the weekly plan with its concrete episode. */
export function PlanItemRow({
  item,
  isToday,
  onOpen,
  onRemove,
}: {
  item: PlannedItem;
  isToday: boolean;
  onOpen: (showId: string, episodeId: string) => void;
  onRemove?: () => void;
}) {
  const actions = useEpisodeActions();
  const ep = item.episode;
  const done = item.state === 'done';
  const open = ep && (item.state === 'next' || item.state === 'upcoming');
  const started = ep && ep.remainingMs < ep.durationMs && !done;
  const emptyText =
    STATE_TEXT[item.state] ?? (item.show.mode === 'MANUAL' ? 'Keine Folge gewählt' : 'Alles gehört 🎉');

  return (
    <li className={`plan-item${done ? ' is-done' : ''}`}>
      <span className="plan-part">{DAY_PART_LABEL[item.part]}</span>
      <Cover src={ep?.imageUrl ?? item.show.imageUrl} alt={item.show.name} size={44} />
      <div className="plan-item-body">
        <span className="show-name">{item.show.name}</span>
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
      <div className="plan-item-actions">
        {done && (
          <span className="done-check" title="Heute gehört">
            <Icon name="check" size={18} />
          </span>
        )}
        {open && <PlayButton item={{ show: item.show, episode: ep }} compact primary={isToday && item.state === 'next'} />}
        {open && isToday && item.state === 'next' && (
          <IconButton icon="check" label="Als gehört markieren" onClick={() => actions.setStatus(ep, 'COMPLETED')} />
        )}
        {onRemove && <IconButton icon="close" label="Aus dem Wochenplan entfernen" onClick={onRemove} />}
      </div>
    </li>
  );
}
