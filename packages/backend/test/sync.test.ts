import { StatusCodes } from 'http-status-codes';
import { compareEpisodesAsc, DEFAULT_SETTINGS } from '@podcast/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors.js';
import { SyncService } from '../src/services/sync.js';
import { MemoryStore } from '../src/store/memory.js';
import { FakeSpotifyApi } from './fakes/fake-spotify.js';

const now = new Date('2026-10-05T08:00:00Z');

async function connected() {
  const store = new MemoryStore();
  await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
  return { store, spotify: new FakeSpotifyApi(now) };
}

describe('SyncService', () => {
  it('counts the new episodes of all shows synced in parallel', async () => {
    const { store, spotify } = await connected();
    await new SyncService(store, spotify).run();
    // forget each show's newest episode, so the next sync finds one new episode per show
    const shows = await store.listShows();
    for (const show of shows) {
      const newest = (await store.listEpisodes(show.id)).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0]!;
      await store.deleteEpisodes(show.id, [newest.id]);
    }
    const state = await new SyncService(store, spotify).run();
    expect(state.status).toBe('idle');
    expect(state.newEpisodes).toBe(shows.length);
  });

  it('stops starting shows once one aborts the sync, and returns after the others settled', async () => {
    const { store, spotify } = await connected();
    const started: string[] = [];
    const episodes = spotify.getShowEpisodes.bind(spotify);
    spotify.getShowEpisodes = async (id, stop) => {
      started.push(id);
      if (id === 'demo-dertag') {
        throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'spotify_rate_limited', 'Rate-Limit', { minutes: 1 });
      }
      await new Promise((r) => setTimeout(r, 20));
      return episodes(id, stop);
    };
    let writesAfterRun = 0;
    let finished = false;
    const putShow = store.putShow.bind(store);
    store.putShow = async (show) => {
      if (finished) writesAfterRun++;
      return putShow(show);
    };

    const state = await new SyncService(store, spotify).run();
    finished = true;
    expect(state).toMatchObject({ status: 'error', errorCode: 'spotify_rate_limited' });
    await new Promise((r) => setTimeout(r, 100));
    expect(started).toHaveLength(3); // the three that were running; no new ones
    expect(writesAfterRun).toBe(0);
  });

  it('keeps a priority the user changes while the first import runs', async () => {
    const { store, spotify } = await connected();
    const episodes = spotify.getShowEpisodes.bind(spotify);
    let moved: { id: string; priority: number } | undefined;
    spotify.getShowEpisodes = async (id, stop) => {
      const [first] = await store.listShows();
      if (!moved && first) {
        moved = { id: first.id, priority: 42 };
        await store.updateShow(first.id, { priority: 42 });
      }
      return episodes(id, stop);
    };
    await new SyncService(store, spotify).run();
    expect(moved).toBeDefined();
    expect((await store.getShow(moved!.id))!.priority).toBe(42);
  });

  it("keeps Spotify's order of episodes released on the same day across syncs", async () => {
    const { store, spotify } = await connected();
    const template = (await spotify.getShowEpisodes('demo-dertag'))[0]!;
    const episode = (id: string) => ({ ...template, id, release_date: '2026-10-01' });
    // Newest first, like Spotify; the ids sort the other way round.
    let listing = [episode('a-part-2'), episode('b-part-1')];
    const original = spotify.getShowEpisodes.bind(spotify);
    // One episode per page, so an incremental sync stops at the first known one.
    spotify.getShowEpisodes = async (id, stop) => {
      if (id !== 'demo-dertag') return original(id, stop);
      const pages = listing.map((e) => [structuredClone(e)]);
      const end = pages.findIndex((page) => stop?.(page));
      return pages.slice(0, end < 0 ? undefined : end + 1).flat();
    };
    const order = async () => (await store.listEpisodes('demo-dertag')).sort(compareEpisodesAsc).map((e) => e.id);

    await new SyncService(store, spotify).run();
    expect(await order()).toEqual(['b-part-1', 'a-part-2']);

    listing = [episode('0-part-3'), ...listing];
    await new SyncService(store, spotify).run();
    expect(await order()).toEqual(['b-part-1', 'a-part-2', '0-part-3']);

    // Episodes stored before the app kept the listing order get it from a full listing.
    const stored = await store.listEpisodes('demo-dertag');
    await store.putEpisodes(stored.map((e) => ({ ...e, listingOrder: undefined })));
    await new SyncService(store, spotify).run();
    expect(await order()).toEqual(['b-part-1', 'a-part-2', '0-part-3']);
  });
});

describe('sync window', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  /** Serves the daily show in pages of five and counts the pages fetched. */
  function pagedDaily(spotify: FakeSpotifyApi) {
    const pages = { count: 0 };
    const original = spotify.getShowEpisodes.bind(spotify);
    spotify.getShowEpisodes = async (id, stop) => {
      if (id !== 'demo-dertag') return original(id, stop);
      const all = await original(id);
      const out = [];
      for (let i = 0; i < all.length; i += 5) {
        const page = all.slice(i, i + 5);
        pages.count++;
        out.push(...page);
        if (stop?.(page)) break;
      }
      return out;
    };
    return pages;
  }

  it("imports a new podcast's episodes only as far back as the default window, fetching only those pages", async () => {
    const { store, spotify } = await connected();
    await store.putSettings({ ...DEFAULT_SETTINGS, newShowSyncWindowDays: 10 });
    const pages = pagedDaily(spotify);
    await new SyncService(store, spotify).run();

    const episodes = await store.listEpisodes('demo-dertag');
    expect(episodes.map((e) => e.releaseDate).sort()[0]).toBe('2026-09-25');
    expect(episodes).toHaveLength(11);
    expect(pages.count).toBe(3); // 40 episodes, but the third page already reaches past the window
    expect((await store.getShow('demo-dertag'))?.syncWindowDays).toBe(10);
  });

  it('drops stored episodes that fell out of the window but keeps their progress', async () => {
    const { store, spotify } = await connected();
    await new SyncService(store, spotify).run();
    expect(await store.listEpisodes('demo-dertag')).toHaveLength(40);
    const old = (await store.listEpisodes('demo-dertag')).find((e) => e.releaseDate === '2026-09-01')!;
    await store.putProgress([
      { showId: 'demo-dertag', episodeId: old.id, status: 'COMPLETED', updatedAt: now.toISOString() },
    ]);

    await store.updateShow('demo-dertag', { syncWindowDays: 7 });
    await new SyncService(store, spotify).run();
    const kept = await store.listEpisodes('demo-dertag');
    expect(kept.every((e) => e.releaseDate >= '2026-09-28')).toBe(true);
    expect(kept).toHaveLength(8);
    expect((await store.listProgress('demo-dertag')).get(old.id)?.status).toBe('COMPLETED');
  });
});
