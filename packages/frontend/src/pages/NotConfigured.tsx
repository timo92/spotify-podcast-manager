import type { Status } from '../lib/api';

/** Shown when the deployment has no Spotify client ID. There is nothing to enter here on purpose. */
export function NotConfiguredPage({ status }: { status: Status }) {
  return (
    <div className="auth-page">
      <div className="auth-card setup">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Spotify-App fehlt</h1>
        <p className="muted">
          Die Zugangsdaten der Spotify-App sind Teil der Installation und werden nicht hier eingegeben.
        </p>
        <ol className="steps">
          <li>
            Im{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">
              Spotify Developer Dashboard
            </a>{' '}
            eine App anlegen (APIs: <strong>Web API</strong> und <strong>Web Playback SDK</strong>) und diese
            Redirect-URI eintragen:
            <div className="copy-field">
              <code>{status.redirectUri}</code>
            </div>
          </li>
          <li>
            Client-ID als <code>SPOTIFY_CLIENT_ID</code> und das Secret in die <code>.env</code> eintragen
            (lokal) bzw. mit <code>pnpm run secret:put</code> im Parameter Store ablegen (AWS).
          </li>
          <li>Neu starten bzw. neu deployen – Details in der README.</li>
        </ol>
      </div>
    </div>
  );
}
