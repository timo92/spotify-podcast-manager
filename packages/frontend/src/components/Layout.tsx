import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDeletionDate, formatRelative, syncText } from '../lib/format';
import { qk, useInvalidateLibrary, useStatus } from '../lib/queries';
import { cx } from '../lib/cx';
import { useToast } from '../lib/toast';
import { Icon, type IconName } from './Icon';
import styles from './Layout.module.css';
import { PlayerBar, PlayTargetPicker } from './PlayerBar';

const NAV = [
  { to: '/', label: 'nav.today', icon: 'home' },
  { to: '/woche', label: 'nav.week', icon: 'calendar' },
  { to: '/podcasts', label: 'nav.podcasts', icon: 'list' },
  { to: '/verlauf', label: 'nav.history', icon: 'history' },
  { to: '/einstellungen', label: 'nav.settings', icon: 'settings' },
] as const satisfies readonly { to: string; label: string; icon: IconName }[];

export function SyncButton() {
  const { t } = useTranslation();
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
      title={sync?.lastSuccessAt ? t('sync.lastSynced', { when: formatRelative(sync.lastSuccessAt) }) : t('sync.title')}
      aria-label={t('sync.button')}
    >
      <Icon name="refresh" size={18} />
      <span className="pill-btn-label">{running ? t('sync.runningShort') : formatRelative(sync?.lastSuccessAt)}</span>
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
      const message = syncText(status?.sync);
      if (message) toast({ message, tone: now === 'error' ? 'error' : 'success' });
    }
    prev.current = now;
  }, [status?.sync?.status]);
}

export function Layout() {
  const { t } = useTranslation();
  useSyncWatcher();
  const { data: status } = useStatus();
  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <NavLink to="/" className={styles.brand}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Podcast-Cockpit</span>
        </NavLink>
        <nav className={styles.topnav} aria-label={t('nav.main')}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {t(n.label)}
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
            {t('banner.disconnected')}
            {status.disconnectedAt && ` ${t('banner.deletionDate', { date: formatDeletionDate(status.disconnectedAt) })}`}
          </span>
          <a className="btn btn-small" href="/api/auth/login">
            {t('banner.reconnect')}
          </a>
        </div>
      )}
      {status?.missingScopes && status.missingScopes.length > 0 && (
        <div className="banner banner-warn container">
          <span>{t('banner.missingScopes', { scopes: status.missingScopes.join(', ') })}</span>
          <a className="btn btn-small" href="/api/auth/login">
            {t('banner.reconnect')}
          </a>
        </div>
      )}
      <main className={cx('container', styles.main)}>
        <Outlet />
      </main>
      <PlayerBar />
      <nav className={styles.bottomnav} aria-label={t('nav.bottom')}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon name={n.icon} size={22} />
            <span>{t(n.label)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
