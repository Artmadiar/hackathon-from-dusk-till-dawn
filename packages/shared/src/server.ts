import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Базовый Fastify: сквозной x-request-id (U5) и GET /health.
 * Все 10 сервисов приложений стартуют отсюда.
 */
export function createApp(opts: { service: string; health?: Record<string, unknown> }): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    genReqId: (req) => {
      const h = req.headers[REQUEST_ID_HEADER];
      return (Array.isArray(h) ? h[0] : h) ?? randomUUID();
    },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
  });

  app.get('/health', async () => ({
    ok: true,
    service: opts.service,
    ts: new Date().toISOString(),
    ...opts.health,
  }));

  return app;
}

/** Заголовки для исходящего запроса: пробросить correlationId дальше (U5). */
export function withRequestId(requestId: string, headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, [REQUEST_ID_HEADER]: requestId };
}
