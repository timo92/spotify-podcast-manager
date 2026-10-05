import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@podcast/shared';
import { Icon } from '../components/Icon';
import { Chip, ErrorBox, Segmented, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { qk, useInvalidateLibrary, useSettings, useStatus } from '../lib/queries';
import { useToast } from '../lib/toast';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('pm.theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function SettingsPage() {
  const settings = useSettings();
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [newCat, setNewCat] = useState('');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [confirmDelete, setConfirmDelete] = useState('');

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  useEffect(() => {
    try {
      if (theme === 'system') {
        localStorage.removeItem('pm.theme');
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem('pm.theme', theme);
        document.documentElement.dataset.theme = theme;
      }
    } catch {
      // ignore
    }
  }, [theme]);

  if (settings.isLoading || !draft) return <Spinner />;
  if (settings.error) return <ErrorBox error={settings.error} />;

  async function save(patch: Partial<Settings>) {
    const next = { ...draft!, ...patch };
    setDraft(next);
    try {
      const saved = await api.saveSettings(next);
      qc.setQueryData(qk.settings, saved);
      await invalidate();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  async function run(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast({ message, tone: 'success' });
      await qc.invalidateQueries();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  const sync = status?.sync;

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>Einstellungen</h1>
      </header>

      <section className="card stack">
        <h2 className="h3">Tagesbudget</h2>
        <label className="field">
          <span>Audio pro Tag: {draft.audioBudgetMinutes ? `${draft.audioBudgetMinutes} min` : 'kein Limit'}</span>
          <input
            type="range"
            min={0}
            max={180}
            step={5}
            value={draft.audioBudgetMinutes}
            onChange={(e) => setDraft({ ...draft, audioBudgetMinutes: Number(e.target.value) })}
            onPointerUp={() => void save({})}
            onKeyUp={() => void save({})}
          />
        </label>
        <label className="field">
          <span>Toleranz: {draft.budgetTolerancePercent} %</span>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={draft.budgetTolerancePercent}
            onChange={(e) => setDraft({ ...draft, budgetTolerancePercent: Number(e.target.value) })}
            onPointerUp={() => void save({})}
            onKeyUp={() => void save({})}
          />
          <small className="muted">Wie weit eine Auswahl das Budget überschreiten darf.</small>
        </label>
      </section>

      <section className="card stack">
        <h2 className="h3">Folgen</h2>
        <label className="field">
          <span>„Neu“ heißt: erschienen in den letzten {draft.newWindowDays} Tagen</span>
          <input
            type="range"
            min={1}
            max={30}
            value={draft.newWindowDays}
            onChange={(e) => setDraft({ ...draft, newWindowDays: Number(e.target.value) })}
            onPointerUp={() => void save({})}
            onKeyUp={() => void save({})}
          />
        </label>
        <Toggle
          label="Spotify-Hörstand übernehmen"
          hint="Folgen, die Spotify als vollständig gehört meldet, gelten als gehört. Eigene Markierungen haben immer Vorrang."
          checked={draft.useSpotifyPlayedState}
          onChange={(v) => void save({ useSpotifyPlayedState: v })}
        />
        <Toggle
          label="Automatisch als gehört markieren"
          hint="Wenn eine Folge im Browser-Player zu Ende läuft"
          checked={draft.autoCompleteInPlayer}
          onChange={(v) => void save({ autoCompleteInPlayer: v })}
        />
      </section>

      <section className="card stack">
        <h2 className="h3">Kategorien</h2>
        <div className="chips">
          {draft.categories.map((c) => (
            <Chip key={c} onClick={() => void save({ categories: draft.categories.filter((x) => x !== c) })}>
              {c} <Icon name="close" size={14} />
            </Chip>
          ))}
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCat.trim()) return;
              void save({ categories: [...draft.categories, newCat.trim()] });
              setNewCat('');
            }}
          >
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="+ Kategorie" aria-label="Neue Kategorie" />
          </form>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h3">Darstellung</h2>
        <Segmented
          label="Farbschema"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Hell' },
            { value: 'dark', label: 'Dunkel' },
          ]}
        />
      </section>

      <section className="card stack">
        <h2 className="h3">Synchronisierung</h2>
        <p className="muted small">
          Automatisch alle 2 Stunden (neue Folgen), einmal täglich vollständig.
          {sync?.lastSuccessAt && ` Zuletzt erfolgreich: ${formatDateTime(sync.lastSuccessAt)}.`}
          {sync?.message && ` ${sync.message}`}
        </p>
        {sync?.status === 'error' && <ErrorBox error={sync.error} />}
        <div className="row gap wrap">
          <button className="btn" disabled={sync?.status === 'running'} onClick={() => void run(() => api.sync(false), 'Sync gestartet')}>
            <Icon name="refresh" size={18} /> Jetzt synchronisieren
          </button>
          <button className="btn" disabled={sync?.status === 'running'} onClick={() => void run(() => api.sync(true), 'Vollständiger Sync gestartet')}>
            Alles neu laden
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h3">Spotify</h2>
        <p className="small">
          Verbunden als <strong>{status?.user?.displayName ?? status?.user?.id ?? '–'}</strong>
        </p>
        {status?.missingScopes && status.missingScopes.length > 0 && (
          <div className="banner banner-warn">Fehlende Berechtigungen: {status.missingScopes.join(', ')}</div>
        )}
        <div className="row gap wrap">
          <a className="btn" href="/api/auth/login">
            Neu verbinden
          </a>
          <button
            className="btn"
            onClick={() =>
              void api.logout().then(() => {
                window.location.href = '/';
              })
            }
          >
            Abmelden
          </button>
        </div>
        <p className="muted small">Redirect-URI für die Spotify-App: {status?.redirectUri}</p>
      </section>

      <section className="card stack">
        <h2 className="h3">Daten</h2>
        <div className="row gap wrap">
          <a className="btn" href="/api/export" download>
            Export (JSON)
          </a>
        </div>
        <details>
          <summary className="text-error">Alle Daten löschen</summary>
          <p className="small">
            Löscht Fortschritt, Einstellungen, Spotify-Token und Zugangsdaten unwiderruflich. Danach muss die App neu eingerichtet
            werden. Tippe <strong>LÖSCHEN</strong> zur Bestätigung.
          </p>
          <div className="row gap">
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} aria-label="Bestätigung" />
            <button
              className="btn btn-danger"
              disabled={confirmDelete !== 'LÖSCHEN'}
              onClick={() =>
                void api.deleteAll().then(() => {
                  window.location.href = '/';
                })
              }
            >
              Endgültig löschen
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
