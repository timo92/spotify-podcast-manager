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
  };
}

/** Today, the history, podcasts and their episodes. */
export function libraryRoutes({ store, library, planner, playback, sync }: RouteContext) {
  return new Hono()
    .get('/today', async (c) => c.json(await planner.today(validTimeZone(c.req.query('tz')))))
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
    .patch('/shows/:id', async (c) =>
      c.json(await library.updateSettings(c.req.param('id'), showSettings(await readBody(c)))),
    )
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
      return c.json(
        await library.setStatus(c.req.param('id'), episodeIds, status === null ? null : episodeStatus(status)),
      );
    })
    .post('/shows/:id/episodes/:episodeId/complete-before', async (c) =>
      c.json(await library.completeBefore(c.req.param('id'), c.req.param('episodeId'))),
    );
}
