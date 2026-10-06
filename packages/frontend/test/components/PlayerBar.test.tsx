import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayButton } from '../../src/components/EpisodeCard';
import { PlayerBar, PlayTargetPicker } from '../../src/components/PlayerBar';
import { api } from '../../src/lib/api';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';
import { FakePlayer, installFakeSdk } from '../support/spotify-sdk';

const MIN = 60_000;

/** A play button for the first episode, the picker and the player bar, playing in this browser by default. */
function renderPlayer({ startMs = 0 }: { startMs?: number } = {}) {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  const play = vi.spyOn(api, 'play').mockResolvedValue({ ok: true, positionMs: startMs, durationMs: 20 * MIN });
  const result = renderWithProviders(
    <>
      <PlayTargetPicker />
      <PlayButton item={{ show: show(), episode: episode(1) }} />
      <PlayerBar />
    </>,
  );
  return { play, ...result };
}

const playerBar = () => screen.findByRole('region', { name: 'Player' });
const clickPlay = () => fireEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
const browserPlayer = () => FakePlayer.instances[0]!;

/** Plays the first episode in the browser and waits for the player bar. */
async function startPlaying(startMs = 0) {
  renderPlayer({ startMs });
  clickPlay();
  return playerBar();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installFakeSdk();
  localStorage.setItem('pm.playTarget', JSON.stringify({ kind: 'browser' }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PlayerBar seeking', () => {
  it('jumps to the position chosen with the slider once it is let go', async () => {
    const bar = await startPlaying();
    const slider = within(bar).getByRole('slider', { name: 'Position' });
    expect(within(bar).getByText(/0:00 \/ 20:00/)).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: String(5 * MIN) } });
    expect(within(bar).getByText(/5:00 \/ 20:00/)).toBeInTheDocument();
    expect(browserPlayer().seek).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    expect(browserPlayer().seek).toHaveBeenCalledWith(5 * MIN);
    expect(slider).toHaveValue(String(5 * MIN));
  });

  it('jumps to the position chosen with the keyboard', async () => {
    const bar = await startPlaying();
    const slider = within(bar).getByRole('slider', { name: 'Position' });
    fireEvent.change(slider, { target: { value: String(MIN) } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(browserPlayer().seek).toHaveBeenCalledWith(MIN);
    expect(within(bar).getByText(/1:00 \/ 20:00/)).toBeInTheDocument();
  });

  it('does not seek when the slider is let go without a change', async () => {
    const bar = await startPlaying();
    fireEvent.pointerUp(within(bar).getByRole('slider', { name: 'Position' }));
    expect(browserPlayer().seek).not.toHaveBeenCalled();
  });

  it('goes back 15 seconds and forward 30 seconds', async () => {
    const bar = await startPlaying(MIN);
    expect(within(bar).getByText(/1:00 \/ 20:00/)).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: '30 Sekunden vor' }));
    expect(browserPlayer().seek).toHaveBeenLastCalledWith(90_000);
    expect(within(bar).getByText(/1:30 \/ 20:00/)).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: '15 Sekunden zurück' }));
    expect(browserPlayer().seek).toHaveBeenLastCalledWith(75_000);
    expect(within(bar).getByText(/1:15 \/ 20:00/)).toBeInTheDocument();
  });

  it('stays within the episode when skipping past its start or end', async () => {
    const bar = await startPlaying(10_000);
    fireEvent.click(within(bar).getByRole('button', { name: '15 Sekunden zurück' }));
    expect(browserPlayer().seek).toHaveBeenLastCalledWith(0);

    fireEvent.change(within(bar).getByRole('slider', { name: 'Position' }), { target: { value: String(20 * MIN) } });
    fireEvent.pointerUp(within(bar).getByRole('slider', { name: 'Position' }));
    fireEvent.click(within(bar).getByRole('button', { name: '30 Sekunden vor' }));
    // a second before the end, so the episode doesn't count as ended by the jump
    expect(browserPlayer().seek).toHaveBeenLastCalledWith(20 * MIN - 1000);
    expect(within(bar).getByText(/19:59 \/ 20:00/)).toBeInTheDocument();
  });
});

