import { Hono } from 'hono';
import { StatusCodes } from 'http-status-codes';
import { episodeStatus, type ShowSettingsInput } from '../services/library.js';
import { validTimeZone } from '../services/plan.js';
import type { RouteContext } from './context.js';
import { field, queryLimit, readBody, type Body } from './http.js';

/** The show settings a PATCH may change, with their types checked. */
function showSettings(body: Body): ShowSettingsInput {
  return {
    mode: field.string(body, 'mode'),
    categories: field.stringArray(body, 'categories'),
    paused: field.boolean(body, 'paused'),
    hiddenFromToday: field.boolean(body, 'hiddenFromToday'),
    reofferSkipped: field.boolean(body, 'reofferSkipped'),
    needsReview: field.boolean(body, 'needsReview'),
    priority: field.number(body, 'priority'),
    pinnedEpisodeId: field.nullableString(body, 'pinnedEpisodeId'),
    syncWindowDays: field.nullableNumber(body, 'syncWindowDays'),
  };
}

/** Today, the history, podcasts and their episodes. */
export function libraryRoutes({ store, library, planner, playback, sync, upNext }: RouteContext) {
  return new Hono()
    .get('/today', async (c) => {
      const timeZone = validTimeZone(c.req.query('tz'));
      const today = await planner.today(timeZone);
      // Today is what the "Up next" playlist mirrors; it is rewritten only when it changed.
      await upNext.refreshQuietly({ timeZone, today });
      return c.json(today);
    })
    .get('/history', async (c) => c.json(await store.listHistory(queryLimit(c, 'limit', 50, 200))))
    .get('/shows', async (c) => {
      const shows = await store.listShows();
      shows.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
      return c.json(shows);
    })
    .post('/shows/reorder', async (c) => {
      await library.reorder(field.stringArray(await readBody(c), 'ids') ?? []);
      return c.json({ ok: true });
    })
    .get('/shows/:id', async (c) => c.json(await library.detail(c.req.param('id'))))
    .patch('/shows/:id', async (c) => {
      const id = c.req.param('id');
      const before = await library.requireShow(id);
      const show = await library.updateSettings(id, showSettings(await readBody(c)));
      // Another window reloads the podcast: a wider one brings older episodes back, a narrower one drops them.
      if ((before.syncWindowDays ?? null) !== (show.syncWindowDays ?? null)) await sync.start({ showId: id });
      return c.json(show);
    })
    .post('/shows/:id/sync', async (c) => {
      const id = c.req.param('id');
      await library.requireShow(id);
      return c.json(await sync.start({ showId: id }), StatusCodes.ACCEPTED);
    })
    .get('/shows/:id/episodes/:episodeId', async (c) =>
      c.json(await library.episode(c.req.param('id'), c.req.param('episodeId'))),
    )
    .post('/shows/:id/episodes/:episodeId/refresh', async (c) =>
      c.json(await playback.refreshEpisode(c.req.param('id'), c.req.param('episodeId'))),
    )
    .put('/shows/:id/episodes/:episodeId/status', async (c) => {
      const status = field.nullableString(await readBody(c), 'status') ?? null;
      const episodeIds = [c.req.param('episodeId')];
      const show = await library.setStatus(
        c.req.param('id'),
        episodeIds,
        status === null ? null : episodeStatus(status),
      );
      // A heard or skipped episode leaves the "Up next" playlist, also while Today isn't open.
      await upNext.refreshQuietly();
      return c.json(show);
    })
    .post('/shows/:id/episodes/:episodeId/complete-before', async (c) => {
      const show = await library.completeBefore(c.req.param('id'), c.req.param('episodeId'));
      await upNext.refreshQuietly();
      return c.json(show);
    });
}
