import { Hono } from 'hono';
import { badRequest } from '../errors.js';
import { validTimeZone } from '../services/plan.js';
import type { RouteContext } from './context.js';
import { field, readBody } from './http.js';

/** Playback through Spotify: the browser player's token, devices, what plays, and starting an episode. */
export function playerRoutes({ playback }: RouteContext) {
  return new Hono()
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
    });
}
