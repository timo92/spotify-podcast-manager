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
  it(`deletes shows unfollowed more than ${RETENTION_DAYS} days ago, with their plan rules`, async () => {
    const store = new MemoryStore();
    await store.putShow(show('old', { followed: false, unfollowedAt: daysAgo(RETENTION_DAYS + 1) }));
    await store.putShow(show('recent', { followed: false, unfollowedAt: daysAgo(RETENTION_DAYS - 1) }));
    await store.putShow(show('followed'));
    await store.putSchedule({
      rules: [
        { id: '1', showId: 'old', weekdays: [1], part: 'MORNING' },
        { id: '2', showId: 'followed', weekdays: [2], part: 'EVENING' },
      ],
    });

    const result = await applyRetention(store, now);
    expect(result).toEqual({ deletedShows: ['old'], deletedAll: false });
    expect((await store.listShows()).map((s) => s.id).sort()).toEqual(['followed', 'recent']);
    expect((await store.getSchedule()).rules.map((r) => r.showId)).toEqual(['followed']);
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

    spotify.saved.delete('demo-dertag');
    await sync();
    const unfollowed = (await store.getShow('demo-dertag'))!;
    expect(unfollowed.followed).toBe(false);
    expect(unfollowed.unfollowedAt).toBeDefined();

    spotify.saved.add('demo-dertag');
    await sync();
    const back = (await store.getShow('demo-dertag'))!;
    expect(back.followed).toBe(true);
    expect(back.unfollowedAt).toBeUndefined();
  });

  it('keeps a re-followed show even if its episode sync keeps failing', async () => {
    const store = new MemoryStore();
    const spotify = new FakeSpotifyApi(now);
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
    await new SyncService(store, spotify).run();
    // unfollowed long ago, now back in the library
    await store.updateShow('demo-dertag', { followed: false, unfollowedAt: daysAgo(RETENTION_DAYS + 5) });
    const getEpisodes = spotify.getShowEpisodes.bind(spotify);
    spotify.getShowEpisodes = async (id, stop) => {
      if (id === 'demo-dertag') throw new Error('Spotify-Fehler 503');
      return getEpisodes(id, stop);
    };

    const state = await new SyncService(store, spotify).run();
    expect(state.status).toBe('idle');
    const show = (await store.getShow('demo-dertag'))!;
    expect(show).toMatchObject({ followed: true, lastSyncError: 'Spotify-Fehler 503' });
    expect(show.unfollowedAt).toBeUndefined();
  });

  it('only unfollows shows Spotify confirms as not saved', async () => {
    const store = new MemoryStore();
    const spotify = new FakeSpotifyApi(now);
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
    await new SyncService(store, spotify).run();
    // 'demo-dertag' was taken down: still saved, but the listing omits it.
    // 'demo-wissensreise' was really unfollowed.
    const listing = spotify.getSavedShows.bind(spotify);
    spotify.getSavedShows = async () => (await listing()).filter((s) => s.id !== 'demo-dertag');
    spotify.saved.delete('demo-wissensreise');
    const checked: string[][] = [];
    const contains = spotify.libraryContains.bind(spotify);
    spotify.libraryContains = async (ids) => {
      checked.push(ids);
      return contains(ids);
    };
    await new SyncService(store, spotify).run();
    expect(checked).toEqual([['demo-dertag', 'demo-wissensreise']]);
    expect((await store.getShow('demo-dertag'))!.followed).toBe(true);
    expect((await store.getShow('demo-wissensreise'))!.followed).toBe(false);

    // if the check itself fails, nothing is unfollowed in that sync
    spotify.saved.delete('demo-wirtschaft');
    spotify.libraryContains = async () => {
      throw new Error('Spotify-Fehler 503');
    };
    await new SyncService(store, spotify).run();
    expect((await store.getShow('demo-wirtschaft'))!.followed).toBe(true);
  });

  it('checks nothing extra when every known show is listed', async () => {
    const store = new MemoryStore();
    const spotify = new FakeSpotifyApi(now);
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
    let calls = 0;
    spotify.libraryContains = async () => {
      calls++;
      return new Map();
    };
    await new SyncService(store, spotify).run();
    await new SyncService(store, spotify).run();
    expect(calls).toBe(0);
  });

  it('keeps a successful sync successful when retention fails', async () => {
    const store = new MemoryStore();
    const spotify = new FakeSpotifyApi(now);
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
    await new SyncService(store, spotify).run();
    await store.updateShow('demo-dertag', { followed: false, unfollowedAt: daysAgo(RETENTION_DAYS + 1) });
    spotify.saved.delete('demo-dertag');
    store.deleteShow = async () => {
      throw new Error('batch write did not complete');
    };
    const state = await new SyncService(store, spotify).run();
    expect(state.status).toBe('idle');
    expect(state.lastSuccessAt).toBeDefined();
    expect((await store.getSyncState()).status).toBe('idle');
  });

  it('does not wipe while tokens exist or when a login cleared the mark meanwhile', async () => {
    const config = { ownerId: 'o', createdAt: '', updatedAt: '', disconnectedAt: daysAgo(RETENTION_DAYS + 1) };

    const withTokens = new MemoryStore();
    await withTokens.putConfig(config);
    await withTokens.putTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, scope: '' });
    expect((await applyRetention(withTokens, now)).deletedAll).toBe(false);

    // The read still sees the old mark, but a login has replaced the config.
    const raced = new MemoryStore();
    await raced.putShow(show('kept'));
    raced.getConfig = async () => config;
    expect((await applyRetention(raced, now)).deletedAll).toBe(false);
    expect(await raced.listShows()).toHaveLength(1);
  });
});
