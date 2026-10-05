import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDeletionDate, formatRelative } from '../lib/format';
import { qk, useInvalidateLibrary, useStatus } from '../lib/queries';
import { cx } from '../lib/cx';
import { useToast } from '../lib/toast';
import { Icon, type IconName } from './Icon';
import styles from './Layout.module.css';
import { PlayerBar, PlayTargetPicker } from './PlayerBar';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Heute', icon: 'home' },
  { to: '/woche', label: 'Woche', icon: 'calendar' },
  { to: '/podcasts', label: 'Podcasts', icon: 'list' },
  { to: '/verlauf', label: 'Verlauf', icon: 'history' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'settings' },
];

export function SyncButton() {
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const sync = status?.sync;
  const running = sync?.status === 'running';
  return (
    <button
      type="button"
      className={cx('pill-btn', running && 'is-running')}
      disabled={running}
      onClick={() => {
        api
          .sync()
          .then(() => qc.invalidateQueries({ queryKey: qk.status }))
          .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
      }}
      title={sync?.lastSuccessAt ? `Zuletzt synchronisiert ${formatRelative(sync.lastSuccessAt)}` : 'Synchronisieren'}
      aria-label="Mit Spotify synchronisieren"
    >
      <Icon name="refresh" size={18} />
      <span className="pill-btn-label">{running ? 'Sync läuft…' : formatRelative(sync?.lastSuccessAt)}</span>
    </button>
  );
}

/** Refreshes data and reports the outcome when a sync finishes. */
function useSyncWatcher() {
  const { data: status } = useStatus();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  const prev = useRef(status?.sync?.status);
  useEffect(() => {
    const now = status?.sync?.status;
    if (prev.current === 'running' && now && now !== 'running') {
      void invalidate();
      if (now === 'error') toast({ message: `Sync fehlgeschlagen: ${status?.sync?.error ?? ''}`, tone: 'error' });
      else if (status?.sync?.message) toast({ message: status.sync.message, tone: 'success' });
    }
    prev.current = now;
  }, [status?.sync?.status]);
}

export function Layout() {
  useSyncWatcher();
  const { data: status } = useStatus();
  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <NavLink to="/" className={styles.brand}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Podcast-Cockpit</span>
        </NavLink>
        <nav className={styles.topnav} aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.actions}>
          <PlayTargetPicker />
          <SyncButton />
        </div>
      </header>
      {status?.spotifyConnected === false && (
        <div className="banner banner-error container">
          <span>
            Die Verbindung zu Spotify wurde getrennt.
            {status.disconnectedAt &&
              ` Ohne neue Anmeldung werden deine Daten am ${formatDeletionDate(status.disconnectedAt)} gelöscht.`}
          </span>
          <a className="btn btn-small" href="/api/auth/login">
            Neu verbinden
          </a>
        </div>
      )}
      {status?.missingScopes && status.missingScopes.length > 0 && (
        <div className="banner banner-warn container">
          <span>
            Spotify-Berechtigungen fehlen ({status.missingScopes.join(', ')}). Einige Funktionen sind eingeschränkt.
          </span>
          <a className="btn btn-small" href="/api/auth/login">
            Neu verbinden
          </a>
        </div>
      )}
      <main className={cx('container', styles.main)}>
        <Outlet />
      </main>
      <PlayerBar />
      <nav className={styles.bottomnav} aria-label="Navigation">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
