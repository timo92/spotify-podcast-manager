import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

interface Data {
  config?: AppConfig;
  tokens?: SpotifyTokens;
  settings?: Settings;
  sync?: SyncState;
  sessions: Record<string, Session>;
  shows: Record<string, Show>;
  episodes: Record<string, Record<string, Episode>>;
  progress: Record<string, Record<string, EpisodeProgress>>;
  schedule?: Schedule;
  /** Notes per show, keyed by `<episodeId>#<noteId>`. */
  notes: Record<string, Record<string, EpisodeNote>>;
}

const empty = (): Data => ({ sessions: {}, shows: {}, episodes: {}, progress: {}, notes: {} });
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** In-memory store, optionally persisted to a JSON file (local development). */
export class MemoryStore implements Store {
  private data: Data;

  constructor(private readonly file?: string) {
    this.data = empty();
    if (file) {
      try {
        this.data = { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) };
      } catch {
        // first start
      }
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data));
  }

  async getConfig() {
    return clone(this.data.config);
  }
  async putConfig(config: AppConfig) {
    this.data.config = clone(config);
    this.save();
  }
  async markDisconnected(at: string) {
    if (!this.data.config || this.data.config.disconnectedAt) return;
    this.data.config = { ...this.data.config, disconnectedAt: at, updatedAt: at };
    this.save();
  }
  async deleteConfigIfDisconnectedAt(disconnectedAt: string) {
    if (this.data.config?.disconnectedAt !== disconnectedAt) return false;
    delete this.data.config;
    this.save();
    return true;
  }
  async getTokens() {
    return clone(this.data.tokens);
  }
  async putTokens(tokens: SpotifyTokens) {
    this.data.tokens = clone(tokens);
    this.save();
  }
  async deleteTokens(refreshToken: string) {
    if (this.data.tokens?.refreshToken !== refreshToken) return false;
    delete this.data.tokens;
    this.save();
    return true;
  }
  async getSettings() {
    return { ...DEFAULT_SETTINGS, ...clone(this.data.settings) };
  }
  async putSettings(settings: Settings) {
    this.data.settings = clone(settings);
    this.save();
  }
  async getSyncState(): Promise<SyncState> {
    return clone(this.data.sync) ?? { status: 'idle' };
  }
  async acquireSyncLease(state: SyncState & { leaseId: string }, staleBefore: string, takeOver?: string) {
    // Single-threaded: check and write happen without an await in between.
    const cur = this.data.sync;
    const held =
      cur?.status === 'running' &&
      !!cur.startedAt &&
      cur.startedAt >= staleBefore &&
      !(takeOver && cur.leaseId === takeOver);
    if (held) return false;
    this.data.sync = clone(state);
    this.save();
    return true;
  }
  async releaseSyncLease(leaseId: string, state: SyncState) {
    if (this.data.sync?.leaseId !== leaseId) return false;
    this.data.sync = clone(state);
    this.save();
    return true;
  }
  async putSession(session: Session) {
    this.data.sessions[session.id] = clone(session);
    this.save();
  }
  async getSession(id: string) {
    const s = this.data.sessions[id];
    if (!s || s.expiresAt * 1000 < Date.now()) return undefined;
    return clone(s);
  }
  async deleteSession(id: string) {
    delete this.data.sessions[id];
    this.save();
  }
  async listShows() {
    return Object.values(this.data.shows).map(clone);
  }
  async getShow(id: string) {
    return clone(this.data.shows[id]);
  }
  async putShow(show: Show) {
    this.data.shows[show.id] = clone(show);
    this.save();
  }
  async updateShow(id: string, fields: Partial<Show>) {
    const existing = this.data.shows[id];
    if (!existing) throw new Error(`Show ${id} not found`);
    this.data.shows[id] = { ...existing, ...clone(fields) };
    this.save();
  }
  async listEpisodes(showId: string) {
    return Object.values(this.data.episodes[showId] ?? {}).map(clone);
  }
  async getEpisode(showId: string, episodeId: string) {
    return clone(this.data.episodes[showId]?.[episodeId]);
  }
  async putEpisodes(episodes: Episode[]) {
    for (const ep of episodes) (this.data.episodes[ep.showId] ??= {})[ep.id] = clone(ep);
    this.save();
  }
  async deleteEpisodes(showId: string, episodeIds: string[]) {
    for (const id of episodeIds) delete this.data.episodes[showId]?.[id];
    this.save();
  }
  async listProgress(showId: string) {
    return new Map(Object.entries(this.data.progress[showId] ?? {}).map(([k, v]) => [k, clone(v)]));
  }
  async putProgress(progress: EpisodeProgress[]) {
    for (const p of progress) (this.data.progress[p.showId] ??= {})[p.episodeId] = clone(p);
    this.save();
  }
  async deleteProgress(showId: string, episodeId: string) {
    delete this.data.progress[showId]?.[episodeId];
    this.save();
  }
  async listHistory(limit: number) {
    return Object.values(this.data.progress)
      .flatMap((m) => Object.values(m))
      .filter((p) => p.status === 'COMPLETED' && p.listenedAt)
      .sort((a, b) => ((b.listenedAt ?? '') > (a.listenedAt ?? '') ? 1 : -1))
      .slice(0, limit)
      .map(clone);
  }
  async getSchedule(): Promise<Schedule> {
    return clone(this.data.schedule) ?? { rules: [] };
  }
  async putSchedule(schedule: Schedule, expectedUpdatedAt?: string | null) {
    if (expectedUpdatedAt !== undefined && (this.data.schedule?.updatedAt ?? null) !== expectedUpdatedAt) return false;
    this.data.schedule = clone(schedule);
    this.save();
    return true;
  }
  async getNote(showId: string, episodeId: string, noteId: string) {
    return clone(this.data.notes[showId]?.[`${episodeId}#${noteId}`]);
  }
  async putNote(note: EpisodeNote) {
    (this.data.notes[note.showId] ??= {})[`${note.episodeId}#${note.id}`] = clone(note);
    this.save();
  }
  async deleteNote(showId: string, episodeId: string, noteId: string) {
    delete this.data.notes[showId]?.[`${episodeId}#${noteId}`];
    this.save();
  }
  async listEpisodeNotes(showId: string, episodeId: string) {
    return Object.values(this.data.notes[showId] ?? {})
      .filter((n) => n.episodeId === episodeId)
      .map(clone);
  }
  async listShowNotes(showId: string) {
    return Object.values(this.data.notes[showId] ?? {}).map(clone);
  }
  async listNotes(limit: number) {
    return Object.values(this.data.notes)
      .flatMap((m) => Object.values(m))
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
      .slice(0, limit)
      .map(clone);
  }
  async deleteShow(showId: string) {
    delete this.data.shows[showId];
    delete this.data.episodes[showId];
    delete this.data.progress[showId];
    delete this.data.notes[showId];
    this.save();
  }
  async deleteAll() {
    this.data = empty();
    this.save();
  }
}
