import { createApp, type StoredEvent } from '@fdtd/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { tasks } from '../src/db/schema.js';
import { EventsQuery } from '../src/events/query.js';
import { registerEventRoutes } from '../src/events/routes.js';
import { PgEventWriter } from '../src/events/writer.js';
import { createTestContext, truncateAll } from './helpers.js';

const ctx = createTestContext();
const writer = new PgEventWriter(ctx.db, ctx.clock);
const query = new EventsQuery(ctx.db);
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.clock.set('2026-10-08T12:00:00Z');
});

async function seedTask(id: string, userId: string): Promise<void> {
  await ctx.db.insert(tasks).values({
    id, userId, contractTypeId: 'office-supplies.v1',
    request: { items: [], categories: [], budget: { max: 1, source: 'user' }, deadline: '', deliveryAddress: '' },
    status: 'OPEN', createdAt: ctx.clock.now(), updatedAt: ctx.clock.now(),
  });
}

describe('Events: курсор since (C29)', () => {
  it('монотонные id; since отдаёт строго следующее, без дублей и пропусков', async () => {
    for (let i = 1; i <= 10; i++) {
      await writer.emit({ kind: 'domain', actor: 'platform', type: 'DEPOSIT', payload: { n: i } });
    }
    const admin = { role: 'admin' } as const;
    const all = await query.list({ identity: admin });
    expect(all.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const page1 = await query.list({ identity: admin, since: 0, limit: 4 });
    const page2 = await query.list({ identity: admin, since: page1.at(-1)!.id, limit: 4 });
    const page3 = await query.list({ identity: admin, since: page2.at(-1)!.id, limit: 4 });
    const ids = [...page1, ...page2, ...page3].map((e) => e.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('Events: фильтр по роли на сервере (R8)', () => {
  beforeEach(async () => {
    await seedTask('t1', 'buyer-1');
    await seedTask('t2', 'buyer-2');
    await writer.emit({ kind: 'domain', actor: 'stripe', type: 'DEPOSIT', userId: 'buyer-1' });
    await writer.emit({ kind: 'agent', actor: 'buyer-agent', type: 'DECISION', taskId: 't1', userId: 'buyer-1' });
    await writer.emit({ kind: 'agent', actor: 'provider-agent:papirna', type: 'TOOL_CALL', taskId: 't1', providerId: 'papirna', payload: { tool: 'GET /products' } });
    await writer.emit({ kind: 'agent', actor: 'store:papirna', type: 'WAITING', taskId: 't1', providerId: 'papirna' });
    await writer.emit({ kind: 'domain', actor: 'platform', type: 'OFFER_WITHDRAWN', taskId: 't1', providerId: 'papirna' });
    await writer.emit({ kind: 'domain', actor: 'platform', type: 'TASK_CREATED', taskId: 't2', userId: 'buyer-2' });
    await writer.emit({ kind: 'agent', actor: 'provider-agent:aqua', type: 'STEP_STARTED', providerId: 'aqua' });
  });

  it('заказчик видит своё и OFFER_WITHDRAWN, но не внутренности исполнителей и чужие задачи', async () => {
    const seen = await query.list({ identity: { role: 'buyer', userId: 'buyer-1' } });
    expect(seen.map((e) => e.type)).toEqual(['DEPOSIT', 'DECISION', 'OFFER_WITHDRAWN']);
  });

  it('исполнитель видит только свой агент и свои события', async () => {
    const seen = await query.list({ identity: { role: 'provider', providerId: 'papirna' } });
    expect(seen.map((e) => e.type)).toEqual(['TOOL_CALL', 'WAITING', 'OFFER_WITHDRAWN']);
  });

  it('админ видит всё', async () => {
    const seen = await query.list({ identity: { role: 'admin' } });
    expect(seen).toHaveLength(7);
  });
});

describe('Events: SSE reconnect (C29)', () => {
  it('поток отдаёт события, reconnect с since продолжает без дублей и пропусков', async () => {
    const app = createApp({ service: 'test-sse' });
    registerEventRoutes(app, { eventsQuery: query, pollMs: 20 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    async function collect(since: number, count: number): Promise<StoredEvent[]> {
      const ac = new AbortController();
      const res = await fetch(`${base}/events/stream?since=${since}`, {
        headers: { 'x-role': 'admin' }, signal: ac.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const out: StoredEvent[] = [];
      try {
        while (out.length < count) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (data) out.push(JSON.parse(data.slice(6)) as StoredEvent);
          }
        }
      } finally {
        ac.abort();
      }
      return out;
    }

    try {
      for (let i = 1; i <= 3; i++) {
        await writer.emit({ kind: 'domain', actor: 'platform', type: 'DEPOSIT', payload: { n: i } });
      }
      const first = await collect(0, 3);
      expect(first.map((e) => e.id)).toEqual([1, 2, 3]);

      for (let i = 4; i <= 6; i++) {
        await writer.emit({ kind: 'domain', actor: 'platform', type: 'DEPOSIT', payload: { n: i } });
      }
      const second = await collect(first.at(-1)!.id, 3); // reconnect с курсором
      expect(second.map((e) => e.id)).toEqual([4, 5, 6]);
    } finally {
      app.server.closeAllConnections?.();
      await app.close();
    }
  });

  it('без x-role — 401: журнал не отдаётся анониму', async () => {
    const app = createApp({ service: 'test-sse-auth' });
    registerEventRoutes(app, { eventsQuery: query, pollMs: 20 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${base}/events`)).status).toBe(401);
      expect((await fetch(`${base}/events/stream`)).status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
