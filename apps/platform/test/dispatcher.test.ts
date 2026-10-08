import { createServer, type Server } from 'node:http';
import { createApp, verifyJwt } from '@fdtd/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentDispatcher } from '../src/dispatcher/dispatcher.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());

const SECRET = 'test-agent-secret';
const request = {
  items: [{ itemQuery: 'бумага A4', quantity: 5, unit: 'pack', category: 'paper' as const }],
  categories: ['paper' as const],
  budget: { max: 5000, source: 'user' as const },
  deadline: '2026-10-10T00:00:00Z',
  deliveryAddress: 'Praha 7',
};
const quote = {
  lines: [{ itemIndex: 0, sku: 'A4-80', title: 'Paper A4', unitPrice: 840, quantity: 5, lineTotal: 4200 }],
  total: 4200, deliveryEta: '2026-10-09T15:00:00Z', validUntil: '2026-10-08T18:00:00Z',
};

const started: Array<FastifyInstance | Server> = [];
beforeEach(() => { started.length = 0; });

async function fakeAgent(routes: (app: FastifyInstance) => void): Promise<string> {
  const app = createApp({ service: 'fake-agent' });
  routes(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  started.push(app);
  const addr = app.server.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

/** Сервер, который принимает соединение и молчит — «мёртвый» исполнитель. */
async function deadAgent(): Promise<string> {
  const server = createServer(() => { /* никогда не отвечает */ });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  started.push(server);
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

async function closeAll(): Promise<void> {
  for (const s of started) {
    if ('server' in s) { s.server.closeAllConnections?.(); await s.close(); }
    else { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  }
}

function mkDispatcher(buyerAgentUrl = 'http://unused') {
  return new AgentDispatcher({
    clock: ctx.clock, events: ctx.events, jwtSecret: SECRET,
    buyerAgentUrl, quoteTimeoutMs: 300, requestTimeoutMs: 300,
  });
}

describe('Dispatcher: параллельные /quote (U7, K2)', () => {
  it('живой даёт оферту, отказник — причину, мёртвый и 500 не ломают остальных', async () => {
    const goodUrl = await fakeAgent((app) => {
      app.post('/quote', async () => ({ quote }));
    });
    const refuseUrl = await fakeAgent((app) => {
      app.post('/quote', async () => ({ refusal: 'out_of_stock' }));
    });
    const errorUrl = await fakeAgent((app) => {
      app.post('/quote', async (_req, reply) => reply.code(500).send({ error: 'boom' }));
    });
    const deadUrl = await deadAgent();

    try {
      const t0 = Date.now();
      const outcomes = await mkDispatcher().requestQuotes({
        taskId: 't1', request,
        providers: [
          { id: 'good', agentUrl: goodUrl },
          { id: 'refuse', agentUrl: refuseUrl },
          { id: 'error', agentUrl: errorUrl },
          { id: 'dead', agentUrl: deadUrl },
        ],
      });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(2000); // таймаут 300мс, не сумма

      const byId = Object.fromEntries(outcomes.map((o) => [o.providerId, o]));
      expect(byId.good).toMatchObject({ ok: true });
      expect(byId.good!.quote).toMatchObject({ total: 4200 });
      expect(byId.refuse).toMatchObject({ ok: false, refusal: 'out_of_stock' });
      expect(byId.error).toMatchObject({ ok: false, error: 'http_500' });
      expect(byId.dead!.ok).toBe(false);
      expect(byId.dead!.error).toBeTruthy(); // таймаут
    } finally {
      await closeAll();
    }
  });

  it('JWT платформы уходит в заголовке и проверяется агентом', async () => {
    let authHeader = '';
    const url = await fakeAgent((app) => {
      app.post('/quote', async (req) => {
        authHeader = req.headers.authorization ?? '';
        return { quote };
      });
    });
    try {
      await mkDispatcher().requestQuotes({
        taskId: 't1', request, providers: [{ id: 'good', agentUrl: url }],
      });
      const token = authHeader.replace('Bearer ', '');
      const claims = verifyJwt(token, SECRET, { iss: 'platform', aud: 'provider-agent', clock: ctx.clock });
      expect(claims.iss).toBe('platform');
    } finally {
      await closeAll();
    }
  });
});

describe('Dispatcher: /run заказчику (R7) и /cancel исполнителю (K4)', () => {
  it('R7: параллельные runBuyer на одну задачу -> один POST; после завершения можно снова', async () => {
    let posts = 0;
    const buyerUrl = await fakeAgent((app) => {
      app.post('/run', async (_req, reply) => {
        posts += 1;
        await new Promise((r) => setTimeout(r, 50));
        return reply.code(202).send({ accepted: true });
      });
    });
    try {
      const d = mkDispatcher(buyerUrl);
      await Promise.all([
        d.runBuyer({ taskId: 't1', reason: 'offer_withdrawn' }),
        d.runBuyer({ taskId: 't1', reason: 'offer_withdrawn' }),
        d.runBuyer({ taskId: 't1', reason: 'proof_rejected' }),
      ]);
      expect(posts).toBe(1);
      await d.runBuyer({ taskId: 't1', reason: 'new_trigger' });
      expect(posts).toBe(2);
    } finally {
      await closeAll();
    }
  });

  it('K4: sendCancel доставляет dealId и причину, agent отвечает 202', async () => {
    const seen: unknown[] = [];
    const url = await fakeAgent((app) => {
      app.post('/cancel', async (req, reply) => {
        seen.push(req.body);
        return reply.code(202).send({});
      });
    });
    try {
      await mkDispatcher().sendCancel({ dealId: 'd1', providerId: 'papirna', agentUrl: url, reason: 'proof_rejected' });
      expect(seen).toEqual([{ dealId: 'd1', reason: 'proof_rejected' }]);
    } finally {
      await closeAll();
    }
  });
});
