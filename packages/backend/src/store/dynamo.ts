import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_SETTINGS,
  type Episode,
  type EpisodeNote,
  type EpisodeProgress,
  type Schedule,
  type Settings,
  type Show,
  type SyncState,
} from '@podcast/shared';
import type { AppConfig, Session, SpotifyTokens, Store } from './types.js';

/**
 * Single-table layout:
 *
 *   PK            SK          item
 *   META          CONFIG      AppConfig (the owner; credentials come from the deployment)
 *   META          TOKENS      SpotifyTokens
 *   META          SETTINGS    Settings
 *   META          SYNC        SyncState
 *   META          SCHEDULE    Schedule (weekly plan)
 *   SESSION#<id>  SESSION     Session (TTL attribute `ttl`)
 *   SHOW          <showId>    Show
 *   EP#<showId>   <epId>      Episode           (written by sync only)
 *   PROG#<showId> <epId>      EpisodeProgress   (written by the user only)
 *   NOTE#<showId> <epId>      EpisodeNote
 *
 * GSI1 indexes completed episodes (GSI1PK = HISTORY, GSI1SK = listenedAt)
 * and notes (GSI1PK = NOTES, GSI1SK = updatedAt).
 */
export class DynamoStore implements Store {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  private async get<T>(pk: string, sk: string): Promise<T | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { PK: pk, SK: sk } }));
    if (!res.Item) return undefined;
    return strip(res.Item) as T;
  }

  private async put(pk: string, sk: string, item: object, extra: Record<string, unknown> = {}) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { ...item, ...extra, PK: pk, SK: sk } }));
  }

  private async queryAll(input: Omit<QueryCommandInput, 'TableName'>): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(new QueryCommand({ TableName: this.table, ...input, ExclusiveStartKey }));
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  private async batchWrite(requests: Record<string, unknown>[]) {
    for (let i = 0; i < requests.length; i += 25) {
      let pending: Record<string, unknown>[] | undefined = requests.slice(i, i + 25);
      for (let attempt = 0; pending?.length && attempt < 8; attempt++) {
        const res = await this.db.send(new BatchWriteCommand({ RequestItems: { [this.table]: pending as never } }));
        pending = res.UnprocessedItems?.[this.table] as Record<string, unknown>[] | undefined;
        if (pending?.length) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
      if (pending?.length) throw new Error('DynamoDB batch write did not complete');
    }
  }

  getConfig() {
    return this.get<AppConfig>('META', 'CONFIG');
  }
  putConfig(config: AppConfig) {
    return this.put('META', 'CONFIG', config);
  }
  getTokens() {
    return this.get<SpotifyTokens>('META', 'TOKENS');
  }
  putTokens(tokens: SpotifyTokens) {
    return this.put('META', 'TOKENS', tokens);
  }
  async deleteTokens() {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { PK: 'META', SK: 'TOKENS' } }));
  }
  async getSettings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await this.get<Settings>('META', 'SETTINGS')) };
  }
  putSettings(settings: Settings) {
    return this.put('META', 'SETTINGS', settings);
  }
  async getSyncState(): Promise<SyncState> {
    return (await this.get<SyncState>('META', 'SYNC')) ?? { status: 'idle' };
  }
  putSyncState(state: SyncState) {
    return this.put('META', 'SYNC', state);
  }

  putSession(session: Session) {
    return this.put(`SESSION#${session.id}`, 'SESSION', session, { ttl: session.expiresAt });
  }
  async getSession(id: string) {
    const s = await this.get<Session>(`SESSION#${id}`, 'SESSION');
    // TTL deletion is lazy, so check expiry ourselves.
    if (!s || s.expiresAt * 1000 < Date.now()) return undefined;
    return s;
  }
  async deleteSession(id: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { PK: `SESSION#${id}`, SK: 'SESSION' } }));
  }

  async listShows() {
    const items = await this.queryAll({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SHOW' },
    });
    return items.map((i) => strip(i) as Show);
  }
  getShow(id: string) {
    return this.get<Show>('SHOW', id);
  }
  putShow(show: Show) {
    return this.put('SHOW', show.id, show);
  }
  async updateShow(id: string, fields: Partial<Show>) {
    const entries = Object.entries(fields).filter(([k]) => k !== 'id');
    if (!entries.length) return;
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    const removes: string[] = [];
    entries.forEach(([key, value], i) => {
      names[`#f${i}`] = key;
      if (value === undefined) {
        removes.push(`#f${i}`);
      } else {
        values[`:v${i}`] = value;
        sets.push(`#f${i} = :v${i}`);
      }
    });
    const expr = [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : '']
      .filter(Boolean)
      .join(' ');
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: 'SHOW', SK: id },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async listEpisodes(showId: string) {
    const items = await this.queryAll({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `EP#${showId}` },
    });
    return items.map((i) => strip(i) as Episode);
  }
  getEpisode(showId: string, episodeId: string) {
    return this.get<Episode>(`EP#${showId}`, episodeId);
  }
  async putEpisodes(episodes: Episode[]) {
    await this.batchWrite(
      episodes.map((ep) => ({ PutRequest: { Item: { ...dropUndefined(ep), PK: `EP#${ep.showId}`, SK: ep.id } } })),
    );
  }
  async deleteEpisodes(showId: string, episodeIds: string[]) {
    await this.batchWrite(episodeIds.map((id) => ({ DeleteRequest: { Key: { PK: `EP#${showId}`, SK: id } } })));
  }

  async listProgress(showId: string) {
    const items = await this.queryAll({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `PROG#${showId}` },
    });
    return new Map(items.map((i) => [i.SK as string, strip(i) as EpisodeProgress]));
  }
  async putProgress(progress: EpisodeProgress[]) {
    await this.batchWrite(
      progress.map((p) => {
        const history = p.status === 'COMPLETED' && p.listenedAt ? { GSI1PK: 'HISTORY', GSI1SK: p.listenedAt } : {};
        return { PutRequest: { Item: { ...dropUndefined(p), ...history, PK: `PROG#${p.showId}`, SK: p.episodeId } } };
      }),
    );
  }
  async deleteProgress(showId: string, episodeId: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { PK: `PROG#${showId}`, SK: episodeId } }));
  }
  async listHistory(limit: number) {
    const res = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'HISTORY' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => strip(i) as EpisodeProgress);
  }

  async getSchedule(): Promise<Schedule> {
    return (await this.get<Schedule>('META', 'SCHEDULE')) ?? { entries: [] };
  }
  putSchedule(schedule: Schedule) {
    return this.put('META', 'SCHEDULE', schedule);
  }

  getNote(showId: string, episodeId: string) {
    return this.get<EpisodeNote>(`NOTE#${showId}`, episodeId);
  }
  putNote(note: EpisodeNote) {
    return this.put(`NOTE#${note.showId}`, note.episodeId, note, { GSI1PK: 'NOTES', GSI1SK: note.updatedAt });
  }
  async deleteNote(showId: string, episodeId: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { PK: `NOTE#${showId}`, SK: episodeId } }));
  }
  async listShowNotes(showId: string) {
    const items = await this.queryAll({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `NOTE#${showId}` },
    });
    return items.map((i) => strip(i) as EpisodeNote);
  }
  async listNotes(limit: number) {
    const items: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'NOTES' },
          ScanIndexForward: false,
          Limit: limit - items.length,
          ExclusiveStartKey,
        }),
      );
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey && items.length < limit);
    return items.map((i) => strip(i) as EpisodeNote);
  }

  async deleteShow(showId: string) {
    for (const prefix of ['EP', 'PROG', 'NOTE']) {
      const items = await this.queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `${prefix}#${showId}` },
        ProjectionExpression: 'PK, SK',
      });
      await this.batchWrite(items.map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })));
    }
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { PK: 'SHOW', SK: showId } }));
  }

  async deleteAll() {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new ScanCommand({ TableName: this.table, ProjectionExpression: 'PK, SK', ExclusiveStartKey }),
      );
      await this.batchWrite((res.Items ?? []).map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }
}

function strip(item: Record<string, unknown>): any {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ttl: _ttl, ...rest } = item;
  return rest;
}

function dropUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
