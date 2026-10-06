import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { HttpSpotifyApi } from '../src/spotify/client.js';
import { staticCredentials } from '../src/spotify/credentials.js';

const credentials = staticCredentials('id', 'secret');

function response(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

async function storeWithTokens(expiresAt = Date.now() + 3600_000) {
  const store = new MemoryStore();
  await store.putTokens({ accessToken: 'old', refreshToken: 'refresh', expiresAt, scope: '' });
  return store;
}

describe('HttpSpotifyApi', () => {
  it('pages through saved shows', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          items: [{ show: { id: '1', name: 'A' } }],
          next: 'https://api.spotify.com/v1/me/shows?offset=1',
        }),
      )
      .mockResolvedValueOnce(response(200, { items: [{ show: { id: '2', name: 'B' } }, null], next: null }));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    // entries without show data (taken down) are skipped
    expect((await api.getSavedShows()).map((s) => s.id)).toEqual(['1', '2']);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer old');
  });

  it('never sends the access token to a host other than the Spotify API', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { items: [], next: 'https://elsewhere.example/v1/me/shows?offset=1' }));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    await expect(api.getSavedShows()).rejects.toMatchObject({ code: 'spotify_unexpected_response' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired token and keeps a rotated refresh token', async () => {
    const store = await storeWithTokens(Date.now() - 1000);
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      response(200, {
        access_token: 'new',
        expires_in: 3600,
        refresh_token: 'rotated',
        scope: 's',
        token_type: 'Bearer',
      }),
    ) as typeof fetch;
    try {
      const apiFetch = vi.fn().mockResolvedValue(response(200, { id: 'me' }));
      const api = new HttpSpotifyApi(store, credentials, apiFetch as typeof fetch);
      await api.getMe();
      expect(apiFetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer new');
      expect((await store.getTokens())!.refreshToken).toBe('rotated');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('refreshes an expired token once for parallel requests', async () => {
    const store = await storeWithTokens(Date.now() - 1000);
    const realFetch = globalThis.fetch;
    const tokenFetch = vi
      .fn()
      .mockImplementation(async () =>
        response(200, { access_token: 'new', expires_in: 3600, refresh_token: 'rotated', token_type: 'Bearer' }),
      );
    globalThis.fetch = tokenFetch as typeof fetch;
    try {
      const apiFetch = vi.fn().mockImplementation(async () => response(200, { id: 'me' }));
      const api = new HttpSpotifyApi(store, credentials, apiFetch as typeof fetch);
      await Promise.all([api.getMe(), api.getMe(), api.getMe()]);
      expect(tokenFetch).toHaveBeenCalledTimes(1);
      expect(apiFetch.mock.calls.map((c) => c[1].headers.Authorization)).toEqual(Array(3).fill('Bearer new'));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('drops the tokens and marks the app disconnected when access was revoked', async () => {
    const store = await storeWithTokens(Date.now() - 1000);
    await store.putConfig({ ownerId: 'owner', createdAt: '', updatedAt: '' });
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        response(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }),
      ) as typeof fetch;
    try {
      const apiFetch = vi.fn();
      const api = new HttpSpotifyApi(store, credentials, apiFetch as typeof fetch);
      await expect(api.getMe()).rejects.toMatchObject({ code: 'spotify_reauth' });
      expect(apiFetch).not.toHaveBeenCalled();
      expect(await store.getTokens()).toBeUndefined();
      expect((await store.getConfig())!.disconnectedAt).toBeDefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('keeps tokens another process stored meanwhile when its own refresh token is rejected', async () => {
    const store = await storeWithTokens(Date.now() - 1000);
    await store.putConfig({ ownerId: 'owner', createdAt: '', updatedAt: '' });
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      // While this client refreshes with its cached (now outdated) token, a login
      // or another Lambda stores new tokens.
      await store.putTokens({
        accessToken: 'new',
        refreshToken: 'rotated',
        expiresAt: Date.now() + 3600_000,
        scope: '',
      });
      return response(400, { error: 'invalid_grant' });
    }) as typeof fetch;
    try {
      const api = new HttpSpotifyApi(store, credentials, vi.fn() as typeof fetch);
      await expect(api.getMe()).rejects.toMatchObject({ code: 'spotify_reauth' });
      expect((await store.getTokens())?.refreshToken).toBe('rotated');
      expect((await store.getConfig())!.disconnectedAt).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('checks the library with show URIs, 40 per call', async () => {
    const store = await storeWithTokens();
    const ids = Array.from({ length: 41 }, (_, i) => `s${i}`);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          200,
          ids.slice(0, 40).map((_, i) => i % 2 === 0),
        ),
      )
      .mockResolvedValueOnce(response(200, [true]));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    const saved = await api.libraryContains(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(fetchMock.mock.calls[0]![0]);
    expect(first.pathname).toBe('/v1/me/library/contains');
    expect(first.searchParams.get('uris')!.split(',')).toEqual(ids.slice(0, 40).map((id) => `spotify:show:${id}`));
    expect([saved.get('s0'), saved.get('s1'), saved.get('s40')]).toEqual([true, false, true]);
  });

  it('reads the playing episode and its position from the playback state', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          progress_ms: 61_000,
          is_playing: false,
          currently_playing_type: 'episode',
          item: { id: 'ep1', duration_ms: 1_800_000 },
          device: { name: 'iPhone' },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          progress_ms: 5_000,
          is_playing: true,
          currently_playing_type: 'track',
          item: { id: 't1', duration_ms: 1 },
        }),
      )
      .mockResolvedValueOnce(response(204));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    expect(await api.getPlayingEpisode()).toEqual({
      episodeId: 'ep1',
      positionMs: 61_000,
      durationMs: 1_800_000,
      paused: true,
      deviceName: 'iPhone',
    });
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.pathname).toBe('/v1/me/player');
    expect(url.searchParams.get('additional_types')).toBe('episode');
    expect(await api.getPlayingEpisode()).toBeUndefined();
    expect(await api.getPlayingEpisode()).toBeUndefined();
  });

  it('reports a listed device that Spotify cannot reach as device_unavailable', async () => {
    const store = await storeWithTokens();
    const notFound = (reason?: string) =>
      response(404, { error: { status: 404, message: 'Device not found', reason } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound('NO_ACTIVE_DEVICE'));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    await expect(api.play('ep1', 'phone', 0)).rejects.toMatchObject({ status: 404, code: 'device_unavailable' });
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('device_id')).toBe('phone');
    // Without a device id, a 404 is not about a device.
    await expect(api.play('ep1', undefined, 0)).rejects.toMatchObject({ code: 'spotify_error' });
    await expect(api.play('ep1', undefined, 0)).rejects.toMatchObject({ code: 'no_active_device' });
  });

  it('retries after 429 using Retry-After', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, undefined, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response(200, { id: 'me' }));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    expect((await api.getMe()).id).toBe('me');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on rate limits that would outlast the request deadline', async () => {
    vi.useFakeTimers();
    try {
      const store = await storeWithTokens();
      const fetchMock = vi.fn().mockResolvedValue(response(429, undefined, { 'retry-after': '15' }));
      const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
      const result = api.getMe().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(await result).toMatchObject({
        code: 'spotify_rate_limited',
        params: { minutes: 1 },
      });
      // one wait of 15 s fits, a second one would not
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits a second when Retry-After is not a number of seconds', async () => {
    vi.useFakeTimers();
    try {
      const store = await storeWithTokens();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(429, undefined, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))
        .mockResolvedValueOnce(response(200, { id: 'me' }));
      const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
      const me = api.getMe();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(600);
      expect((await me).id).toBe('me');
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a request Spotify does not answer and reports Spotify as unavailable', async () => {
    vi.useFakeTimers();
    try {
      const store = await storeWithTokens();
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const api = new HttpSpotifyApi(store, credentials, fetchMock as unknown as typeof fetch);
      const result = api.getMe().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await result).toMatchObject({ code: 'spotify_unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists an episode only once when paging returns it twice', async () => {
    const store = await storeWithTokens();
    const page = (ids: string[], next: string | null) => response(200, { items: ids.map((id) => ({ id })), next });
    // a new episode published while paging shifts the offsets by one
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['e3', 'e2'], 'https://api.spotify.com/v1/next'))
      .mockResolvedValueOnce(page(['e2', 'e1'], null));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    expect((await api.getShowEpisodes('s')).map((e) => e.id)).toEqual(['e3', 'e2', 'e1']);
  });

  it('fails instead of returning a partial episode list when a page is empty', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { items: [{ id: 'e2' }], next: 'https://api.spotify.com/v1/next' }))
      .mockResolvedValueOnce(response(204));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    await expect(api.getShowEpisodes('s')).rejects.toMatchObject({ code: 'spotify_unexpected_response' });
  });

  it('stops paging episodes once a known episode shows up', async () => {
    const store = await storeWithTokens();
    const page = (ids: string[], next: string | null) => response(200, { items: ids.map((id) => ({ id })), next });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['n1', 'k1'], 'https://api.spotify.com/v1/next'))
      .mockResolvedValueOnce(page(['k2'], null));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    const eps = await api.getShowEpisodes('s', (p) => p.some((e) => e.id === 'k1'));
    expect(eps.map((e) => e.id)).toEqual(['n1', 'k1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains 403 errors', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi.fn().mockResolvedValue(response(403, { error: { status: 403, message: 'Forbidden' } }));
    const api = new HttpSpotifyApi(store, credentials, fetchMock as typeof fetch);
    await expect(api.getMe()).rejects.toMatchObject({ status: 403, code: 'spotify_forbidden' });
  });
});
