import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS, type Show } from '@podcast/shared';
import { applyRetention } from '../src/services/retention.js';
import { SyncService } from '../src/services/sync.js';
import { MemoryStore } from '../src/store/memory.js';
import { FakeSpotifyApi } from './fakes/fake-spotify.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-05T08:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY).toISOString();

function show(id: string, extra: Partial<Show> = {}): Show {
  return {
    id,
    source: 'spotify',
    name: id,
    description: '',
    spotifyUrl: '',
    mode: 'SEQUENTIAL',
    categories: [],
    paused: false,
    hiddenFromToday: false,
    priority: 1,
    reofferSkipped: false,
    needsReview: false,
    followed: true,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

describe('applyRetention', () => {
  it(`deletes shows unfollowed more than ${RETENTION_DAYS} days ago, with their plan slots`, async () => {
    const store = new MemoryStore();
    await store.putShow(show('old', { followed: false, unfollowedAt: daysAgo(RETENTION_DAYS + 1) }));
    await store.putShow(show('recent', { followed: false, unfollowedAt: daysAgo(RETENTION_DAYS - 1) }));
    await store.putShow(show('followed'));
    await store.putSchedule({
      entries: [
        { id: '1', showId: 'old', weekday: 1, part: 'MORNING' },
        { id: '2', showId: 'followed', weekday: 2, part: 'EVENING' },
      ],
    });

    const result = await applyRetention(store, now);
    expect(result).toEqual({ deletedShows: ['old'], deletedAll: false });
    expect((await store.listShows()).map((s) => s.id).sort()).toEqual(['followed', 'recent']);
    expect((await store.getSchedule()).entries.map((e) => e.showId)).toEqual(['followed']);
  });

  it(`deletes everything once access has been revoked for more than ${RETENTION_DAYS} days`, async () => {
    const store = new MemoryStore();
    await store.putShow(show('a'));
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '', disconnectedAt: daysAgo(RETENTION_DAYS - 1) });
    expect((await applyRetention(store, now)).deletedAll).toBe(false);

    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '', disconnectedAt: daysAgo(RETENTION_DAYS + 1) });
    expect((await applyRetention(store, now)).deletedAll).toBe(true);
    expect(await store.getConfig()).toBeUndefined();
    expect(await store.listShows()).toHaveLength(0);
  });

  it('records when a show leaves the library and forgets it when it is followed again', async () => {
    const store = new MemoryStore();
    const spotify = new FakeSpotifyApi(now);
    const sync = () => new SyncService(store, spotify).run();
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
    await sync();

    const all = await spotify.getSavedShows();
    spotify.getSavedShows = async () => all.filter((s) => s.id !== 'demo-dertag');
    await sync();
    const unfollowed = (await store.getShow('demo-dertag'))!;
    expect(unfollowed.followed).toBe(false);
    expect(unfollowed.unfollowedAt).toBeDefined();

    spotify.getSavedShows = async () => all;
    await sync();
    const back = (await store.getShow('demo-dertag'))!;
    expect(back.followed).toBe(true);
    expect(back.unfollowedAt).toBeUndefined();
  });
});