describe('PlayerBar errors of the browser player', () => {
  it('says that Spotify Premium is required', async () => {
    FakePlayer.nextConnect = 'account_error';
    renderPlayer();
    clickPlay();
    expect(await screen.findByText('Spotify Premium erforderlich: no premium')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Player' })).not.toBeInTheDocument();
  });

  it('says that the Spotify login failed', async () => {
    FakePlayer.nextConnect = 'authentication_error';
    renderPlayer();
    clickPlay();
    expect(await screen.findByText('Spotify-Anmeldung fehlgeschlagen: invalid token')).toBeInTheDocument();
  });

  it('says that the browser is not supported', async () => {
    FakePlayer.nextConnect = 'initialization_error';
    renderPlayer();
    clickPlay();
    expect(await screen.findByText('Browser wird nicht unterstützt: no EME')).toBeInTheDocument();
  });

  it('gives up when the player does not come online in time', async () => {
    FakePlayer.nextConnect = 'no_answer';
    const { play } = renderPlayer();
    clickPlay();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(await screen.findByText('Spotify-Player antwortet nicht.')).toBeInTheDocument();
    expect(browserPlayer().disconnect).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('asks to tap play again when the browser blocks autoplay', async () => {
    await startPlaying();
    act(() => browserPlayer().emit('autoplay_failed', {}));
    expect(
      await screen.findByText('Der Browser hat Autoplay blockiert – bitte erneut auf Play tippen.'),
    ).toBeInTheDocument();
  });

  it('reports a playback error with the message of the player', async () => {
    await startPlaying();
    act(() => browserPlayer().emit('playback_error', { message: 'track unavailable' }));
    expect(await screen.findByText('Wiedergabefehler: track unavailable')).toBeInTheDocument();
  });

  it('hands the player a fresh token and reports when there is none', async () => {
    const token = vi
      .spyOn(api, 'playerToken')
      .mockResolvedValueOnce({ accessToken: 'abc', expiresAt: Date.now() + 3600_000 })
      .mockRejectedValue(new Error('Spotify ist nicht verbunden.'));
    await startPlaying();
    const cb = vi.fn();
    browserPlayer().options.getOAuthToken(cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith('abc'));

    browserPlayer().options.getOAuthToken(cb);
    expect(await screen.findByText('Spotify-Token konnte nicht geladen werden.')).toBeInTheDocument();
    expect(token).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('choosing where to play', () => {
  it('plays on the device chosen in the picker and keeps it as the target', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue([
      { id: 'iphone', name: 'iPhone', type: 'Smartphone', isActive: false },
      { id: 'web', name: 'Podcast-Cockpit', type: 'Computer', isActive: false },
    ]);
    vi.spyOn(api, 'playerState').mockResolvedValue({
      episodeId: 'ep-1',
      positionMs: 0,
      durationMs: 20 * MIN,
      paused: false,
      deviceName: 'iPhone',
    });
    const { play, user } = renderPlayer();
    await user.click(screen.getByRole('button', { name: 'Wiedergabe auf: Browser' }));
    // this browser's own device is offered as "Diesem Browser", not among the Connect devices
    expect(screen.getByRole('menuitemradio', { name: 'Diesem Browser' })).toHaveAttribute('aria-checked', 'true');
    const iphone = await screen.findByRole('menuitemradio', { name: /iPhone/ });
    expect(screen.queryByRole('menuitemradio', { name: /Podcast-Cockpit/ })).not.toBeInTheDocument();
    await user.click(iphone);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wiedergabe auf: iPhone' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pm.playTarget')!)).toEqual({
      kind: 'device',
      id: 'iphone',
      name: 'iPhone',
    });

    await user.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 'ep-1', deviceId: 'iphone' }));
    expect(await screen.findByText('Läuft auf „iPhone“')).toBeInTheDocument();
    expect(FakePlayer.instances).toHaveLength(0);
  });

  it('keeps the chosen device after a reload', async () => {
    localStorage.setItem('pm.playTarget', JSON.stringify({ kind: 'device', id: 'iphone', name: 'iPhone' }));
    vi.spyOn(api, 'devices').mockResolvedValue([{ id: 'iphone', name: 'iPhone', type: 'Smartphone', isActive: true }]);
    const { user } = renderPlayer();
    await user.click(screen.getByRole('button', { name: 'Wiedergabe auf: iPhone' }));
    expect(await screen.findByRole('menuitemradio', { name: /iPhone/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Diesem Browser' })).toHaveAttribute('aria-checked', 'false');
  });

  it('says when no device is reachable and when the devices cannot be read', async () => {
    const devices = vi
      .spyOn(api, 'devices')
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('Spotify antwortet nicht.'));
    const { user } = renderPlayer();
    await user.click(screen.getByRole('button', { name: 'Wiedergabe auf: Browser' }));
    expect(await screen.findByText('Keine Geräte. Öffne Spotify auf einem Gerät.')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Geräte aktualisieren' }));
    expect(await screen.findByText('Spotify antwortet nicht.')).toBeInTheDocument();
    expect(devices).toHaveBeenCalledTimes(2);
  });
});
