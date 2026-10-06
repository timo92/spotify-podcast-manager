import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import dynalite from 'dynalite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Episode, EpisodeNote, Show } from '@podcast/shared';
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

/** Runs the same behavioural checks against every Store implementation. */
function contract(name: string, create: () => Promise<Store>) {
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
      // oxlint-disable-next-line vitest/require-to-throw-message -- each store fails with its own error
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

      const note = (
        episodeId: string,
        id: string,
        createdAt: string,
        positionMs: number | null = null,
      ): EpisodeNote => ({
        id,
        showId: 's1',
        episodeId,
        positionMs,
        text: `${episodeId}/${id}`,
        createdAt,
        updatedAt: createdAt,
      });
      await store.putNote(note('e2', 'n1', '2026-01-01T00:00:00Z', 61_000));
      await store.putNote(note('e2', 'n2', '2026-01-03T00:00:00Z'));
      await store.putNote(note('e3', 'n1', '2026-01-02T00:00:00Z'));
      // An episode id that is a prefix of another must not pick up its notes.
      await store.putNote(note('e2x', 'n1', '2026-01-04T00:00:00Z'));
      expect(await store.getNote('s1', 'e2', 'n1')).toEqual(note('e2', 'n1', '2026-01-01T00:00:00Z', 61_000));
      expect(await store.getNote('s1', 'e2', 'missing')).toBeUndefined();
      expect((await store.listEpisodeNotes('s1', 'e2')).map((n) => n.id).sort()).toEqual(['n1', 'n2']);
      expect(await store.listShowNotes('s1')).toHaveLength(4);
      expect((await store.listNotes(10)).map((n) => n.text)).toEqual(['e2x/n1', 'e2/n2', 'e3/n1', 'e2/n1']);
      expect((await store.listNotes(1)).map((n) => n.text)).toEqual(['e2x/n1']);
      // notes don't leak into the listening history
      expect((await store.listHistory(10)).every((h) => h.status === 'COMPLETED')).toBe(true);

      await store.putNote({
        ...note('e2', 'n2', '2026-01-03T00:00:00Z'),
        text: 'edited',
        updatedAt: '2026-02-01T00:00:00Z',
      });
      expect((await store.getNote('s1', 'e2', 'n2'))?.text).toBe('edited');
      expect(await store.listEpisodeNotes('s1', 'e2')).toHaveLength(2);

      await store.deleteNote('s1', 'e2', 'n1');
      await store.deleteNote('s1', 'e2', 'missing');
      expect((await store.listEpisodeNotes('s1', 'e2')).map((n) => n.id)).toEqual(['n2']);
      expect(await store.listShowNotes('s1')).toHaveLength(3);
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
      expect(await store.acquireSyncLease(running('d', '2026-01-01T01:00:00.000Z'), '2026-01-01T00:30:00.000Z')).toBe(
        true,
      );
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

    it('replaces tokens, claims the owner and writes summaries only on top of what they were based on', async () => {
      // tokens: a refresh replaces only the tokens it refreshed, not a newer login's
      await store.putTokens({ accessToken: 'a', refreshToken: 'login', expiresAt: 0, scope: 'new' });
      const refreshed = { accessToken: 'b', refreshToken: 'r2', expiresAt: 0, scope: 'old' };
      expect(await store.putTokens(refreshed, 'stale')).toBe(false);
      expect((await store.getTokens())?.scope).toBe('new');
      expect(await store.putTokens({ ...refreshed, scope: 'new' }, 'login')).toBe(true);
      expect((await store.getTokens())?.refreshToken).toBe('r2');

      // owner: claimed once, afterwards only by the same account
      expect(await store.getConfig()).toBeUndefined();
      expect(await store.claimConfig({ ownerId: 'a', createdAt: 'c', updatedAt: 'u' })).toBe(true);
      expect(await store.claimConfig({ ownerId: 'b', createdAt: 'c', updatedAt: 'u' })).toBe(false);
      expect(await store.claimConfig({ ownerId: 'a', ownerName: 'A', createdAt: 'c', updatedAt: 'u2' })).toBe(true);
      expect(await store.getConfig()).toMatchObject({ ownerId: 'a', ownerName: 'A' });

      // summary: written only on top of the revision it was computed from
      const summary = (completed: number) => ({
        total: 2,
        completed,
        skipped: 0,
        inProgress: 0,
        unseen: 2 - completed,
        newCount: 0,
        nextEpisode: null,
        computedAt: 'now',
      });
      await store.putShow({ ...show, id: 'rev' });
      expect(await store.putSummary('rev', summary(0), undefined)).toBe(true);
      expect(await store.putSummary('rev', summary(1), undefined)).toBe(false);
      expect(await store.putSummary('rev', summary(1), 1)).toBe(true);
      expect(await store.getShow('rev')).toMatchObject({ summary: summary(1), summaryRevision: 2 });
      await store.deleteShow('rev');
    });

    it('deletes tokens and a show with everything that belongs to it', async () => {
      await store.putTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, scope: '' });
      await store.deleteTokens('r');
      expect(await store.getTokens()).toBeUndefined();

      await store.putShow({ ...show, id: 'gone' });
      await store.putEpisodes([{ ...episodes[0]!, showId: 'gone', id: 'g1' }]);
      await store.putProgress([
        { showId: 'gone', episodeId: 'g1', status: 'COMPLETED', listenedAt: 'x', updatedAt: 'u' },
      ]);
      await store.putNote({
        id: 'n',
        showId: 'gone',
        episodeId: 'g1',
        positionMs: null,
        text: 'n',
        createdAt: 'c',
        updatedAt: 'u',
      });
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

describe('DynamoStore reads', () => {
  it('read their own writes: base-table reads are strongly consistent', async () => {
    const client = new DynamoDBClient({
      endpoint: 'http://127.0.0.1:1',
      region: 'local',
      credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
    });
    const reads: Record<string, unknown>[] = [];
    client.middlewareStack.add(
      () => async (args) => {
        reads.push(args.input as Record<string, unknown>);
        return { output: { Items: [], $metadata: {} } as never, response: {} };
      },
      { step: 'initialize' },
    );
    const store = new DynamoStore('test', client);
    await store.getShow('s');
    await store.listEpisodes('s');
    await store.listProgress('s');
    expect(reads).toHaveLength(3);
    for (const input of reads) expect(input).toMatchObject({ ConsistentRead: true });
  });
});
