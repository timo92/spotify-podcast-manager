import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EpisodeSheet } from '../../src/components/EpisodeSheet';
import { api } from '../../src/lib/api';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

describe('EpisodeSheet', () => {
  it('reads the episode back from Spotify when it opens, so progress from the Spotify app shows', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'episodeNotes').mockResolvedValue([]);
    vi.spyOn(api, 'show').mockResolvedValue({ show: show(), episodes: [episode(1)] });
    vi.spyOn(api, 'episode').mockResolvedValue(episode(1));
    const refreshed = episode(1, { status: 'IN_PROGRESS', statusSource: 'spotify', remainingMs: 5 * 60_000 });
    const refresh = vi.spyOn(api, 'refreshEpisode').mockResolvedValue(refreshed);
    vi.spyOn(api, 'today').mockRejectedValue(new Error('not needed'));
    vi.spyOn(api, 'shows').mockRejectedValue(new Error('not needed'));

    renderWithProviders(<EpisodeSheet showId="wissen" episodeId="ep-1" onClose={() => {}} />);
    expect(await screen.findByText('75 % gehört · noch 5 min')).toBeInTheDocument();
    expect(screen.getByText('Status aus Spotify')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('wissen', 'ep-1');
  });

  it('keeps the stored state if Spotify cannot be asked', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'episodeNotes').mockResolvedValue([]);
    vi.spyOn(api, 'show').mockResolvedValue({ show: show(), episodes: [episode(1)] });
    vi.spyOn(api, 'episode').mockResolvedValue(episode(1, { remainingMs: 10 * 60_000, status: 'IN_PROGRESS' }));
    vi.spyOn(api, 'refreshEpisode').mockRejectedValue(new Error('Spotify-Fehler 502'));

    renderWithProviders(<EpisodeSheet showId="wissen" episodeId="ep-1" onClose={() => {}} />);
    expect(await screen.findByText('50 % gehört · noch 10 min')).toBeInTheDocument();
    expect(screen.queryByText('Spotify-Fehler 502')).not.toBeInTheDocument();
  });
});
