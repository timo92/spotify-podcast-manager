import { act, screen } from '@testing-library/react';
import type { AppStatus, SyncState, TodayResponse } from '@podcast/shared';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '../../src/components/Layout';
import { api } from '../../src/lib/api';
import { TodayPage } from '../../src/pages/Today';
import { episode, showLite } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

function status(overrides: Partial<AppStatus> = {}): AppStatus {
  return {
    configured: true,
    authenticated: true,
    claimed: true,
    redirectUri: '',
    spotifyConnected: true,
    sync: { status: 'idle', lastSuccessAt: new Date().toISOString() },
    ...overrides,
  };
}

function today(recommended: TodayResponse['recommended']): TodayResponse {
  return {
    plan: [],
    budgetMinutes: 30,
    recommendedMinutes: 20,
    budgetFit: 'under',
    recommended,
    more: [],
    noNewEpisode: [],
    recent: [],
    needsReviewCount: 0,
    newCount: 0,
  };
}

/** The layout around the today page, as the app routes them. */
function renderApp() {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TodayPage />} />
      </Route>
    </Routes>,
  );
}

const syncButton = () => screen.findByRole('button', { name: 'Mit Spotify synchronisieren' });

afterEach(() => vi.useRealTimers());

describe('Layout', () => {
  it('disables the sync button while a sync runs', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status({ sync: { status: 'running' } }));
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    const sync = vi.spyOn(api, 'sync');
    const { user } = renderApp();
    expect(await screen.findByText('Sync läuft…')).toBeInTheDocument();
    const button = await syncButton();
    expect(button).toBeDisabled();
    await user.click(button);
    expect(sync).not.toHaveBeenCalled();
  });

  it('starts a sync and reads the status again', async () => {
    const statusCall = vi.spyOn(api, 'status').mockResolvedValue(status());
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    const sync = vi.spyOn(api, 'sync').mockResolvedValue({ status: 'running' });
    const { user } = renderApp();
    const button = await syncButton();
    expect(button).toBeEnabled();
    await user.click(button);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(statusCall).toHaveBeenCalledTimes(2));
  });

  it('reports a sync that cannot start', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status());
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    vi.spyOn(api, 'sync').mockRejectedValue(new Error('Ein Sync läuft bereits.'));
    const { user } = renderApp();
    await user.click(await syncButton());
    expect(await screen.findByText('Ein Sync läuft bereits.')).toBeInTheDocument();
  });

  it('reports a finished sync and reloads the library', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done: SyncState = { status: 'idle', lastSuccessAt: new Date().toISOString(), showsSynced: 3, newEpisodes: 5 };
    vi.spyOn(api, 'status')
      .mockResolvedValueOnce(status({ sync: { status: 'running' } }))
      .mockResolvedValue(status({ sync: done }));
    const todayCall = vi
      .spyOn(api, 'today')
      .mockResolvedValueOnce(today([]))
      .mockResolvedValue(today([{ show: showLite(), episode: episode(1), label: 'NEU' }]));
    renderApp();
    expect(await screen.findByText('Sobald der Import fertig ist, erscheinen hier deine Folgen.')).toBeInTheDocument();

    // the status is read again every two seconds while a sync runs
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByText('3 Podcasts synchronisiert, 5 neue Folgen.')).toBeInTheDocument();
    expect(await screen.findByText('Reise: Teil 1')).toBeInTheDocument();
    expect(todayCall).toHaveBeenCalledTimes(2);
  });

  it('reports a failed sync as an error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, 'status')
      .mockResolvedValueOnce(status({ sync: { status: 'running' } }))
      .mockResolvedValue(status({ sync: { status: 'error', errorCode: 'spotify_unavailable' } }));
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    renderApp();
    await screen.findByText('Sync läuft…');

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(
      await screen.findByText('Sync fehlgeschlagen: Spotify antwortet nicht – bitte später erneut versuchen.'),
    ).toBeInTheDocument();
  });

  it('warns that Spotify was disconnected and names the day the data is deleted', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(
      status({ spotifyConnected: false, disconnectedAt: '2026-10-01T10:00:00Z' }),
    );
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    renderApp();
    expect(
      await screen.findByText(
        'Die Verbindung zu Spotify wurde getrennt. Ohne neue Anmeldung werden deine Daten am 31. Oktober 2026 gelöscht.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Neu verbinden' })).toHaveAttribute('href', '/api/auth/login');
  });

  it('warns about a disconnection without a known date', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status({ spotifyConnected: false }));
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    renderApp();
    expect(await screen.findByText('Die Verbindung zu Spotify wurde getrennt.')).toBeInTheDocument();
  });

  it('names the missing Spotify permissions and offers to reconnect', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status({ missingScopes: ['user-read-playback-position', 'streaming'] }));
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    renderApp();
    expect(
      await screen.findByText(
        'Spotify-Berechtigungen fehlen (user-read-playback-position, streaming). Einige Funktionen sind eingeschränkt.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Neu verbinden' })).toHaveAttribute('href', '/api/auth/login');
  });

  it('shows no banner while Spotify is connected with every permission', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status({ missingScopes: [] }));
    vi.spyOn(api, 'today').mockResolvedValue(today([]));
    renderApp();
    expect(await screen.findByText('Alles gehört!')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Neu verbinden' })).not.toBeInTheDocument();
  });
});
