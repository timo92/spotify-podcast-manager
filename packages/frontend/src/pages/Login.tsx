import { useSearchParams } from 'react-router-dom';
import type { Status } from '../lib/api';

const ERRORS: Record<string, string> = {
  access_denied: 'Du hast den Zugriff in Spotify abgelehnt.',
  state_mismatch: 'Die Anmeldung ist abgelaufen. Bitte erneut versuchen.',
  wrong_account: 'Dieser Spotify-Account ist nicht der Besitzer dieser App.',
  spotify_invalid_client: 'Spotify lehnt Client-ID/Secret ab.',
  spotify_user_not_allowed:
    'Dein Spotify-Account ist nicht in der User-Liste der Spotify-App eingetragen (Dashboard → User Management).',
  token_exchange_failed: 'Spotify-Anmeldung fehlgeschlagen. Stimmt die Redirect-URI?',
  invalid_client: 'Spotify kennt diese Client-ID nicht.',
  not_configured: 'Die Spotify-App ist in dieser Installation nicht konfiguriert.',
};

export function LoginPage({ status }: { status: Status }) {
  const [params] = useSearchParams();
  const error = params.get('error');
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Podcast-Cockpit</h1>
        <p className="muted">Was ist neu, und welche Folge ist als Nächstes dran?</p>
        {error && (
          <div className="banner banner-error" role="alert">
            {ERRORS[error] ?? `Anmeldung fehlgeschlagen (${error}).`}
          </div>
        )}
        <a className="btn btn-primary btn-block" href="/api/auth/login">
          Mit Spotify anmelden
        </a>
        <p className="muted small">Redirect-URI: {status.redirectUri}</p>
      </div>
    </div>
  );
}
