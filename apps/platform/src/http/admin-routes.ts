import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';
import type { EventsQuery } from '../events/query.js';
import { requireRole } from './identity.js';

/** Админский журнал (C34): только role=admin, иначе 403. Полный, без фильтра R8. */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { eventsQuery: EventsQuery; auth?: AuthService },
): void {
  app.get('/admin/events', { preHandler: requireRole(deps.auth, 'admin') }, async (req) => {
    const q = req.query as { since?: string; limit?: string; taskId?: string };
    const list = await deps.eventsQuery.list({
      identity: { role: 'admin' },
      since: q.since ? Number(q.since) : 0,
      limit: q.limit ? Number(q.limit) : 500,
      taskId: q.taskId,
    });
    return { events: list, lastId: list.at(-1)?.id ?? (q.since ? Number(q.since) : 0) };
  });
}
