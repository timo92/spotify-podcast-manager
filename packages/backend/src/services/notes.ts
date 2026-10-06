import { randomUUID } from 'node:crypto';
import { byPosition, type EpisodeNote, type NoteCreate, type NotePatch } from '@podcast/shared';
import { badRequest, notFound } from '../errors.js';
import type { SpotifyApi } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';

const MAX_NOTE_LENGTH = 50_000;

/** A request body as received: its fields are checked by the service (validText, validPosition). */
type Unchecked<T> = { [K in keyof T]?: unknown };

/** Notes on episodes: any number per episode, each with its own position (or none). */
export class NoteService {
  constructor(
    private readonly store: Store,
    private readonly library: LibraryService,
    private readonly spotify: () => SpotifyApi,
  ) {}

  /** The notes of an episode, ordered by position (see byPosition). */
  async list(showId: string, episodeId: string): Promise<EpisodeNote[]> {
    return (await this.store.listEpisodeNotes(showId, episodeId)).sort(byPosition);
  }

  /**
   * Creates a note. Without `positionMs` in the body, the note gets the
   * position Spotify is playing this episode at, on any device, or none.
   */
  async create(showId: string, episodeId: string, body: Unchecked<NoteCreate>): Promise<EpisodeNote> {
    const text = validText(body.text);
    const [show, episode] = await Promise.all([
      this.library.requireShow(showId),
      this.store.getEpisode(showId, episodeId),
    ]);
    if (!episode) throw notFound('episode_not_found');
    const positionMs =
      'positionMs' in body ? validPosition(body.positionMs, episode.durationMs) : await this.playingPosition(episodeId);
    const now = new Date().toISOString();
    const note: EpisodeNote = {
      id: randomUUID(),
      showId,
      episodeId,
      positionMs,
      text,
      createdAt: now,
      updatedAt: now,
      episodeName: episode.name,
      showName: show.name,
      episodeReleaseDate: episode.releaseDate,
    };
    await this.store.putNote(note);
    return note;
  }

  /** Changes the text and/or position of a note. */
  async update(showId: string, episodeId: string, noteId: string, patch: Unchecked<NotePatch>): Promise<EpisodeNote> {
    const [note, episode] = await Promise.all([
      this.store.getNote(showId, episodeId, noteId),
      this.store.getEpisode(showId, episodeId),
    ]);
    if (!note) throw notFound('note_not_found');
    const next: EpisodeNote = {
      ...note,
      text: patch.text === undefined ? note.text : validText(patch.text),
      positionMs: 'positionMs' in patch ? validPosition(patch.positionMs, episode?.durationMs) : note.positionMs,
      updatedAt: new Date().toISOString(),
    };
    await this.store.putNote(next);
    return next;
  }

  async delete(showId: string, episodeId: string, noteId: string): Promise<void> {
    await this.store.deleteNote(showId, episodeId, noteId);
  }

  /**
   * Where Spotify is playing `episodeId`, or null. A note is saved even when
   * Spotify can't be asked (no Premium, rate limit, outage); it just gets no
   * position.
   */
  private async playingPosition(episodeId: string): Promise<number | null> {
    try {
      const playing = await this.spotify().getPlayingEpisode();
      return playing?.episodeId === episodeId ? playing.positionMs : null;
    } catch (e) {
      console.warn('Could not read the playback position for a note', e);
      return null;
    }
  }
}

function validText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw badRequest('invalid_note', 'Eine Notiz braucht einen Text');
  if (text.length > MAX_NOTE_LENGTH) {
    throw badRequest('note_too_long', `Notiz ist zu lang (max. ${MAX_NOTE_LENGTH} Zeichen)`, { max: MAX_NOTE_LENGTH });
  }
  return text;
}

/** A position in ms (rounded, at most the episode's duration) or null. */
function validPosition(value: unknown, durationMs: number | undefined): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw badRequest('invalid_note_position', 'positionMs muss eine Zahl ≥ 0 oder null sein');
  }
  const ms = Math.round(value);
  return durationMs ? Math.min(ms, durationMs) : ms;
}
