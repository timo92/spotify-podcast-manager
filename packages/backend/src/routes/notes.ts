import { Hono } from 'hono';
import { StatusCodes } from 'http-status-codes';
import type { RouteContext } from './context.js';
import { queryLimit, readBody } from './http.js';

/** Notes on episodes; the note service checks their fields. */
export function noteRoutes({ store, notes }: RouteContext) {
  const path = '/shows/:id/episodes/:episodeId/notes';
  return new Hono()
    .get('/notes', async (c) => c.json(await store.listNotes(queryLimit(c, 'limit', 2000, 5000))))
    .get(path, async (c) => c.json(await notes.list(c.req.param('id'), c.req.param('episodeId'))))
    .post(path, async (c) =>
      c.json(await notes.create(c.req.param('id'), c.req.param('episodeId'), await readBody(c)), StatusCodes.CREATED),
    )
    .patch(`${path}/:noteId`, async (c) =>
      c.json(await notes.update(c.req.param('id'), c.req.param('episodeId'), c.req.param('noteId'), await readBody(c))),
    )
    .delete(`${path}/:noteId`, async (c) => {
      await notes.delete(c.req.param('id'), c.req.param('episodeId'), c.req.param('noteId'));
      return c.json({ ok: true });
    });
}
