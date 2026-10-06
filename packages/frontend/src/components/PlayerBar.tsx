import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';
import { cx } from '../lib/cx';
import i18n from '../i18n';
import { usePlayer, type NowPlaying, type PlayTarget } from '../lib/player';
import { qk, useInvalidateLibrary } from '../lib/queries';
import { useToast } from '../lib/toast';
import { Icon } from './Icon';
import { PlayerNoteSheet } from './Notes';
import { NowPlayingTitle } from './NowPlaying';
import styles from './PlayerBar.module.css';
import { Cover, IconButton } from './ui';

/** Position (once Spotify reported it), device and pause state of playback outside the browser. */
function remoteDetail(np: NowPlaying): string {
  const device = np.deviceName ?? (np.target.kind === 'device' ? np.target.name : undefined);
  const parts = [
    np.deviceName !== undefined ? `${formatClock(np.positionMs)} / ${formatClock(np.durationMs)}` : undefined,
    device ? i18n.t('onDevice', { ns: 'player', device }) : undefined,
    np.paused ? i18n.t('ui.paused') : undefined,
  ].filter((p): p is string => !!p);
  return parts.map((p) => ` · ${p}`).join('');
}

export function PlayerBar() {
  const { t } = useTranslation('player');
  const player = usePlayer();
  const toast = useToast();
  const invalidate = useInvalidateLibrary();
  const np = player.nowPlaying;
  const [dragging, setDragging] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  if (!np) return null;
  const local = np.target.kind === 'browser';

  return (
    <div className={styles.player} role="region" aria-label={t('region')} data-player-bar>
      {local && (
        <input
          className={styles.seek}
          type="range"
          min={0}
          max={np.durationMs}
          step={1000}
          value={dragging ?? np.positionMs}
          aria-label={t('position')}
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
      <div className={styles.inner}>
        <Cover src={np.imageUrl} alt={np.showName} size={44} />
        <div className={styles.text}>
          <NowPlayingTitle
            np={np}
            detail={
              local ? ` · ${formatClock(dragging ?? np.positionMs)} / ${formatClock(np.durationMs)}` : remoteDetail(np)
            }
          />
        </div>
        <div className={styles.controls}>
          {local && (
            <IconButton
              icon="rewind"
              label={t('back15')}
              className={styles.hideNarrow}
              onClick={() => player.seekBy(-15_000)}
            />
          )}
          {local && (
            <IconButton
              icon={np.paused ? 'play' : 'pause'}
              label={np.paused ? t('resume') : t('pause')}
              variant="primary"
              onClick={player.togglePause}
              size={22}
            />
          )}
          {local && (
            <IconButton
              icon="forward"
              label={t('forward30')}
              className={styles.hideNarrow}
              onClick={() => player.seekBy(30_000)}
            />
          )}
          <IconButton icon="note" label={t('writeNote')} onClick={() => setNotesOpen(true)} />
          <IconButton
            icon="check"
            label={t('episode.markPlayed', { ns: 'common' })}
            active={np.completed}
            onClick={() => {
              api
                .setStatus(np.showId, np.episodeId, 'COMPLETED')
                .then(() => {
                  void invalidate();
                  toast({ message: t('episode.done.COMPLETED', { ns: 'common' }), tone: 'success' });
                })
                .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
            }}
          />
          <IconButton icon="close" label={t('close')} onClick={player.close} />
        </div>
      </div>
      {notesOpen && <PlayerNoteSheet onClose={() => setNotesOpen(false)} />}
    </div>
  );
}

/** Popover to choose where "Abspielen" plays: this browser, the Spotify app or a Connect device. */
export function PlayTargetPicker() {
  const { t } = useTranslation('player');
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

  const target = player.target;
  const label = target.kind === 'browser' ? t('target.browser') : target.kind === 'app' ? t('target.app') : target.name;
  const choose = (next: PlayTarget) => {
    player.setTarget(next);
    setOpen(false);
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="pill-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('target.label', { target: label })}
      >
        <Icon name="device" size={18} />
        <span className="pill-btn-label">{label}</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-heading">{t('target.heading')}</div>
          {player.browserSupported && (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={target.kind === 'browser'}
              className="menu-item"
              onClick={() => choose({ kind: 'browser' })}
            >
              <Radio on={target.kind === 'browser'} /> {t('target.thisBrowser')}
            </button>
          )}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={target.kind === 'app'}
            className="menu-item"
            onClick={() => choose({ kind: 'app' })}
          >
            <Radio on={target.kind === 'app'} /> {t('target.openApp')}
          </button>
          <div className="menu-heading">{t('target.connect')}</div>
          {devices.isLoading && <div className="menu-note">{t('target.searching')}</div>}
          {devices.error && <div className="menu-note">{(devices.error as Error).message}</div>}
          {devices.data?.length === 0 && <div className="menu-note">{t('target.noDevices')}</div>}
          {devices.data
            ?.filter((d) => d.name !== 'Podcast-Cockpit')
            .map((d) => (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                aria-checked={target.kind === 'device' && target.id === d.id}
                className="menu-item"
                onClick={() => choose({ kind: 'device', id: d.id, name: d.name })}
              >
                <Radio on={target.kind === 'device' && target.id === d.id} /> {d.name}
                <span className="muted small">{d.type}</span>
              </button>
            ))}
          <button type="button" className="menu-item" onClick={() => void devices.refetch()}>
            <Icon name="refresh" size={18} /> {t('target.refresh')}
          </button>
        </div>
      )}
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return <span className={cx(styles.radio, on && styles.isOn)} aria-hidden />;
}
