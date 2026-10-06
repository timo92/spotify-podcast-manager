import { useTranslation } from 'react-i18next';
import { cx } from '../lib/cx';
import styles from './SpotifyAttribution.module.css';

/**
 * Spotify attribution, required next to Spotify content (metadata, artwork,
 * playback) by Spotify's Design & Branding Guidelines:
 * - the official full logo (public/spotify/*.svg, unmodified), at least 70px wide,
 *   with clear space of half the icon height around it,
 * - the green logo only on white (or black) backgrounds, a monochrome logo on
 *   anything else,
 * - linked back to Spotify.
 */

/** What the logo sits on: a white card surface or the grey page background. */
type Background = 'surface' | 'page';

const LOGO_WIDTH = 78;

export function SpotifyLogo({ on = 'surface', className }: { on?: Background; className?: string }) {
  // Light theme: green on white surfaces, black on the grey page background.
  // Dark theme: white everywhere (no surface is pure black). CSS picks one.
  const light = on === 'surface' ? 'logo-green' : 'logo-black';
  return (
    <span className={cx(styles.logo, className)} role="img" aria-label="Spotify">
      <img className={styles.light} src={`/spotify/${light}.svg`} alt="" width={LOGO_WIDTH} />
      <img className={styles.dark} src="/spotify/logo-white.svg" alt="" width={LOGO_WIDTH} />
    </span>
  );
}

/** "Inhalte von <Spotify logo>", linking to the content on Spotify. */
export function SpotifyAttribution({ href, on = 'surface' }: { href?: string; on?: Background }) {
  const { t } = useTranslation();
  return (
    <a
      className={styles.attribution}
      href={href ?? 'https://open.spotify.com'}
      target="_blank"
      rel="noopener noreferrer"
      title={t('attribution.open')}
    >
      <span className="muted tiny">{t('attribution.contentFrom')}</span>
      <SpotifyLogo on={on} />
    </a>
  );
}

/**
 * Label of links back to Spotify, one of those the guidelines allow ("OPEN
 * SPOTIFY", "PLAY ON SPOTIFY", "LISTEN ON SPOTIFY"); kept in English as given
 * there.
 */
export const LISTEN_ON_SPOTIFY = 'LISTEN ON SPOTIFY';

/** Link button back to Spotify. */
export function ListenOnSpotify({ href, small }: { href: string; small?: boolean }) {
  return (
    <a className={`btn${small ? ' btn-small' : ''}`} href={href} target="_blank" rel="noopener noreferrer">
      {LISTEN_ON_SPOTIFY}
    </a>
  );
}
