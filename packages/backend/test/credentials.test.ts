import { describe, expect, it, vi } from 'vitest';
import { credentialsFromEnv } from '../src/spotify/credentials.js';

describe('credentialsFromEnv', () => {
  it('uses the secret from the environment (local development)', async () => {
    const ssm = { send: vi.fn() };
    const creds = credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' }, ssm);
    expect(creds.configured).toBe(true);
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
    expect(ssm.send.mock.calls[0][0].input).toEqual({
      Name: '/podcast-cockpit/spotify-client-secret',
      WithDecryption: true,
    });
  });

  it('explains missing configuration', async () => {
    await expect(credentialsFromEnv({}).get()).rejects.toMatchObject({ code: 'not_configured' });
    expect(credentialsFromEnv({}).configured).toBe(false);
    await expect(credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id' }).get()).rejects.toMatchObject({ code: 'not_configured' });
    const missing = { send: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'ParameterNotFound' })) };
    await expect(
      credentialsFromEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET_PARAMETER: '/x' }, missing).get(),
    ).rejects.toMatchObject({ code: 'not_configured', message: expect.stringContaining('/x') });
  });
});
