import { Hono } from 'hono';
import { validTimeZone } from '../services/plan.js';
import type { RouteContext } from './context.js';
import { readBody } from './http.js';

/** The weekly plan: its rules and the week projected from them. */
export function planRoutes({ store, planner }: RouteContext) {
  return new Hono()
    .get('/schedule', async (c) => c.json(await store.getSchedule()))
    .put('/schedule', async (c) => c.json(await planner.saveSchedule(await readBody(c))))
    .get('/week', async (c) => {
      const days = await planner.week(
        validTimeZone(c.req.query('tz')),
        Number(c.req.query('days')) || 7,
        c.req.query('start'),
      );
      return c.json({ days });
    });
}
