import { fireEvent, screen, within } from '@testing-library/react';
import type { EpisodeNote } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { NotesTab } from '../../src/pages/NotesTab';
import { settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function note(
  showId: string,
  episodeId: string,
  createdAt: string,
  text: string,
  episodeReleaseDate?: string,
  positionMs: number | null = null,
): EpisodeNote {
  const showName = showId === 'a' ? 'Alpha' : 'Beta';
  return {
    id: text,
    showId,
    episodeId,
    positionMs,
    text,
    createdAt,
    // A later edit doesn't move a note into another period.
    updatedAt: daysAgo(0),
    showName,
    episodeName: `Folge ${episodeId}`,
    episodeReleaseDate,
  };
}

const NOTES = [
  note('a', 'a2', daysAgo(0), 'heute notiert', '2026-01-02', 754_000),
  note('b', 'b1', daysAgo(20), 'vor zwanzig Tagen'),
  note('a', 'a1', daysAgo(20), 'auch vor zwanzig Tagen', '2026-01-01'),
  note('b', 'b0', daysAgo(400), 'vor langer Zeit'),
];

function renderTab() {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'notes').mockResolvedValue(NOTES);
  vi.spyOn(api, 'shows').mockResolvedValue([show({ id: 'a', name: 'Alpha' }), show({ id: 'b', name: 'Beta' })]);
  return renderWithProviders(<NotesTab onOpen={() => {}} />);
}

const episodeTitles = (root: HTMLElement = document.body) =>
  within(root)
    .queryAllByRole('button', { name: /^Folge / })
    .map((b) => b.textContent);

describe('NotesTab', () => {
  it('lists all notes, most recently written first, or groups them by podcast in episode order', async () => {
    const { user } = renderTab();
    expect(await screen.findByText('heute notiert')).toBeInTheDocument();
    expect(episodeTitles()).toEqual(['Folge a2', 'Folge b1', 'Folge a1', 'Folge b0']);

    await user.click(screen.getByRole('radio', { name: 'Nach Podcast' }));
    const [alpha, beta] = screen.getAllByRole('region');
    expect(within(alpha!).getByText('2 Notizen')).toBeInTheDocument();
    expect(episodeTitles(alpha)).toEqual(['Folge a1', 'Folge a2']);
    expect(within(beta!).getByText('Beta')).toBeInTheDocument();
  });

  it('limits notes to a period and searches within it', async () => {
    const { user } = renderTab();
    await screen.findByText('heute notiert');
    await user.click(screen.getByRole('button', { name: 'Letzte 30 Tage' }));
    expect(episodeTitles()).toEqual(['Folge a2', 'Folge b1', 'Folge a1']);

    await user.type(screen.getByPlaceholderText('Notizen durchsuchen'), 'zwanzig');
    expect(episodeTitles()).toEqual(['Folge b1', 'Folge a1']);
    await user.type(screen.getByPlaceholderText('Notizen durchsuchen'), ' gibt es nicht');
    expect(screen.getByText('Keine Notizen in diesem Zeitraum')).toBeInTheDocument();
  });

  it('shows each note of an episode on its own card with its position', async () => {
    const notes = [
      note('a', 'a1', daysAgo(1), 'zweiter Gedanke', '2026-01-01', 90_000),
      note('a', 'a1', daysAgo(2), 'erster Gedanke', '2026-01-01', 30_000),
    ];
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'notes').mockResolvedValue(notes);
    vi.spyOn(api, 'shows').mockResolvedValue([show({ id: 'a', name: 'Alpha' })]);
    const { user } = renderWithProviders(<NotesTab onOpen={() => {}} />);

    const positions = () =>
      screen.getAllByRole('article').map((c) => within(c).getByRole('button', { name: /^\d+:\d{2}$/ }).textContent);
    await screen.findByText('zweiter Gedanke');
    expect(positions()).toEqual(['1:30', '0:30']);

    await user.click(screen.getByRole('radio', { name: 'Nach Podcast' }));
    expect(positions()).toEqual(['0:30', '1:30']);

    await user.type(screen.getByPlaceholderText('Notizen durchsuchen'), 'zweiter');
    expect(positions()).toEqual(['1:30']);
  });

  it('filters by a custom date range', async () => {
    const { user } = renderTab();
    await screen.findByText('heute notiert');
    await user.click(screen.getByRole('button', { name: 'Zeitraum…' }));
    fireEvent.change(screen.getByLabelText('Bis'), { target: { value: daysAgo(10).slice(0, 10) } });
    expect(episodeTitles()).toEqual(['Folge b1', 'Folge a1', 'Folge b0']);
    fireEvent.change(screen.getByLabelText('Von'), { target: { value: daysAgo(100).slice(0, 10) } });
    expect(episodeTitles()).toEqual(['Folge b1', 'Folge a1']);
  });

  it('remembers grouping and period in this browser', async () => {
    const first = renderTab();
    await screen.findByText('heute notiert');
    await first.user.click(screen.getByRole('radio', { name: 'Nach Podcast' }));
    await first.user.click(screen.getByRole('button', { name: 'Letzte 30 Tage' }));
    first.unmount();

    renderTab();
    await screen.findByText('heute notiert');
    expect(screen.getByRole('radio', { name: 'Nach Podcast' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('vor langer Zeit')).not.toBeInTheDocument();
  });
});
