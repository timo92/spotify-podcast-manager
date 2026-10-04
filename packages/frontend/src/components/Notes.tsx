import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EpisodeNote } from '@podcast/shared';
import { api } from '../lib/api';
import { formatClock, formatRelative, splitTimestamps } from '../lib/format';
import { usePlayer, type PlayableItem } from '../lib/player';
import { qk } from '../lib/queries';
import { useToast } from '../lib/toast';
import { Icon } from './Icon';
import { Cover, IconButton } from './ui';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Autosaving note for one episode. While the episode plays in the browser,
 * "Zeitstempel" inserts the current position as [mm:ss].
 */
export function NoteEditor({
  showId,
  episodeId,
  autoFocus,
  rows = 6,
}: {
  showId: string;
  episodeId: string;
  autoFocus?: boolean;
  rows?: number;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const player = usePlayer();
  const note = useQuery({ queryKey: qk.note(showId, episodeId), queryFn: () => api.note(showId, episodeId) });
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (text === null && note.isSuccess) setText(note.data?.text ?? '');
  }, [note.isSuccess, note.data, text]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    setState('saving');
    try {
      const saved = await api.saveNote(showId, episodeId, value);
      qc.setQueryData(qk.note(showId, episodeId), saved);
      void qc.invalidateQueries({ queryKey: qk.notes });
      void qc.invalidateQueries({ queryKey: qk.show(showId) });
      setState(pending.current === null ? 'saved' : 'dirty');
    } catch (e) {
      setState('error');
      pending.current = value;
      toast({ message: `Notiz nicht gespeichert: ${(e as Error).message}`, tone: 'error' });
    }
  }, [showId, episodeId, qc, toast]);

  // Save whatever is left when the editor closes.
  useEffect(() => () => void flush(), [flush]);

  function change(value: string) {
    setText(value);
    pending.current = value;
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }

  const np = player.nowPlaying;
  const canStamp = np?.episodeId === episodeId && np.target.kind === 'browser';

  function insertTimestamp() {
    if (!np || text === null) return;
    const el = ref.current;
    const stamp = `[${formatClock(np.positionMs)}] `;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const next = before + prefix + stamp + text.slice(end);
    change(next);
    requestAnimationFrame(() => {
      const pos = start + prefix.length + stamp.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="note-editor">
      <textarea
        ref={ref}
        className="note-input"
        rows={rows}
        value={text ?? ''}
        disabled={text === null}
        autoFocus={autoFocus}
        placeholder={note.isLoading ? 'Lädt…' : 'Gedanken, Zitate, Links … – wird automatisch gespeichert'}
        onChange={(e) => change(e.target.value)}
        onBlur={() => void flush()}
        aria-label="Notiz"
      />
      <div className="note-toolbar">
        {canStamp && (
          <button type="button" className="btn btn-small" onClick={insertTimestamp}>
            <Icon name="clock" size={16} /> Zeitstempel {formatClock(np!.positionMs)}
          </button>
        )}
        <span className="muted tiny note-state">
          {state === 'dirty' && 'Ungespeichert…'}
          {state === 'saving' && 'Speichert…'}
          {state === 'saved' && 'Gespeichert'}
          {state === 'error' && <span className="text-error">Fehler beim Speichern</span>}
          {state === 'idle' && note.data?.updatedAt && `Zuletzt bearbeitet ${formatRelative(note.data.updatedAt)}`}
        </span>
      </div>
    </div>
  );
}

/** Note text with clickable timestamps that jump to that position. */
export function NoteText({ note, item }: { note: Pick<EpisodeNote, 'text'>; item: PlayableItem }) {
  const player = usePlayer();
  const jump = (ms: number) => {
    const np = player.nowPlaying;
    if (np?.episodeId === item.episode.id && np.target.kind === 'browser') player.seekTo(ms);
    else void player.play(item, { positionMs: ms });
  };
  return (
    <p className="note-text">
      {splitTimestamps(note.text).map((part, i) =>
        'ms' in part ? (
          <button key={i} type="button" className="timestamp" onClick={() => jump(part.ms)} title="Ab hier abspielen">
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
  const player = usePlayer();
  const np = player.nowPlaying;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!np) return null;
  const local = np.target.kind === 'browser';
  // Portal: the player bar is its own stacking context below the navigation.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet note-sheet" role="dialog" aria-modal="true" aria-label="Notiz" onClick={(e) => e.stopPropagation()}>
        <div className="row gap">
          <Cover src={np.imageUrl} alt={np.showName} size={44} />
          <div className="grow">
            <div className="player-title">{np.name}</div>
            <div className="muted small">
              {np.showName}
              {local && ` · ${formatClock(np.positionMs)} / ${formatClock(np.durationMs)}`}
            </div>
          </div>
          <IconButton icon="close" label="Schließen" onClick={onClose} />
        </div>
        {local && (
          <div className="row gap note-controls">
            <IconButton icon="rewind" label="15 Sekunden zurück" onClick={() => player.seekBy(-15_000)} />
            <IconButton
              icon={np.paused ? 'play' : 'pause'}
              label={np.paused ? 'Fortsetzen' : 'Pause'}
              variant="primary"
              onClick={player.togglePause}
            />
            <IconButton icon="forward" label="30 Sekunden vor" onClick={() => player.seekBy(30_000)} />
          </div>
        )}
        <NoteEditor showId={np.showId} episodeId={np.episodeId} autoFocus rows={10} />
      </div>
    </div>,
    document.body,
  );
}
