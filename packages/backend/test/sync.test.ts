import { describe, expect, it } from 'vitest';
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
});
