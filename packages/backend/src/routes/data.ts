import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { StatusCodes } from 'http-status-codes';
import { SESSION_COOKIE, type RouteContext } from './context.js';
import { field, readBody } from './http.js';

/** Syncing, settings, and all personal data at once (export, delete). */
export function dataRoutes({ store, settings, sync, data, web }: RouteContext) {
  return new Hono()
    .post('/sync', async (c) => {
      const full = field.boolean(await readBody(c), 'full') ?? false;
      return c.json(await sync.start({ full }), StatusCodes.ACCEPTED);
    })
    .get('/settings', async (c) => c.json(await store.getSettings()))
    .put('/settings', async (c) => c.json(await settings.save(await readBody(c))))
    .get('/export', async (c) => {
      c.header('Content-Disposition', 'attachment; filename="podcast-manager-export.json"');
      return c.json(await data.export());
    })
    .delete('/data', async (c) => {
      await data.deleteAll();
      deleteCookie(c, SESSION_COOKIE, web.cookieOptions(c));
      return c.json({ ok: true });
    });
}
