import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayButton } from '../../src/components/EpisodeCard';
import { api, ApiError } from '../../src/lib/api';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const ITEM = { show: show(), episode: episode(1) };

function renderOnDevice() {
  localStorage.setItem('pm.playTarget', JSON.stringify({ kind: 'device', id: 'iphone', name: 'iPhone' }));
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  return renderWithProviders(<PlayButton item={ITEM} />);
}

describe('PlayButton on a Spotify Connect device', () => {
  it('explains an unreachable device and offers to open the episode in Spotify', async () => {
    vi.spyOn(api, 'play').mockRejectedValue(new ApiError(404, 'device_unavailable', 'Gerät nicht erreichbar'));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = renderOnDevice();

    await user.click(screen.getByRole('button', { name: /Abspielen/ }));
    expect(api.play).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'iphone', episodeId: 'ep-1' }));
    expect(
      await screen.findByText(
        '„iPhone“ ist gerade nicht erreichbar. Öffne Spotify dort und versuche es erneut – oder öffne die Folge direkt in Spotify.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'LISTEN ON SPOTIFY' }));
    expect(open).toHaveBeenCalledWith('https://open.spotify.com/episode/ep-1', '_blank', 'noopener');
  });

  it('shows other errors as they are', async () => {
    vi.spyOn(api, 'play').mockRejectedValue(new ApiError(502, 'spotify_error', 'Spotify-Fehler 502'));
    const { user } = renderOnDevice();
    await user.click(screen.getByRole('button', { name: /Abspielen/ }));
    expect(await screen.findByText('Spotify-Fehler 502')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'LISTEN ON SPOTIFY' })).not.toBeInTheDocument();
  });
});
