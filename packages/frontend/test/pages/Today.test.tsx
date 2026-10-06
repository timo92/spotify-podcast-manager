import { screen, within } from '@testing-library/react';
import type { AppStatus, SyncState, TodayResponse } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { TodayPage } from '../../src/pages/Today';
import { episode, plannedItem, settings, show, showLite } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const STATUS: AppStatus = { configured: true, authenticated: true, claimed: true, redirectUri: '' };

function today(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    plan: [],
    budgetMinutes: 30,
    recommendedMinutes: 30,
    budgetFit: 'perfect',
    recommended: [{ show: showLite(), episode: episode(1), label: 'NAECHSTE' }],
    more: [],
    noNewEpisode: [],
    recent: [],
    needsReviewCount: 0,
    newCount: 0,
    ...overrides,
  };
}

function renderToday(data: TodayResponse, { sync, path }: { sync?: SyncState; path?: string } = {}) {
  vi.spyOn(api, 'status').mockResolvedValue({ ...STATUS, sync });
  vi.spyOn(api, 'today').mockResolvedValue(data);
  return renderWithProviders(<TodayPage />, { path });
}

/** The episode sheet loads the episode, its podcast, its notes and Spotify's state. */
function mockEpisodeSheet(name: string) {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'episodeNotes').mockResolvedValue([]);
  vi.spyOn(api, 'show').mockResolvedValue({ show: show(), episodes: [episode(1, { name })] });
  const load = vi.spyOn(api, 'episode').mockResolvedValue(episode(1, { name }));
  vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { name }));
  return load;
}

const RUNNING: SyncState = { status: 'running' };
const extra = { show: showLite(), episode: episode(2), label: 'NAECHSTE' as const };

describe('TodayPage', () => {
  it('says how the suggestions fit the budget', async () => {
    renderToday(today({ recommendedMinutes: 40, budgetFit: 'slightlyOver' }));
    expect(await screen.findByText('40 / 30 min · knapp drüber')).toBeInTheDocument();
  });

  it('calls a selection beyond the tolerance over budget', async () => {
    renderToday(today({ recommendedMinutes: 60, budgetFit: 'over' }));
    expect(await screen.findByText('60 / 30 min · über Budget')).toBeInTheDocument();
  });

  it('offers to retry when the suggestions cannot be loaded', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(STATUS);
    const load = vi.spyOn(api, 'today').mockRejectedValueOnce(new Error('Keine Verbindung')).mockResolvedValue(today());
    const { user } = renderWithProviders(<TodayPage />);
    expect(await screen.findByText('Keine Verbindung')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Reise: Teil 1')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('links the podcasts without a new episode to their pages', async () => {
    renderToday(today({ noNewEpisode: [showLite(show({ id: 'ohne neu', name: 'Stille Folge' }))] }));
    expect(await screen.findByRole('heading', { name: 'Keine neue Folge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Stille Folge/ })).toHaveAttribute('href', '/podcasts/ohne%20neu');
  });

  describe('without recommendations', () => {
    it('says the plan used up the budget and points to the further episodes', async () => {
      renderToday(today({ plan: [plannedItem()], recommended: [], more: [extra] }));
      expect(await screen.findByText('Budget durch deinen Plan ausgeschöpft')).toBeInTheDocument();
      expect(screen.getByText(/Unten findest du weitere Folgen/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Weitere Folgen' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Außerdem empfohlen' })).toBeInTheDocument();
    });

    it('says nothing fits the budget when there is no plan', async () => {
      renderToday(today({ recommended: [], more: [extra] }));
      expect(await screen.findByText('Nichts passt ins Zeitbudget')).toBeInTheDocument();
      expect(screen.getByText(/Unten findest du weitere Folgen/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Heute empfohlen' })).toBeInTheDocument();
    });

    it('says everything is heard when no episode is open', async () => {
      renderToday(today({ recommended: [] }));
      expect(await screen.findByText('Alles gehört!')).toBeInTheDocument();
      expect(screen.getByText('Keine offenen Folgen. Zeit für etwas Neues?')).toBeInTheDocument();
      expect(screen.queryByText(/importiert/)).not.toBeInTheDocument();
    });

    it('explains the empty page while the first import runs', async () => {
      renderToday(today({ recommended: [] }), { sync: RUNNING });
      expect(
        await screen.findByText('Sobald der Import fertig ist, erscheinen hier deine Folgen.'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Deine Podcasts werden aus Spotify importiert/)).toBeInTheDocument();
    });
  });

  it('announces the import after the first login even when episodes are already shown', async () => {
    renderToday(today(), { sync: RUNNING, path: '/?welcome=1' });
    expect(await screen.findByText(/Deine Podcasts werden aus Spotify importiert/)).toBeInTheDocument();
  });

  it('does not announce an import for a sync while episodes are shown', async () => {
    renderToday(today(), { sync: RUNNING });
    expect(await screen.findByText('Reise: Teil 1')).toBeInTheDocument();
    expect(screen.queryByText(/Deine Podcasts werden aus Spotify importiert/)).not.toBeInTheDocument();
  });

  it('asks to review new podcasts and links to the review', async () => {
    renderToday(today({ needsReviewCount: 2 }));
    expect(await screen.findByText(/2 Podcasts warten auf deine Einordnung/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jetzt prüfen' })).toHaveAttribute('href', '/podcasts?pruefen=1');
  });

  it('holds the review back while a sync runs', async () => {
    renderToday(today({ needsReviewCount: 2 }), { sync: RUNNING });
    expect(await screen.findByText('Reise: Teil 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Jetzt prüfen' })).not.toBeInTheDocument();
  });

  it('shows why the last sync failed, translated when the error is known', async () => {
    renderToday(today(), { sync: { status: 'error', errorCode: 'spotify_unavailable', error: 'egal' } });
    expect(
      await screen.findByText('Letzter Sync fehlgeschlagen: Spotify antwortet nicht – bitte später erneut versuchen.'),
    ).toBeInTheDocument();
  });

  it('names an unknown sync error as such', async () => {
    renderToday(today(), { sync: { status: 'error' } });
    expect(await screen.findByText('Letzter Sync fehlgeschlagen: unbekannter Fehler')).toBeInTheDocument();
  });

  it('opens the episode sheet from a card', async () => {
    const load = mockEpisodeSheet('Reise: Teil 1');
    const { user } = renderToday(today());
    await user.click(await screen.findByRole('button', { name: 'Reise: Teil 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Folge' });
    expect(await within(sheet).findByRole('heading', { name: 'Reise: Teil 1' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('wissen', 'ep-1');

    await user.click(within(sheet).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the episode sheet from the recently heard list', async () => {
    const load = mockEpisodeSheet('Gestern gehört');
    const recent = [
      {
        showId: 'wissen',
        episodeId: 'ep-1',
        showName: 'Wissensreise',
        episodeName: 'Gestern gehört',
        status: 'COMPLETED' as const,
        at: new Date().toISOString(),
      },
    ];
    const { user } = renderToday(today({ recent }));
    const section = (await screen.findByRole('heading', { name: 'Zuletzt gehört' })).closest('section')!;
    expect(within(section).getByText('Wissensreise · gerade eben')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Gestern gehört' }));
    const sheet = await screen.findByRole('dialog', { name: 'Folge' });
    expect(await within(sheet).findByRole('heading', { name: 'Gestern gehört' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('wissen', 'ep-1');
  });
});
