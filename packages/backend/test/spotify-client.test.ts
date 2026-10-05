import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { HttpSpotifyApi } from '../src/spotify/client.js';

function response(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

async function storeWithTokens(expiresAt = Date.now() + 3600_000) {
  const store = new MemoryStore();
  await store.putConfig({ clientId: 'id', clientSecret: 'secret', createdAt: '', updatedAt: '' });
  await store.putTokens({ accessToken: 'old', refreshToken: 'refresh', expiresAt, scope: '' });
  return store;
}

describe('HttpSpotifyApi', () => {
  it('pages through saved shows', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { items: [{ show: { id: '1', name: 'A' } }], next: 'https://api.spotify.com/v1/me/shows?offset=1' }))
      .mockResolvedValueOnce(response(200, { items: [{ show: { id: '2', name: 'B' } }, null], next: null }));
    const api = new HttpSpotifyApi(store, fetchMock as typeof fetch);
    expect((await api.getSavedShows()).map((s) => s.id)).toEqual(['1', '2']);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer old');
  });

  it('refreshes an expired token and keeps a rotated refresh token', async () => {
    const store = await storeWithTokens(Date.now() - 1000);
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      response(200, { access_token: 'new', expires_in: 3600, refresh_token: 'rotated', scope: 's', token_type: 'Bearer' }),
    ) as typeof fetch;
    try {
      const apiFetch = vi.fn().mockResolvedValue(response(200, { id: 'me' }));
      const api = new HttpSpotifyApi(store, apiFetch as typeof fetch);
      await api.getMe();
      expect(apiFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer new');
      expect((await store.getTokens())!.refreshToken).toBe('rotated');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('retries after 429 using Retry-After', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, undefined, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response(200, { id: 'me' }));
    const api = new HttpSpotifyApi(store, fetchMock as typeof fetch);
    expect((await api.getMe()).id).toBe('me');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops paging episodes once a known episode shows up', async () => {
    const store = await storeWithTokens();
    const page = (ids: string[], next: string | null) => response(200, { items: ids.map((id) => ({ id })), next });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['n1', 'k1'], 'https://api.spotify.com/v1/next'))
      .mockResolvedValueOnce(page(['k2'], null));
    const api = new HttpSpotifyApi(store, fetchMock as typeof fetch);
    const eps = await api.getShowEpisodes('s', (p) => p.some((e) => e.id === 'k1'));
    expect(eps.map((e) => e.id)).toEqual(['n1', 'k1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains 403 errors', async () => {
    const store = await storeWithTokens();
    const fetchMock = vi.fn().mockResolvedValue(response(403, { error: { status: 403, message: 'Forbidden' } }));
    const api = new HttpSpotifyApi(store, fetchMock as typeof fetch);
    await expect(api.getMe()).rejects.toMatchObject({ status: 403, code: 'spotify_forbidden' });
  });
});
