import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';
import { resolveIdentity } from '../http/identity.js';
import type { EventsQuery } from './query.js';

export function registerEventRoutes(
  app: FastifyInstance,
  deps: { eventsQuery: EventsQuery; auth?: AuthService; pollMs?: number },
): void {
  const pollMs = deps.pollMs ?? 300;

  app.get('/events', async (req, reply) => {
    const identity = await resolveIdentity(req, deps.auth);
    if (!identity) return reply.code(401).send({ error: 'identity required (x-role)' });
    const q = req.query as { since?: string; limit?: string; taskId?: string };
    const list = await deps.eventsQuery.list({
      identity,
      since: q.since ? Number(q.since) : 0,
      limit: q.limit ? Number(q.limit) : undefined,
      taskId: q.taskId,
    });
    return { events: list, lastId: list.at(-1)?.id ?? (q.since ? Number(q.since) : 0) };
  });

  // SSE: poll по курсору; клиент после reconnect шлёт ?since=lastId (B14, C29)
  app.get('/events/stream', async (req, reply) => {
    const identity = await resolveIdentity(req, deps.auth);
    if (!identity) return reply.code(401).send({ error: 'identity required (x-role)' });
    const q = req.query as { since?: string; taskId?: string };
    let cursor = q.since ? Number(q.since) : 0;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    let open = true;
    req.raw.on('close', () => { open = false; });
    let sincePing = 0;
    while (open) {
      const batch = await deps.eventsQuery.list({ identity, since: cursor, taskId: q.taskId, limit: 100 });
      for (const e of batch) {
        reply.raw.write(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
        cursor = e.id;
      }
      sincePing += pollMs;
      if (sincePing >= 15000) { reply.raw.write(': ping\n\n'); sincePing = 0; }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    reply.raw.end();
  });
}
