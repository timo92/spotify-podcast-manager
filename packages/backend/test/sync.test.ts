import { StatusCodes } from 'http-status-codes';
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
});
