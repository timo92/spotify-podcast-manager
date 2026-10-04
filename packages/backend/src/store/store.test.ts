import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import dynalite from 'dynalite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Episode, Show } from '@podcast/shared';
import { DynamoStore } from './dynamo.js';
import { MemoryStore } from './memory.js';
import type { Store } from './types.js';

const show: Show = {
  id: 's1',
  source: 'spotify',
  name: 'Show',
  description: 'd',
  spotifyUrl: 'u',
  mode: 'SEQUENTIAL',
  categories: ['Geschichte'],
  paused: false,
  hiddenFromToday: false,
  priority: 1,
  pinnedEpisodeId: null,
  reofferSkipped: false,
  needsReview: true,
  followed: true,
  createdAt: 'c',
  updatedAt: 'u',
};

const episodes: Episode[] = Array.from({ length: 30 }, (_, i) => ({
  id: `e${i}`,
  showId: 's1',
  name: `Episode ${i}`,
  description: 'x'.repeat(500),
  releaseDate: `2025-01-${String(i + 1).padStart(2, '0')}`,
  durationMs: 1000,
  spotifyUrl: 'u',
  firstSeenAt: 'f',
  lastSyncedAt: 'l',
}));

/** Runs the same behavioural checks against every Store implementation. */
function contract(name: string, create: () => Promise<Store>) {
  describe(name, () => {
    let store: Store;
    beforeAll(async () => {
      store = await create();
    });

    it('stores config, settings and sync state', async () => {
      expect(await store.getConfig()).toBeUndefined();
      await store.putConfig({ clientId: 'id', clientSecret: 's', createdAt: 'c', updatedAt: 'u' });
      expect((await store.getConfig())?.clientId).toBe('id');
      expect((await store.getSettings()).audioBudgetMinutes).toBe(30);
      await store.putSettings({ ...(await store.getSettings()), audioBudgetMinutes: 45 });
      expect((await store.getSettings()).audioBudgetMinutes).toBe(45);
      expect((await store.getSyncState()).status).toBe('idle');
    });

    it('handles sessions with expiry', async () => {
      await store.putSession({ id: 'a', createdAt: 'c', expiresAt: Math.floor(Date.now() / 1000) + 60 });
      await store.putSession({ id: 'old', createdAt: 'c', expiresAt: Math.floor(Date.now() / 1000) - 60 });
      expect(await store.getSession('a')).toBeDefined();
      expect(await store.getSession('old')).toBeUndefined();
      await store.deleteSession('a');
      expect(await store.getSession('a')).toBeUndefined();
    });

    it('updates shows partially', async () => {
      await store.putShow(show);
      await store.updateShow('s1', { mode: 'LATEST', pinnedEpisodeId: null, lastSyncError: undefined });
      const s = (await store.getShow('s1'))!;
      expect(s.mode).toBe('LATEST');
      expect(s.categories).toEqual(['Geschichte']);
      expect(s.lastSyncError).toBeUndefined();
      expect(await store.listShows()).toHaveLength(1);
      await expect(store.updateShow('missing', { mode: 'LATEST' })).rejects.toThrow();
    });

    it('stores episodes in batches and deletes them', async () => {
      await store.putEpisodes(episodes);
      expect(await store.listEpisodes('s1')).toHaveLength(30);
      expect((await store.getEpisode('s1', 'e3'))?.name).toBe('Episode 3');
      await store.deleteEpisodes('s1', ['e0', 'e1']);
      expect(await store.listEpisodes('s1')).toHaveLength(28);
    });

    it('keeps progress separate and indexes history', async () => {
      await store.putProgress([
        { showId: 's1', episodeId: 'e5', status: 'COMPLETED', listenedAt: '2026-01-02T00:00:00Z', updatedAt: 'u' },
        { showId: 's1', episodeId: 'e6', status: 'COMPLETED', listenedAt: '2026-01-03T00:00:00Z', updatedAt: 'u' },
        { showId: 's1', episodeId: 'e7', status: 'SKIPPED', skippedAt: 'x', updatedAt: 'u' },
      ]);
      const progress = await store.listProgress('s1');
      expect(progress.size).toBe(3);
      expect((await store.listHistory(10)).map((p) => p.episodeId)).toEqual(['e6', 'e5']);
      // Reverting a completed episode removes it from the history.
      await store.putProgress([{ showId: 's1', episodeId: 'e6', status: 'UNSEEN', updatedAt: 'u' }]);
      expect((await store.listHistory(10)).map((p) => p.episodeId)).toEqual(['e5']);
      await store.deleteProgress('s1', 'e5');
      expect(await store.listHistory(10)).toHaveLength(0);
    });

    it('deletes everything', async () => {
      await store.deleteAll();
      expect(await store.getConfig()).toBeUndefined();
      expect(await store.listShows()).toHaveLength(0);
      expect(await store.listEpisodes('s1')).toHaveLength(0);
    });
  });
}

contract('MemoryStore', async () => new MemoryStore());

let server: ReturnType<typeof dynalite> | undefined;
afterAll(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

contract('DynamoStore (dynalite)', async () => {
  server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const client = new DynamoDBClient({
    endpoint: `http://127.0.0.1:${port}`,
    region: 'local',
    credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
  });
  await client.send(
    new CreateTableCommand({
      TableName: 'test',
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  return new DynamoStore('test', client);
});
