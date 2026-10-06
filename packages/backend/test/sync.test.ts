import { StatusCodes } from 'http-status-codes';
import { compareEpisodesAsc } from '@podcast/shared';
import { describe, expect, it } from 'vitest';
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
