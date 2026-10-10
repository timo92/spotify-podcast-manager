import { Hono } from 'hono';
import { badRequest } from '../errors.js';
import { validTimeZone } from '../services/plan.js';
import type { RouteContext } from './context.js';
import { field, readBody } from './http.js';

/**
 * Playback through Spotify: the browser player's token, devices, what plays,
 * starting an episode, and the "Up next" playlist for playing in the Spotify app.
 */
export function playerRoutes({ playback, upNext }: RouteContext) {
  return (
    new Hono()
      .get('/player/token', async (c) => c.json(await playback.accessToken()))
      .get('/player/state', async (c) => c.json(await playback.state()))
      .get('/player/devices', async (c) => c.json(await playback.devices()))
      .post('/player/pause', async (c) => {
        await playback.pause();
        return c.json({ ok: true });
      })
      .post('/player/play', async (c) => {
        const body = await readBody(c);
        const showId = field.string(body, 'showId');
        const episodeId = field.string(body, 'episodeId');
        if (!showId || !episodeId) throw badRequest('episode_required', 'showId und episodeId sind erforderlich');
        const tz = field.string(body, 'tz');
        const started = await playback.play(showId, episodeId, {
          deviceId: field.string(body, 'deviceId') || undefined,
          fromStart: field.boolean(body, 'fromStart') ?? false,
          // An explicit start position, e.g. from a timestamp in a note.
          positionMs: field.number(body, 'positionMs'),
          // Today, which fills the "Up next" playlist, depends on the client's day.
          timeZone: tz ? validTimeZone(tz) : undefined,
        });
        return c.json({ ok: true, ...started });
      })
      // The Spotify app is opened with a link, so the client needs the playlist's ID before the click.
      .get('/player/up-next', async (c) => c.json({ playlistId: (await upNext.playlistId()) ?? null }))
      // Puts the episode the user is about to start in the Spotify app first in the playlist.
      .post('/player/up-next', async (c) => {
        const body = await readBody(c);
        const showId = field.string(body, 'showId');
        const episodeId = field.string(body, 'episodeId');
        if (!showId || !episodeId) throw badRequest('episode_required', 'showId und episodeId sind erforderlich');
        const tz = field.string(body, 'tz');
        const state = await upNext.refreshQuietly({
          timeZone: tz ? validTimeZone(tz) : undefined,
          first: { showId, episodeId },
          force: true,
        });
        return c.json({ playlistId: state?.playlistId ?? null });
      })
  );
}
