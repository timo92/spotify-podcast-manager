import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayButton } from '../../src/components/EpisodeCard';
import { PlayerBar } from '../../src/components/PlayerBar';
import { api } from '../../src/lib/api';
import { loadRemoteEpisodes, rememberRemoteEpisode } from '../../src/lib/remote-episodes';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const MIN = 60_000;
type Listener = (payload: unknown) => void;

/** Stand-in for the Web Playback SDK's player; `nextConnect` decides how connecting ends. */
class FakePlayer {
  static instances: FakePlayer[] = [];
  static nextConnect: 'ready' | 'account_error' = 'ready';
  readonly listeners = new Map<string, Listener[]>();
  state: Spotify.PlaybackState | null = null;
  disconnect = vi.fn();
  constructor() {
    FakePlayer.instances.push(this);
  }
  addListener(event: string, cb: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return true;
  }
  emit(event: string, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
  async connect() {
    const outcome = FakePlayer.nextConnect;
    setTimeout(() =>
      outcome === 'ready' ? this.emit('ready', { device_id: 'web' }) : this.emit(outcome, { message: 'no premium' }),
    );
    return true;
  }
  getCurrentState = async () => this.state;
  togglePlay = async () => {};
  pause = async () => {};
  resume = async () => {};
  seek = async () => {};
  activateElement = async () => {};
}

function sdkState(episodeId: string, positionMs: number, paused = false): Spotify.PlaybackState {
  const uri = `spotify:episode:${episodeId}`;
  return {
    paused,
    position: positionMs,
    duration: 20 * MIN,
    track_window: { current_track: { id: episodeId, uri, name: '', type: 'episode' } },
  };
}

function renderPlayer() {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'today').mockRejectedValue(new Error('not needed'));
  vi.spyOn(api, 'shows').mockRejectedValue(new Error('not needed'));
  vi.spyOn(api, 'play').mockResolvedValue({ ok: true, positionMs: 0, durationMs: 20 * MIN });
  return renderWithProviders(
    <>
      <PlayButton item={{ show: show(), episode: episode(1) }} />
      <PlayButton item={{ show: show(), episode: episode(2) }} />
      <PlayerBar />
    </>,
  );
}

const playerBar = () => screen.findByRole('region', { name: 'Player' });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakePlayer.instances = [];
  FakePlayer.nextConnect = 'ready';
  localStorage.setItem('pm.playTarget', JSON.stringify({ kind: 'browser' }));
  vi.stubGlobal('MediaKeys', function MediaKeys() {});
  vi.stubGlobal('Spotify', { Player: FakePlayer });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('playback in the browser', () => {
  it('treats a state of another episode as the end of the shown one, not as its position', async () => {
    renderPlayer();
    fireEvent.click(screen.getAllByRole('button', { name: 'Abspielen' })[0]!);
    expect(within(await playerBar()).getByText(/0:00 \/ 20:00/)).toBeInTheDocument();
    const [player] = FakePlayer.instances;

    act(() => player!.emit('player_state_changed', sdkState('ep-2', 5 * MIN)));
    expect(within(await playerBar()).getByText(/0:00 \/ 20:00/)).toBeInTheDocument();
    expect(within(await playerBar()).getByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();
  });

  it('disconnects a player that failed to connect before creating the next one', async () => {
    FakePlayer.nextConnect = 'account_error';
    renderPlayer();
    fireEvent.click(screen.getAllByRole('button', { name: 'Abspielen' })[0]!);
    expect(await screen.findByText(/no premium/)).toBeInTheDocument();
    expect(FakePlayer.instances[0]!.disconnect).toHaveBeenCalled();

    FakePlayer.nextConnect = 'ready';
    fireEvent.click(screen.getAllByRole('button', { name: 'Abspielen' })[0]!);
    expect(await playerBar()).toBeInTheDocument();
    expect(FakePlayer.instances).toHaveLength(2);
  });

  it('replaces a player that went offline instead of keeping both', async () => {
    renderPlayer();
    fireEvent.click(screen.getAllByRole('button', { name: 'Abspielen' })[0]!);
    await playerBar();
    const [first] = FakePlayer.instances;
    act(() => first!.emit('not_ready', { device_id: 'web' }));
    expect(first!.disconnect).toHaveBeenCalled();

    // the other episode's button; the first one now pauses
    fireEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(FakePlayer.instances).toHaveLength(2);
  });

  it('stops following an episode as outside playback once it plays in the browser', async () => {
    rememberRemoteEpisode({
      showId: 'wissen',
      episodeId: 'ep-1',
      name: 'Reise: Teil 1',
      showName: 'Wissen',
      durationMs: 20 * MIN,
      target: { kind: 'app' },
      startedAt: Date.now(),
    });
    vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS' }));
    vi.spyOn(api, 'playerState').mockResolvedValue({ episodeId: 'ep-1', positionMs: 0, paused: true });
    renderPlayer();
    fireEvent.click(screen.getAllByRole('button', { name: 'Abspielen' })[0]!);
    // the browser's own controls, not the outside playback's
    expect(await within(await playerBar()).findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(loadRemoteEpisodes()).toEqual([]);
  });

  it('does not mark an episode again when it ends after the user marked it in the player bar', async () => {
    const setStatus = vi.spyOn(api, 'setStatus').mockResolvedValue(show());
    renderPlayer();
    fireEvent.click(screen.getAllByRole('button', { name: 'Abspielen' })[0]!);
    const bar = await playerBar();
    const [player] = FakePlayer.instances;
    act(() => player!.emit('player_state_changed', sdkState('ep-1', 20 * MIN - 2000)));

    fireEvent.click(within(bar).getByRole('button', { name: 'Als gehört markieren' }));
    expect(await screen.findByText('Als gehört markiert')).toBeInTheDocument();
    // the episode plays to its end
    act(() => player!.emit('player_state_changed', sdkState('ep-1', 0, true)));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('„Reise: Teil 1“ als gehört markiert')).not.toBeInTheDocument();
  });
});
