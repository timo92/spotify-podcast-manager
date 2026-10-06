import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../src/i18n';
import { api, ApiError, errorMessage, NetworkError, TIME_ZONE } from '../src/lib/api';

describe('errorMessage', () => {
  it('translates known codes with their parameters', async () => {
    const body = { error: 'too_many_rules', message: 'Höchstens 200 Regeln', params: { max: 200 } };
    expect(errorMessage(body, 400)).toBe('Höchstens 200 Regeln im Wochenplan.');
    await i18n.changeLanguage('en');
    expect(errorMessage(body, 400)).toBe('At most 200 rules in the weekly plan.');
  });

  it("keeps the server's message for unknown codes, or names the status", () => {
    expect(errorMessage({ error: 'something_new', message: 'Neu' }, 400)).toBe('Neu');
    expect(errorMessage(undefined, 502)).toBe('Fehler 502');
  });

  it('does not take inherited object properties for known codes', () => {
    expect(errorMessage({ error: 'toString', message: 'Server-Text' }, 400)).toBe('Server-Text');
  });
});

describe('request', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Answers every request with `body` and `status`, and records the requests. */
  function respond(body: string, status = 200, contentType = 'application/json') {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(body, { status, headers: { 'Content-Type': contentType } });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('reports an error page that is not JSON by its status', async () => {
    respond('<html><body>504 Gateway Timeout</body></html>', 504, 'text/html');
    await expect(api.today()).rejects.toMatchObject({ status: 504, code: 'error', message: 'Fehler 504' });
  });

  it('turns an error response into an ApiError with its code and translated message', async () => {
    respond(JSON.stringify({ error: 'note_too_long', message: 'Notiz zu lang', params: { max: 5000 } }), 400);
    const error: unknown = await api.notes().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'note_too_long',
      message: 'Die Notiz ist zu lang (höchstens 5000 Zeichen).',
    });
  });

  it("keeps the code and the server's message of an error this build doesn't know", async () => {
    respond(JSON.stringify({ error: 'brand_new', message: 'Ganz neuer Fehler' }), 409);
    await expect(api.shows()).rejects.toMatchObject({ status: 409, code: 'brand_new', message: 'Ganz neuer Fehler' });
  });

  it('reports an error without a body by its status', async () => {
    respond('', 500);
    await expect(api.settings()).rejects.toMatchObject({ status: 500, code: 'error', message: 'Fehler 500' });
  });

  it('reports a server that cannot be reached in the active language, not as an API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error: unknown = await api.status().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ message: 'Keine Verbindung zum Server' });
    await i18n.changeLanguage('en');
    await expect(api.status()).rejects.toThrow('No connection to the server');
    // main.tsx retries everything except client errors from the API
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('returns the parsed body, or undefined for an empty one', async () => {
    respond(JSON.stringify([{ id: 'n1' }]));
    await expect(api.notes()).resolves.toEqual([{ id: 'n1' }]);
    respond('', 200, 'text/plain');
    await expect(api.reorder(['a'])).resolves.toBeUndefined();
  });

  it('sends reads without a body and writes as JSON, with the session cookie', async () => {
    const fetch = respond('{}');
    await api.history(50);
    await api.setStatus('show/1', 'ep 1', 'COMPLETED');
    await api.sync();

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/history?limit=50', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {},
      body: undefined,
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/shows/show%2F1/episodes/ep%201/status', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    expect(fetch.mock.calls[2]![0]).toBe('/api/sync');
    expect(fetch.mock.calls[2]![1]!.body).toBe(JSON.stringify({ full: false }));
  });

  it('sends an empty JSON object for a write without a body', async () => {
    const fetch = respond('{}');
    await api.logout();
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it("asks for today and the week in the browser's time zone", async () => {
    const fetch = respond('{}');
    await api.today();
    await api.week();
    const tz = encodeURIComponent(TIME_ZONE);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([`/api/today?tz=${tz}`, `/api/week?tz=${tz}`]);
  });

  it('addresses a note by its podcast, episode and id', async () => {
    const fetch = respond('{}');
    const note = { showId: 's 1', episodeId: 'e/1', id: 'n?1' };
    await api.updateNote(note, { text: 'neu' });
    await api.deleteNote(note);
    expect(fetch.mock.calls.map((c) => [c[1]!.method, c[0]])).toEqual([
      ['PATCH', '/api/shows/s%201/episodes/e%2F1/notes/n%3F1'],
      ['DELETE', '/api/shows/s%201/episodes/e%2F1/notes/n%3F1'],
    ]);
  });
});
