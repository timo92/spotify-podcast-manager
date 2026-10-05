import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import dynalite from 'dynalite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Episode, LegacySchedule, Show } from '@podcast/shared';
import { DynamoStore } from '../src/store/dynamo.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Store } from '../src/store/types.js';

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

/**
 * Runs the same behavioural checks against every Store implementation.
 * `withLegacySchedule` returns a store whose stored schedule is `legacy`
 * as written by an older version.
 */
function contract(
  name: string,
  create: () => Promise<Store>,
  withLegacySchedule: (legacy: LegacySchedule) => Promise<Store>,
) {
  describe(name, () => {
    let store: Store;
    beforeAll(async () => {
      store = await create();
    });

    it('stores config, settings and sync state', async () => {
      expect(await store.getConfig()).toBeUndefined();
      await store.putConfig({ ownerId: 'owner', createdAt: 'c', updatedAt: 'u' });
      expect((await store.getConfig())?.ownerId).toBe('owner');
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

    it('stores the schedule and notes', async () => {
      expect((await store.getSchedule()).rules).toEqual([]);
      await store.putSchedule({ rules: [{ id: 'a', showId: 's1', weekdays: [1, 3], part: 'MORNING' }] });
      expect((await store.getSchedule()).rules).toEqual([{ id: 'a', showId: 's1', weekdays: [1, 3], part: 'MORNING' }]);

      await store.putNote({ showId: 's1', episodeId: 'e2', text: 'one', createdAt: 'c', updatedAt: '2026-01-01T00:00:00Z' });
      await store.putNote({ showId: 's1', episodeId: 'e3', text: 'two', createdAt: 'c', updatedAt: '2026-01-02T00:00:00Z' });
      expect((await store.getNote('s1', 'e2'))?.text).toBe('one');
      expect(await store.listShowNotes('s1')).toHaveLength(2);
      expect((await store.listNotes(10)).map((n) => n.episodeId)).toEqual(['e3', 'e2']);
      expect((await store.listNotes(1)).map((n) => n.episodeId)).toEqual(['e3']);
      // notes don't leak into the listening history
      expect((await store.listHistory(10)).every((h) => h.status === 'COMPLETED')).toBe(true);
      await store.deleteNote('s1', 'e2');
      expect(await store.listShowNotes('s1')).toHaveLength(1);
    });

    it('grants the sync lease to one holder at a time', async () => {
      const running = (leaseId: string, startedAt: string) => ({ status: 'running' as const, startedAt, leaseId });
      const stale = '2026-01-01T00:00:00.000Z';
      expect(await store.acquireSyncLease(running('a', '2026-01-01T00:10:00.000Z'), stale)).toBe(true);
      // held and not stale → refused, even for a second attempt at the same moment
      expect(await store.acquireSyncLease(running('b', '2026-01-01T00:11:00.000Z'), stale)).toBe(false);
      // the API's lease is taken over by the sync run, switching to a new id …
      expect(await store.acquireSyncLease(running('a2', '2026-01-01T00:12:00.000Z'), stale, 'a')).toBe(true);
      // … so a duplicate delivery of the same invocation can't take it over again
      expect(await store.acquireSyncLease(running('a3', '2026-01-01T00:12:01.000Z'), stale, 'a')).toBe(false);
      // only the holder may write the final state
      expect(await store.releaseSyncLease('a', { status: 'idle' })).toBe(false);
      expect(await store.releaseSyncLease('a2', { status: 'idle' })).toBe(true);
      expect((await store.getSyncState()).status).toBe('idle');
      // free again after release, and a stale lease counts as free
      expect(await store.acquireSyncLease(running('c', '2026-01-01T00:13:00.000Z'), stale)).toBe(true);
      expect(await store.acquireSyncLease(running('d', '2026-01-01T01:00:00.000Z'), '2026-01-01T00:30:00.000Z')).toBe(true);
      expect((await store.getSyncState()).leaseId).toBe('d');
      await store.releaseSyncLease('d', { status: 'idle' });
    });

    it('writes tokens, config and plan conditionally where races matter', async () => {
      // tokens: only the rejected refresh token is deleted
      await store.putTokens({ accessToken: 'a', refreshToken: 'fresh', expiresAt: 0, scope: '' });
      expect(await store.deleteTokens('old')).toBe(false);
      expect((await store.getTokens())?.refreshToken).toBe('fresh');
      expect(await store.deleteTokens('fresh')).toBe(true);
      expect(await store.getTokens()).toBeUndefined();
      expect(await store.deleteTokens('fresh')).toBe(false); // already gone

      // config: marked once; deleted only while the mark is unchanged
      await store.putConfig({ ownerId: 'o', createdAt: 'c', updatedAt: 'u' });
      await store.markDisconnected('2026-01-01T00:00:00.000Z');
      await store.markDisconnected('2026-02-01T00:00:00.000Z');
      expect((await store.getConfig())?.disconnectedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(await store.deleteConfigIfDisconnectedAt('2026-02-01T00:00:00.000Z')).toBe(false);
      await store.putConfig({ ownerId: 'o', createdAt: 'c', updatedAt: 'u' }); // a login clears the mark
      expect(await store.deleteConfigIfDisconnectedAt('2026-01-01T00:00:00.000Z')).toBe(false);
      expect(await store.getConfig()).toBeDefined();
      await store.markDisconnected('2026-03-01T00:00:00.000Z');
      expect(await store.deleteConfigIfDisconnectedAt('2026-03-01T00:00:00.000Z')).toBe(true);
      expect(await store.getConfig()).toBeUndefined();

      // plan: written only if nobody saved in between
      await store.putSchedule({ rules: [], updatedAt: 'v1' });
      expect(await store.putSchedule({ rules: [], updatedAt: 'v2' }, 'v0')).toBe(false);
      expect(await store.putSchedule({ rules: [], updatedAt: 'v2' }, 'v1')).toBe(true);
      expect((await store.getSchedule()).updatedAt).toBe('v2');
    });

    it('reads a schedule stored in the legacy slot shape as rules and replaces it on save', async () => {
      const legacy = await withLegacySchedule({
        entries: [
          { id: 'a', showId: 's1', weekday: 1, part: 'MORNING' },
          { id: 'b', showId: 's1', weekday: 3, part: 'MORNING' },
          { id: 'c', showId: 's1', weekday: 3, part: 'EVENING' },
        ],
        updatedAt: 'legacy',
      });
      const schedule = await legacy.getSchedule();
      expect(schedule).toEqual({
        rules: [
          { id: 'a', showId: 's1', weekdays: [1, 3], part: 'MORNING' },
          { id: 'c', showId: 's1', weekdays: [3], part: 'EVENING' },
        ],
        updatedAt: 'legacy',
      });
      // A conditional save still sees the legacy item's version.
      expect(await legacy.putSchedule({ rules: schedule.rules.slice(1), updatedAt: 'v3' }, 'legacy')).toBe(true);
      expect(await legacy.getSchedule()).toEqual({ rules: [schedule.rules[1]], updatedAt: 'v3' });
    });

    it('deletes tokens and a show with everything that belongs to it', async () => {
      await store.putTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, scope: '' });
      await store.deleteTokens('r');
      expect(await store.getTokens()).toBeUndefined();

      await store.putShow({ ...show, id: 'gone' });
      await store.putEpisodes([{ ...episodes[0], showId: 'gone', id: 'g1' }]);
      await store.putProgress([{ showId: 'gone', episodeId: 'g1', status: 'COMPLETED', listenedAt: 'x', updatedAt: 'u' }]);
      await store.putNote({ showId: 'gone', episodeId: 'g1', text: 'n', createdAt: 'c', updatedAt: 'u' });
      await store.deleteShow('gone');
      expect(await store.getShow('gone')).toBeUndefined();
      expect(await store.listEpisodes('gone')).toHaveLength(0);
      expect((await store.listProgress('gone')).size).toBe(0);
      expect(await store.listShowNotes('gone')).toHaveLength(0);
      expect((await store.listHistory(50)).some((h) => h.showId === 'gone')).toBe(false);
      // other shows are untouched
      expect(await store.getShow('s1')).toBeDefined();
    });

    it('deletes everything', async () => {
      await store.deleteAll();
      expect(await store.getConfig()).toBeUndefined();
      expect(await store.listShows()).toHaveLength(0);
      expect(await store.listEpisodes('s1')).toHaveLength(0);
    });
  });
}

contract(
  'MemoryStore',
  async () => new MemoryStore(),
  async (legacy) => {
    const file = join(mkdtempSync(join(tmpdir(), 'store-')), 'db.json');
    writeFileSync(file, JSON.stringify({ schedule: legacy }));
    return new MemoryStore(file);
  },
);

let server: ReturnType<typeof dynalite> | undefined;
afterAll(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

let dynamoClient: DynamoDBClient | undefined;

contract(
  'DynamoStore (dynalite)',
  async () => {
    server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const client = (dynamoClient = new DynamoDBClient({
      endpoint: `http://127.0.0.1:${port}`,
      region: 'local',
      credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
    }));
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
  },
  async (legacy) => {
    const db = DynamoDBDocumentClient.from(dynamoClient!);
    await db.send(new PutCommand({ TableName: 'test', Item: { PK: 'META', SK: 'SCHEDULE', ...legacy } }));
    return new DynamoStore('test', dynamoClient);
  },
);
