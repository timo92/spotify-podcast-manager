import { screen, within } from '@testing-library/react';
import type { EpisodeProgress } from '@podcast/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { HistoryPage } from '../../src/pages/History';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const MIN = 60_000;

function heard(episodeName: string, at: Date, durationMs?: number, overrides: Partial<EpisodeProgress> = {}) {
  return {
    showId: 'wissen',
    episodeId: episodeName.toLowerCase().replaceAll(' ', '-'),
    status: 'COMPLETED',
    listenedAt: at.toISOString(),
    updatedAt: at.toISOString(),
    episodeName,
    showName: 'Wissensreise',
    durationMs,
    ...overrides,
  } satisfies EpisodeProgress;
}

function renderHistory(history: EpisodeProgress[], path = '/verlauf') {
  const load = vi.spyOn(api, 'history').mockResolvedValue(history);
  return { load, ...renderWithProviders(<HistoryPage />, { path }) };
}

const group = (label: string) => screen.getByRole('heading', { name: label }).closest('section')!;
const names = (section: HTMLElement) =>
  within(section)
    .getAllByRole('button')
    .map((b) => b.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Tuesday, 6 October 2026, noon in the test's time zone
  vi.setSystemTime(new Date(2026, 9, 6, 12));
});
afterEach(() => vi.useRealTimers());

describe('HistoryPage', () => {
  it('explains that the server cannot be reached instead of showing the browser message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderWithProviders(<HistoryPage />);
    expect(await screen.findByText('Keine Verbindung zum Server')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('groups the heard episodes into today, yesterday and older dates', async () => {
    const { load } = renderHistory([
      heard('Heute früh', new Date(2026, 9, 6, 7), 20 * MIN),
      heard('Gestern spät', new Date(2026, 9, 5, 23, 30), 30 * MIN),
      heard('Gestern früh', new Date(2026, 9, 5, 6), 10 * MIN),
      heard('Letzte Woche', new Date(2026, 9, 1, 8), 15 * MIN),
    ]);
    expect(await screen.findByRole('heading', { name: 'Heute' })).toBeInTheDocument();
    expect(names(group('Heute'))).toEqual(['Heute früh']);
    expect(names(group('Gestern'))).toEqual(['Gestern spät', 'Gestern früh']);
    expect(names(group('Donnerstag, 1. Oktober'))).toEqual(['Letzte Woche']);
    expect(within(group('Gestern')).getByText('· 30 min', { exact: false })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(200);
  });

  it('dates an episode without a listening time by its last change', async () => {
    renderHistory([
      heard('Übersprungen', new Date(2026, 9, 5, 9), undefined, { status: 'SKIPPED', listenedAt: undefined }),
    ]);
    expect(await screen.findByRole('heading', { name: 'Gestern' })).toBeInTheDocument();
    expect(names(group('Gestern'))).toEqual(['Übersprungen']);
  });

  it('adds up the listening time of the last seven days only', async () => {
    renderHistory([
      heard('Heute', new Date(2026, 9, 6, 7), 20 * MIN),
      heard('Vor drei Tagen', new Date(2026, 9, 3, 7), 45 * MIN),
      heard('Ohne Dauer', new Date(2026, 9, 2, 7)),
      heard('Vor acht Tagen', new Date(2026, 8, 28, 11), 60 * MIN),
    ]);
    expect(await screen.findByText('1 h 05 min in den letzten 7 Tagen')).toBeInTheDocument();
  });

  it('shows the plain heading when nothing was heard in the last seven days', async () => {
    renderHistory([heard('Vor acht Tagen', new Date(2026, 8, 28, 11), 60 * MIN)]);
    expect(await screen.findByText('Montag, 28. September')).toBeInTheDocument();
    expect(screen.getByText('Zuletzt gehörte Folgen')).toBeInTheDocument();
  });

  it('says that nothing was heard yet', async () => {
    renderHistory([]);
    expect(await screen.findByText('Noch nichts gehört')).toBeInTheDocument();
    expect(screen.getByText('Markiere Folgen als gehört – sie erscheinen dann hier.')).toBeInTheDocument();
  });

  it('opens a heard episode in the episode sheet', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'episodeNotes').mockResolvedValue([]);
    vi.spyOn(api, 'show').mockResolvedValue({ show: show(), episodes: [episode(1)] });
    const load = vi.spyOn(api, 'episode').mockResolvedValue(episode(1));
    vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1));
    const { user } = renderHistory([heard('Reise: Teil 1', new Date(2026, 9, 6, 7), 20 * MIN, { episodeId: 'ep-1' })]);
    await user.click(await screen.findByRole('button', { name: 'Reise: Teil 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Folge' });
    expect(await within(sheet).findByRole('heading', { name: 'Reise: Teil 1' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('wissen', 'ep-1');

    await user.click(within(sheet).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the notes tab from the address', async () => {
    vi.spyOn(api, 'notes').mockResolvedValue([]);
    vi.spyOn(api, 'shows').mockResolvedValue([]);
    const history = vi.spyOn(api, 'history');
    renderWithProviders(<HistoryPage />, { path: '/verlauf?tab=notizen' });
    expect(screen.getByRole('radio', { name: 'Notizen' })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Noch keine Notizen')).toBeInTheDocument();
    expect(history).not.toHaveBeenCalled();
  });

  it('switches between the heard episodes and the notes', async () => {
    vi.spyOn(api, 'notes').mockResolvedValue([]);
    vi.spyOn(api, 'shows').mockResolvedValue([]);
    const { user } = renderHistory([]);
    expect(await screen.findByText('Noch nichts gehört')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Notizen' }));
    expect(await screen.findByText('Noch keine Notizen')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Gehört' }));
    expect(await screen.findByText('Noch nichts gehört')).toBeInTheDocument();
  });
});
