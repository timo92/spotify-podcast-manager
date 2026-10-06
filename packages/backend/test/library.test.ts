import { describe, expect, it } from 'vitest';
import { LibraryService } from '../src/services/library.js';
import { SyncService } from '../src/services/sync.js';
import { MemoryStore } from '../src/store/memory.js';
import { FakeSpotifyApi } from './fakes/fake-spotify.js';

describe('LibraryService', () => {
  it('never replaces a summary with one computed from older progress', async () => {
    const store = new MemoryStore();
    await store.putConfig({ ownerId: 'o', createdAt: '', updatedAt: '' });
    await new SyncService(store, new FakeSpotifyApi(new Date('2026-10-05T08:00:00Z'))).run();
    const id = 'demo-wissensreise';
    const library = new LibraryService(store);
    const before = (await store.getShow(id))!.summary!.completed;

    // While one recompute (e.g. the sync's) has read the progress, the user marks
    // an episode as heard, and that change's own recompute finishes first.
    const listProgress = store.listProgress.bind(store);
    let interleaved = false;
    store.listProgress = async (showId) => {
      const progress = await listProgress(showId);
      if (!interleaved) {
        interleaved = true;
        await new LibraryService(store).setStatus(id, [`${id}-1`], 'COMPLETED');
      }
      return progress;
    };
    await library.recompute(id);
    expect((await store.getShow(id))!.summary!.completed).toBe(before + 1);
  });
});
