import { act, fireEvent, screen, within } from '@testing-library/react';
import type { PlaybackState } from '@podcast/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayButton } from '../../src/components/EpisodeCard';
import { PlayerBar } from '../../src/components/PlayerBar';
import { api } from '../../src/lib/api';
import { loadRemoteEpisodes, rememberRemoteEpisode } from '../../src/lib/remote-episodes';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const ITEM = { show: show(), episode: episode(1) }; // 20 min
const MIN = 60_000;

function playing(positionMs: number, paused = false): PlaybackState {
  return { episodeId: 'ep-1', positionMs, paused, deviceName: 'iPhone' };
}

function renderPlayer() {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'today').mockRejectedValue(new Error('not needed'));
  vi.spyOn(api, 'shows').mockRejectedValue(new Error('not needed'));
  return renderWithProviders(
    <>
      <PlayButton item={ITEM} />
      <PlayerBar />
    </>,
  );
}

const playerBar = () => screen.findByRole('region', { name: 'Player' });
/** Lets the 30-second polling run once more. */
const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(30_000));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('playback outside the browser', () => {
  it('follows an episode started in the Spotify app in the player bar', async () => {
    localStorage.setItem('pm.playTarget', JSON.stringify({ kind: 'app' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const state = vi.spyOn(api, 'playerState').mockResolvedValue(playing(10 * MIN));
    renderPlayer();

    fireEvent.click(screen.getByRole('button', { name: 'PLAY ON SPOTIFY' }));
    expect(open).toHaveBeenCalledWith('https://open.spotify.com/episode/ep-1', '_blank', 'noopener');
    expect(loadRemoteEpisodes().map((e) => e.episodeId)).toEqual(['ep-1']);

    expect(within(await playerBar()).getByText(/10:00 \/ 20:00 · auf iPhone/)).toBeInTheDocument();
    state.mockResolvedValue(playing(10.5 * MIN));
    await nextPoll();
    expect(within(await playerBar()).getByText(/10:30 \/ 20:00 · auf iPhone/)).toBeInTheDocument();
  });

  it('stops polling once the position no longer moves, then reads the episode back', async () => {
    rememberRemoteEpisode({ ...entryFor(), startedAt: Date.now() });
    const state = vi.spyOn(api, 'playerState').mockResolvedValue(playing(5 * MIN, true));
    const refresh = vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS' }));
    renderPlayer();

    expect(within(await playerBar()).getByText(/5:00 \/ 20:00 · auf iPhone · Pausiert/)).toBeInTheDocument();
    refresh.mockClear(); // the catch-up on start
    await nextPoll();
    expect(state).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith('wissen', 'ep-1');
    await nextPoll();
    expect(state).toHaveBeenCalledTimes(2);
  });

  it('marks an episode heard once playback stops after reaching its end elsewhere', async () => {
    rememberRemoteEpisode({ ...entryFor(), startedAt: Date.now() - 30 * MIN });
    const state = vi.spyOn(api, 'playerState').mockResolvedValue(playing(20 * MIN - 30_000));
    vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS' }));
    const setStatus = vi.spyOn(api, 'setStatus').mockResolvedValue(show());
    renderPlayer();

    // Still playing the last 30 seconds: not marked yet.
    expect(within(await playerBar()).getByText(/19:30 \/ 20:00/)).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();

    state.mockResolvedValue(null);
    await nextPoll();
    expect(await screen.findByText('„Reise: Teil 1“ als gehört markiert')).toBeInTheDocument();
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith('wissen', 'ep-1', 'COMPLETED');
    expect(loadRemoteEpisodes()).toEqual([]);
  });

  it('shows the read-back position once Spotify no longer reports the paused playback', async () => {
    rememberRemoteEpisode({ ...entryFor(), startedAt: Date.now() - 30 * MIN });
    const state = vi.spyOn(api, 'playerState').mockResolvedValue(playing(29_000));
    const refresh = vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS', remainingMs: 20 * MIN }));
    renderPlayer();
    expect(within(await playerBar()).getByText(/0:29 \/ 20:00/)).toBeInTheDocument();

    // Paused in the Spotify app, which then sits in the background: Spotify reports nothing,
    // but the episode's resume point has moved on.
    state.mockResolvedValue(null);
    refresh.mockResolvedValue(episode(1, { status: 'IN_PROGRESS', statusSource: 'spotify', remainingMs: 16.5 * MIN }));
    await nextPoll();
    expect(within(await playerBar()).getByText(/3:30 \/ 20:00 · auf iPhone · Pausiert/)).toBeInTheDocument();
  });

  it('does not mark an episode paused before its end', async () => {
    rememberRemoteEpisode({ ...entryFor(), startedAt: Date.now() - 30 * MIN });
    const state = vi.spyOn(api, 'playerState').mockResolvedValue(playing(15 * MIN));
    vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS' }));
    const setStatus = vi.spyOn(api, 'setStatus').mockResolvedValue(show());
    renderPlayer();
    expect(within(await playerBar()).getByText(/15:00 \/ 20:00/)).toBeInTheDocument();

    state.mockResolvedValue(null);
    await nextPoll();
    await nextPoll();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('catches up on remembered episodes when the page becomes visible again', async () => {
    rememberRemoteEpisode({ ...entryFor(), startedAt: Date.now() });
    vi.spyOn(api, 'playerState').mockResolvedValue(null);
    const refresh = vi.spyOn(api, 'refreshEpisode').mockResolvedValue(episode(1, { status: 'IN_PROGRESS' }));
    renderPlayer();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    refresh.mockResolvedValue(episode(1, { status: 'COMPLETED', statusSource: 'spotify' }));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    // Heard according to Spotify: no longer remembered.
    await vi.waitFor(() => expect(loadRemoteEpisodes()).toEqual([]));
  });
});

function entryFor() {
  return {
    showId: 'wissen',
    episodeId: 'ep-1',
    name: 'Reise: Teil 1',
    showName: 'Wissensreise',
    durationMs: 20 * MIN,
    target: { kind: 'app' as const },
  };
}
