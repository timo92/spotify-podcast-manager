import { describe, expect, it } from 'vitest';
import { buildEpisodeViews } from '../src/logic.js';
import { DEFAULT_SETTINGS, type EpisodeView, type PlannedItem, type ShowLite, type TodayItem } from '../src/types.js';
import { UP_NEXT_MAX, upNextItems } from '../src/up-next.js';

const now = new Date('2026-10-05T08:00:00Z');

function views(showId: string, n: number): EpisodeView[] {
  const episodes = Array.from({ length: n }, (_, i) => ({
    id: `${showId}-${i + 1}`,
    showId,
    name: `${showId} ${i + 1}`,
    description: '',
    releaseDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
    durationMs: 30 * 60_000,
    spotifyUrl: '',
    firstSeenAt: '',
    lastSyncedAt: '',
  }));
  return buildEpisodeViews(episodes, new Map(), DEFAULT_SETTINGS, now);
}

const show = (id: string): ShowLite => ({ id, name: id, mode: 'SEQUENTIAL', categories: [], total: 1 });
const item = (episode: EpisodeView): TodayItem => ({ show: show(episode.showId), episode, label: 'NAECHSTE' });
function slot(episode: EpisodeView | null, state: PlannedItem['state'], paused = false): PlannedItem {
  return { ruleId: 'r', part: 'MORNING', show: show(episode?.showId ?? 'none'), episode, state, paused };
}

describe('upNextItems', () => {
  const [a1, a2] = views('a', 2);
  const [b1] = views('b', 1);
  const [c1] = views('c', 1);
  const [d1] = views('d', 1);

  it('lists open plan slots, then the suggestions within the budget, then the further ones', () => {
    const today = {
      plan: [slot(a1!, 'done'), slot(a2!, 'next'), slot(b1!, 'next', true), slot(null, 'none')],
      recommended: [item(c1!)],
      more: [item(d1!)],
    };
    expect(upNextItems(today).map((r) => r.episodeId)).toEqual(['a-2', 'c-1', 'd-1']);
  });

  it('starts with the given episode and lists every episode once', () => {
    const today = { plan: [slot(a2!, 'next')], recommended: [item(c1!), item(a2!)], more: [item(d1!)] };
    expect(upNextItems(today, { showId: 'd', episodeId: 'd-1' })).toEqual([
      { showId: 'd', episodeId: 'd-1' },
      { showId: 'a', episodeId: 'a-2' },
      { showId: 'c', episodeId: 'c-1' },
    ]);
  });

  it('leaves out unplayable episodes and stops at what Spotify takes in one call', () => {
    const many = views('m', UP_NEXT_MAX + 5).map(item);
    const unplayable = item({ ...c1!, isPlayable: false });
    const list = upNextItems({ plan: [], recommended: [unplayable], more: many });
    expect(list).toHaveLength(UP_NEXT_MAX);
    expect(list.some((r) => r.episodeId === 'c-1')).toBe(false);
  });
});
