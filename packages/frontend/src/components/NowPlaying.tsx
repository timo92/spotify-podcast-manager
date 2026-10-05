import type { NowPlaying } from '../lib/player';
import styles from './NowPlaying.module.css';
import { SpotifyLogo } from './SpotifyAttribution';

/** Title, Spotify logo and show of the playing episode; `detail` follows the show name. */
export function NowPlayingTitle({ np, detail }: { np: NowPlaying; detail?: string }) {
  return (
    <>
      <div className={styles.title}>{np.name}</div>
      <div className={styles.meta}>
        <SpotifyLogo className={styles.logo} />
        <span className="muted small ellipsis">
          {np.showName}
          {detail}
        </span>
      </div>
    </>
  );
}
