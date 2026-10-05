import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';
import { usePlayer, type PlayTarget } from '../lib/player';
import { qk, useInvalidateLibrary } from '../lib/queries';
import { useToast } from '../lib/toast';
import { Icon } from './Icon';
import { PlayerNoteSheet } from './Notes';
import { SpotifyLogo } from './SpotifyAttribution';
import { Cover, IconButton } from './ui';

export function PlayerBar() {
  const player = usePlayer();
  const toast = useToast();
  const invalidate = useInvalidateLibrary();
  const np = player.nowPlaying;
  const [dragging, setDragging] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  if (!np) return null;
  const local = np.target.kind === 'browser';

  return (
    <div className="player" role="region" aria-label="Player">
      {local && (
        <input
          className="player-seek"
          type="range"
          min={0}
          max={np.durationMs}
          step={1000}
          value={dragging ?? np.positionMs}
          aria-label="Position"
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={() => {
            if (dragging !== null) player.seekTo(dragging);
            setDragging(null);
          }}
          onKeyUp={() => {
            if (dragging !== null) player.seekTo(dragging);
            setDragging(null);
          }}
        />
      )}
      <div className="player-inner">
        <Cover src={np.imageUrl} alt={np.showName} size={44} />
        <div className="player-text">
          <div className="player-title">{np.name}</div>
          <div className="player-meta">
            <SpotifyLogo />
            <span className="muted small ellipsis">
              {np.showName}
              {local
                ? ` · ${formatClock(dragging ?? np.positionMs)} / ${formatClock(np.durationMs)}`
                : np.target.kind === 'device'
                  ? ` · auf ${np.target.name}`
                  : ''}
            </span>
          </div>
        </div>
        <div className="player-controls">
          {local && (
            <IconButton icon="rewind" label="15 Sekunden zurück" className="hide-narrow" onClick={() => player.seekBy(-15_000)} />
          )}
          {local && (
            <IconButton
              icon={np.paused ? 'play' : 'pause'}
              label={np.paused ? 'Fortsetzen' : 'Pause'}
              variant="primary"
              onClick={player.togglePause}
              size={22}
            />
          )}
          {local && (
            <IconButton icon="forward" label="30 Sekunden vor" className="hide-narrow" onClick={() => player.seekBy(30_000)} />
          )}
          <IconButton icon="note" label="Notiz schreiben" onClick={() => setNotesOpen(true)} />
          <IconButton
            icon="check"
            label="Als gehört markieren"
            active={np.completed}
            onClick={() => {
              api
                .setStatus(np.showId, np.episodeId, 'COMPLETED')
                .then(() => {
                  void invalidate();
                  toast({ message: 'Als gehört markiert', tone: 'success' });
                })
                .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
            }}
          />
          <IconButton icon="close" label="Player schließen" onClick={player.close} />
        </div>
      </div>
      {notesOpen && <PlayerNoteSheet onClose={() => setNotesOpen(false)} />}
    </div>
  );
}

/** Popover to choose where "Abspielen" plays: this browser, the Spotify app or a Connect device. */
export function PlayTargetPicker() {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const devices = useQuery({ queryKey: qk.devices, queryFn: api.devices, enabled: open, staleTime: 10_000 });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const t = player.target;
  const label = t.kind === 'browser' ? 'Browser' : t.kind === 'app' ? 'Spotify-App' : t.name;
  const choose = (next: PlayTarget) => {
    player.setTarget(next);
    setOpen(false);
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="target-btn" onClick={() => setOpen((o) => !o)} aria-label={`Wiedergabe auf: ${label}`}>
        <Icon name="device" size={18} />
        <span className="target-label">{label}</span>
      </button>
      {open && (
        <div className="menu-pop menu-pop-right" role="menu">
          <div className="menu-heading">Abspielen auf</div>
          {player.browserSupported && (
            <button type="button" role="menuitemradio" aria-checked={t.kind === 'browser'} className="menu-item" onClick={() => choose({ kind: 'browser' })}>
              <Radio on={t.kind === 'browser'} /> Diesem Browser
            </button>
          )}
          <button type="button" role="menuitemradio" aria-checked={t.kind === 'app'} className="menu-item" onClick={() => choose({ kind: 'app' })}>
            <Radio on={t.kind === 'app'} /> Spotify-App öffnen
          </button>
          <div className="menu-heading">Spotify Connect</div>
          {devices.isLoading && <div className="menu-note">Suche Geräte…</div>}
          {devices.error && <div className="menu-note">{(devices.error as Error).message}</div>}
          {devices.data?.length === 0 && <div className="menu-note">Keine Geräte. Öffne Spotify auf einem Gerät.</div>}
          {devices.data
            ?.filter((d) => d.name !== 'Podcast-Cockpit')
            .map((d) => (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                aria-checked={t.kind === 'device' && t.id === d.id}
                className="menu-item"
                onClick={() => choose({ kind: 'device', id: d.id, name: d.name })}
              >
                <Radio on={t.kind === 'device' && t.id === d.id} /> {d.name}
                <span className="muted small">{d.type}</span>
              </button>
            ))}
          <button type="button" className="menu-item" onClick={() => void devices.refetch()}>
            <Icon name="refresh" size={18} /> Geräte aktualisieren
          </button>
        </div>
      )}
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return <span className={`radio${on ? ' is-on' : ''}`} aria-hidden />;
}
