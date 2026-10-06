import { describe, expect, it, vi } from 'vitest';
import { SPOTIFY_CLIENT_SECRET_PLACEHOLDER } from '@podcast/shared';
import { credentialsFromEnv } from '../src/spotify/credentials.js';

describe('credentialsFromEnv', () => {
  it('uses the secret from the environment (local development)', async () => {
    const ssm = { send: vi.fn() };
    const creds = credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' }, ssm);
    expect(await creds.ready()).toBe(true);
    expect(await creds.get()).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(ssm.send).not.toHaveBeenCalled();
  });

  it('reads the secret from Parameter Store once and caches it', async () => {
    const ssm = { send: vi.fn().mockResolvedValue({ Parameter: { Value: 'from-ssm' } }) };
    const creds = credentialsFromEnv(
      { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET_PARAMETER: '/podcast-cockpit/spotify-client-secret' },
      ssm,
    );
    expect((await creds.get()).clientSecret).toBe('from-ssm');
    await creds.get();
    expect(ssm.send).toHaveBeenCalledTimes(1);
    expect(ssm.send.mock.calls[0]![0].input).toEqual({
      Name: '/podcast-cockpit/spotify-client-secret',
      WithDecryption: true,
    });
  });

  it('explains missing configuration', async () => {
    await expect(credentialsFromEnv({}).get()).rejects.toMatchObject({ code: 'not_configured' });
    expect(await credentialsFromEnv({}).ready()).toBe(false);
    await expect(credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id' }).get()).rejects.toMatchObject({
      code: 'not_configured',
    });
    const missing = {
      send: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'ParameterNotFound' })),
    };
    await expect(
      credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET_PARAMETER: '/x' }, missing).get(),
    ).rejects.toMatchObject({ code: 'not_configured', message: expect.stringContaining('/x') });
  });

  it('treats the placeholder the stack creates as "not set" and notices the real value soon', async () => {
    const send = vi.fn().mockResolvedValue({ Parameter: { Value: SPOTIFY_CLIENT_SECRET_PLACEHOLDER } });
    const creds = credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET_PARAMETER: '/p' }, { send });
    expect(await creds.ready()).toBe(false);
    await expect(creds.get()).rejects.toMatchObject({ message: expect.stringContaining('secret:put') });
    // The negative result is cached briefly, not for the full five minutes.
    expect(send).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ now: Date.now() + 31_000 });
    send.mockResolvedValue({ Parameter: { Value: 'real' } });
    expect(await creds.ready()).toBe(true);
    vi.useRealTimers();
  });
});
