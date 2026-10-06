import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EpisodeNote } from '@podcast/shared';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatClock, formatRelative, parseClock, splitTimestamps } from '../lib/format';
import { episodeItem, usePlayer, type PlayableItem } from '../lib/player';
import { qk } from '../lib/queries';
import { useToast } from '../lib/toast';
import { Icon } from './Icon';
import styles from './Notes.module.css';
import { NowPlayingTitle } from './NowPlaying';
import { Cover, ErrorBox, IconButton, Spinner } from './ui';
import { Sheet } from './Sheet';

/**
 * The notes of an episode, ordered by position, each editable and deletable,
 * with a field for a new one. A new note gets the position the browser player
 * was at when typing started, if it plays this episode; otherwise the server
 * takes the position Spotify plays the episode at, if any.
 */
export function EpisodeNotes({ item, autoFocus }: { item: PlayableItem; autoFocus?: boolean }) {
  const showId = item.show.id;
  const episodeId = item.episode.id;
  const notes = useQuery({
    queryKey: qk.episodeNotes(showId, episodeId),
    queryFn: () => api.episodeNotes(showId, episodeId),
  });
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className={styles.notes}>
      {notes.isLoading && <Spinner />}
      {notes.error && <ErrorBox error={notes.error} onRetry={() => void notes.refetch()} />}
      {!!notes.data?.length && (
        <ul className={styles.list}>
          {notes.data.map((n) => (
            <li key={n.id}>
              {editing === n.id ? (
                <NoteEdit note={n} onDone={() => setEditing(null)} />
              ) : (
                <NoteItem note={n} item={item} onEdit={() => setEditing(n.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
      <NewNote item={item} autoFocus={autoFocus} />
    </div>
  );
}

/** Refreshes everything that shows notes: the episode's list, all notes and the episode flags of the show. */
function useNotesChanged(showId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([qc.invalidateQueries({ queryKey: qk.notes }), qc.invalidateQueries({ queryKey: qk.show(showId) })]);
}

function NoteItem({ note, item, onEdit }: { note: EpisodeNote; item: PlayableItem; onEdit: () => void }) {
  const { t } = useTranslation('player');
  const toast = useToast();
  const changed = useNotesChanged(note.showId);

  async function remove() {
    try {
      await api.deleteNote(note);
      await changed();
      toast({
        message: t('note.deleted'),
        tone: 'success',
        action: {
          label: t('episode.undo', { ns: 'common' }),
          onClick: () => {
            void api
              .createNote(note.showId, note.episodeId, { text: note.text, positionMs: note.positionMs })
              .then(changed)
              .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
          },
        },
      });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  return (
    <article className={styles.item}>
      <div className={styles.itemHead}>
        {note.positionMs !== null && <PositionButton ms={note.positionMs} item={item} />}
        <span className="muted tiny grow">{formatRelative(note.createdAt)}</span>
        <IconButton icon="note" label={t('note.edit')} onClick={onEdit} />
        <IconButton icon="trash" label={t('note.delete')} onClick={() => void remove()} />
      </div>
      <NoteText note={note} item={item} />
    </article>
  );
}

function NoteEdit({ note, onDone }: { note: EpisodeNote; onDone: () => void }) {
  const { t } = useTranslation('player');
  const toast = useToast();
  const changed = useNotesChanged(note.showId);
  const [text, setText] = useState(note.text);
  const [position, setPosition] = useState(note.positionMs === null ? '' : formatClock(note.positionMs));
  const [busy, setBusy] = useState(false);
  const positionMs = position.trim() ? parseClock(position) : null;
  const valid = !!text.trim() && positionMs !== undefined;

  async function save() {
    if (!valid || positionMs === undefined) return;
    setBusy(true);
    try {
      await api.updateNote(note, { text, positionMs });
      await changed();
      onDone();
    } catch (e) {
      toast({ message: t('note.notSaved', { error: (e as Error).message }), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        className={styles.input}
        rows={4}
        value={text}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- editing a note starts in its text
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => submitOnModEnter(e, save)}
        aria-label={t('note.text')}
      />
      <label className={styles.position}>
        <span className="small">{t('note.position')}</span>
        <input
          value={position}
          inputMode="numeric"
          placeholder="mm:ss"
          onChange={(e) => setPosition(e.target.value)}
          aria-invalid={positionMs === undefined}
        />
        {positionMs === undefined && <span className="small text-error">{t('note.positionInvalid')}</span>}
      </label>
      <div className={styles.toolbar}>
        <button type="submit" className="btn btn-primary btn-small" disabled={!valid || busy}>
          {t('ui.save', { ns: 'common' })}
        </button>
        <button type="button" className="btn btn-small" onClick={onDone}>
          {t('note.cancel')}
        </button>
      </div>
    </form>
  );
}

function NewNote({ item, autoFocus }: { item: PlayableItem; autoFocus?: boolean }) {
  const { t } = useTranslation('player');
  const toast = useToast();
  const player = usePlayer();
  const changed = useNotesChanged(item.show.id);
  const [text, setText] = useState('');
  const [stamp, setStamp] = useState<number | null>(null);
  // What is still unsaved when the editor closes (read by the unmount effect).
  const draft = useRef({ text: '', stamp: null as number | null });

  const np = player.nowPlaying;
  const livePosition = np?.episodeId === item.episode.id && np.target.kind === 'browser' ? np.positionMs : null;
  const shownPosition = stamp ?? (text ? null : livePosition);

  const create = useCallback(
    (value: string, positionMs: number | null) =>
      api.createNote(
        item.show.id,
        item.episode.id,
        positionMs === null ? { text: value } : { text: value, positionMs },
      ),
    [item.show.id, item.episode.id],
  );

  // A draft left when the sheet closes is saved, so closing never loses text.
  useEffect(
    () => () => {
      const { text: value, stamp: positionMs } = draft.current;
      if (value.trim()) void create(value, positionMs).then(changed);
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs only on unmount; the draft comes from a ref
    [],
  );

  function change(value: string) {
    const next = value ? (text ? stamp : livePosition) : null;
    setText(value);
    setStamp(next);
    draft.current = { text: value, stamp: next };
  }

  async function save() {
    const value = text;
    const positionMs = stamp;
    if (!value.trim()) return;
    change('');
    try {
      await create(value, positionMs);
      await changed();
    } catch (e) {
      setText(value);
      setStamp(positionMs);
      draft.current = { text: value, stamp: positionMs };
      toast({ message: t('note.notSaved', { error: (e as Error).message }), tone: 'error' });
    }
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        className={styles.input}
        rows={3}
        value={text}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the player's note sheet opens to write
        autoFocus={autoFocus}
        placeholder={t('note.placeholder')}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => submitOnModEnter(e, save)}
        aria-label={t('note.new')}
      />
      <div className={styles.toolbar}>
        <button type="submit" className="btn btn-primary btn-small" disabled={!text.trim()}>
          <Icon name="plus" size={16} /> {t('note.add')}
        </button>
        <span className="muted tiny">
          {shownPosition !== null ? t('note.at', { time: formatClock(shownPosition) }) : t('note.autoPosition')}
        </span>
      </div>
    </form>
  );
}

/** Ctrl+Enter / Cmd+Enter in a note field saves it. */
function submitOnModEnter(e: ReactKeyboardEvent<HTMLTextAreaElement>, save: () => Promise<void>) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void save();
  }
}

/** Plays `item` from `ms`, or seeks there if it already plays in the browser. */
function useJump(item: PlayableItem) {
  const player = usePlayer();
  return (ms: number) => {
    const np = player.nowPlaying;
    if (np?.episodeId === item.episode.id && np.target.kind === 'browser') player.seekTo(ms);
    else void player.play(item, { positionMs: ms });
  };
}

/** A note's position; plays the episode from there. */
export function PositionButton({ ms, item }: { ms: number; item: PlayableItem }) {
  const { t } = useTranslation('player');
  const jump = useJump(item);
  return (
    <button type="button" className={styles.timestamp} onClick={() => jump(ms)} title={t('note.jump')}>
      {formatClock(ms)}
    </button>
  );
}

/** Note text with clickable timestamps that jump to that position. */
export function NoteText({ note, item }: { note: Pick<EpisodeNote, 'text'>; item: PlayableItem }) {
  const { t } = useTranslation('player');
  const jump = useJump(item);
  return (
    <p className={styles.text}>
      {splitTimestamps(note.text).map((part, i) =>
        'ms' in part ? (
          <button
            key={i}
            type="button"
            className={styles.timestamp}
            onClick={() => jump(part.ms)}
            title={t('note.jump')}
          >
            {part.label}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** Note panel for the episode that is currently playing. Playback continues. */
export function PlayerNoteSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('player');
  const player = usePlayer();
  const np = player.nowPlaying;

  if (!np) return null;
  const local = np.target.kind === 'browser';
  // Portal: the player bar is its own stacking context below the navigation.
  return createPortal(
    <Sheet label={t('note.label')} onClose={onClose}>
      <div className="row gap">
        <Cover src={np.imageUrl} alt={np.showName} size={44} />
        <div className="grow">
          <NowPlayingTitle
            np={np}
            detail={local ? ` · ${formatClock(np.positionMs)} / ${formatClock(np.durationMs)}` : ''}
          />
        </div>
        <IconButton icon="close" label={t('ui.close', { ns: 'common' })} onClick={onClose} />
      </div>
      {local && (
        <div className={cx('row gap', styles.controls)}>
          <IconButton icon="rewind" label={t('back15')} onClick={() => player.seekBy(-15_000)} />
          <IconButton
            icon={np.paused ? 'play' : 'pause'}
            label={np.paused ? t('resume') : t('pause')}
            variant="primary"
            onClick={player.togglePause}
          />
          <IconButton icon="forward" label={t('forward30')} onClick={() => player.seekBy(30_000)} />
        </div>
      )}
      <EpisodeNotes item={episodeItem({ ...np, episodeName: np.name })} autoFocus />
    </Sheet>,
    document.body,
  );
}
