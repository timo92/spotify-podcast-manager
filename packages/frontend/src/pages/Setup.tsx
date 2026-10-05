import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Status } from '../lib/api';
import { qk } from '../lib/queries';
import { ErrorBox } from '../components/ui';

export function SetupPage({ status }: { status: Status }) {
  const qc = useQueryClient();
  const [setupCode, setSetupCode] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (status.claimed && !status.authenticated) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Bereits eingerichtet</h1>
          <p>Die App ist mit einem Spotify-Account verknüpft. Bitte melde dich an.</p>
          <a className="btn btn-primary btn-block" href="/api/auth/login">
            Mit Spotify anmelden
          </a>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.setup({ setupCode, clientId, clientSecret });
      await qc.invalidateQueries({ queryKey: qk.status });
      window.location.href = res.loginUrl;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card setup" onSubmit={submit}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Podcast-Cockpit einrichten</h1>
        <p className="muted">
          Dein persönliches Cockpit vor Spotify. Einmalig brauchst du eine eigene Spotify-App, damit nur du Zugriff hast.
        </p>

        <ol className="steps">
          <li>
            Öffne das{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">
              Spotify Developer Dashboard
            </a>{' '}
            und erstelle eine App. Wähle bei „APIs used“ <strong>Web API</strong> und <strong>Web Playback SDK</strong>.
          </li>
          <li>
            Trage diese Redirect-URI ein:
            <div className="copy-field">
              <code>{status.redirectUri}</code>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  void navigator.clipboard?.writeText(status.redirectUri).then(() => setCopied(true));
                }}
              >
                {copied ? 'Kopiert' : 'Kopieren'}
              </button>
            </div>
          </li>
          <li>Kopiere Client-ID und Client-Secret aus den App-Einstellungen hierher.</li>
        </ol>

        {status.setupCodeRequired && (
          <label className="field">
            <span>Setup-Code</span>
            <input
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              autoComplete="off"
              required
              placeholder="aus der Ausgabe von cdk deploy"
            />
            <small className="muted">Schützt die Einrichtung, bis du dich das erste Mal angemeldet hast.</small>
          </label>
        )}
        <label className="field">
          <span>Client-ID</span>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required spellCheck={false} />
        </label>
        <label className="field">
          <span>Client-Secret</span>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
            required
            spellCheck={false}
          />
        </label>
        {error != null && <ErrorBox error={error} />}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Prüfe…' : 'Speichern & mit Spotify verbinden'}
        </button>
        <p className="muted small">
          Das Secret wird nur auf deinem Server gespeichert. Dein Spotify-Passwort sieht die App nie – die Anmeldung läuft
          über Spotify.
        </p>
      </form>
    </div>
  );
}
