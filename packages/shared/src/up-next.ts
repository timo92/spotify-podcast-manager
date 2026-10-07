import type { TodayResponse } from './types.js';

/** An episode by its show and id. */
export interface EpisodeRef {
  showId: string;
  episodeId: string;
}

/** Most items Spotify takes in one replace of a playlist's content. */
export const UP_NEXT_MAX = 100;

/**
 * The content of the "Up next" playlist, built from Today as it is now:
 * `first` (the episode being started, or the one playing), then today's open
 * plan slots in their order, the suggestions within the budget and the further
 * ones. Paused podcasts, unplayable and repeated episodes are left out.
 */
export function upNextItems(
  today: Pick<TodayResponse, 'plan' | 'recommended' | 'more'>,
  first?: EpisodeRef,
): EpisodeRef[] {
  const planned = today.plan.flatMap((slot) =>
    slot.episode && !slot.paused && (slot.state === 'next' || slot.state === 'upcoming')
      ? [{ show: slot.show, episode: slot.episode }]
      : [],
  );
  const candidates = [
    ...(first ? [first] : []),
    ...[...planned, ...today.recommended, ...today.more]
      .filter((item) => item.episode.isPlayable !== false)
      .map((item) => ({ showId: item.show.id, episodeId: item.episode.id })),
  ];
  const seen = new Set<string>();
  const items: EpisodeRef[] = [];
  for (const ref of candidates) {
    if (seen.has(ref.episodeId)) continue;
    seen.add(ref.episodeId);
    items.push(ref);
  }
  return items.slice(0, UP_NEXT_MAX);
}
