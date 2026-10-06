import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayButton } from '../../src/components/EpisodeCard';
import { PlayerBar } from '../../src/components/PlayerBar';
import { api, ApiError } from '../../src/lib/api';
import { rememberRemoteEpisode } from '../../src/lib/remote-episodes';
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

describe('PlayButton for an episode playing outside the browser', () => {
  function followFromApp(paused: boolean) {
    rememberRemoteEpisode({
      showId: 'wissen',
      episodeId: 'ep-1',
      name: 'Reise: Teil 1',
      showName: 'Wissensreise',
      durationMs: 20 * 60_000,
      target: { kind: 'app' },
      startedAt: Date.now(),
    });
    localStorage.setItem('pm.playTarget', JSON.stringify({ kind: 'app' }));
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS' }));
    vi.spyOn(api, 'playerState').mockResolvedValue({ episodeId: 'ep-1', positionMs: 60_000, paused, deviceName: 'iPhone' });
    return renderWithProviders(
      <>
        <PlayButton item={ITEM} />
        <PlayerBar />
      </>,
    );
  }

  it('shows where it plays instead of a pause action that cannot work', async () => {
    followFromApp(false);
    const status = await screen.findByRole('button', { name: 'Läuft auf iPhone' });
    expect(status).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Abspielen|PLAY ON SPOTIFY/ })).not.toBeInTheDocument();
  });

  it('offers to play again once it is paused there', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = followFromApp(true);
    expect(await screen.findByText(/auf iPhone · Pausiert/)).toBeInTheDocument();
    const play = await screen.findByRole('button', { name: 'PLAY ON SPOTIFY' });
    expect(screen.queryByRole('button', { name: 'Läuft auf iPhone' })).not.toBeInTheDocument();
    await user.click(play);
    expect(open).toHaveBeenCalledWith('https://open.spotify.com/episode/ep-1', '_blank', 'noopener');
  });

  it('names the Connect device it was started on', async () => {
    vi.spyOn(api, 'play').mockResolvedValue({ ok: true, positionMs: 0, durationMs: 20 * 60_000 });
    vi.spyOn(api, 'playerState').mockResolvedValue(null);
    const { user } = renderOnDevice();
    await user.click(screen.getByRole('button', { name: /Abspielen/ }));
    expect(await screen.findByRole('button', { name: 'Läuft auf iPhone' })).toBeDisabled();
  });
});
