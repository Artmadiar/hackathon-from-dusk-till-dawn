import { createApp, uuidIdGen } from '@fdtd/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import { users } from '../src/db/schema.js';
import { DealService } from '../src/deals/deal-service.js';
import { AgentDispatcher } from '../src/dispatcher/dispatcher.js';
import { registerMcpRoutes } from '../src/mcp/server.js';
import { RegistryService } from '../src/registry/registry.js';
import { createTestContext, truncateAll } from './helpers.js';

const ctx = createTestContext();
const auth = new AuthService(ctx.db, ctx.clock);
const registry = new RegistryService(ctx.db, ctx.events, ctx.clock);

/* Фейковый buyer-agent: /parse отвечает валидным Req (N1 тестируется у агента) */
const fakeFetch: typeof fetch = async (url) => {
  if (String(url).endsWith('/parse')) {
    return new Response(JSON.stringify({
      request: {
        items: [{ itemQuery: 'бумага A4', quantity: 5, unit: 'пачка', category: 'paper' }],
        categories: ['paper'],
        budget: { max: 3000, source: 'estimated' },
        deadline: '2026-10-12T17:00:00.000Z',
        deliveryAddress: 'Praha 7',
      },
      assumptions: ['дедлайн: пятница 17:00'],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ accepted: true }), { status: 202 });
};
const dispatcher = new AgentDispatcher({
  clock: ctx.clock, events: ctx.events, jwtSecret: 's', buyerAgentUrl: 'http://fake-buyer', fetchImpl: fakeFetch,
});
const deals = new DealService({
  db: ctx.db, events: ctx.events, clock: ctx.clock, idGen: uuidIdGen,
  policy: ctx.policy, registry, gateway: dispatcher,
});

const app = createApp({ service: 'test-mcp' });
registerMcpRoutes(app, { db: ctx.db, auth, deals, dispatcher, fallbackDeliveryAddress: 'Praha 7' });

afterAll(async () => { await app.close(); await ctx.close(); });
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.clock.set('2026-10-08T12:00:00Z');
  await ctx.db.insert(users).values({
    id: 'buyer-1', email: 'buyer@demo.local', role: 'buyer', name: 'Buyer',
    apiKey: 'ak-buyer-demo', deliveryAddress: 'Praha 7', createdAt: ctx.clock.now(),
  });
});

async function rpc(method: string, params: Record<string, unknown>, apiKey?: string) {
  return app.inject({
    method: 'POST', url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
}

function resultOf(res: { body: string }): Record<string, unknown> {
  const parsed = JSON.parse(res.body) as { result?: Record<string, unknown>; error?: unknown };
  expect(parsed.error).toBeUndefined();
  return parsed.result!;
}

describe('C34: MCP авторизация по API-ключу', () => {
  it('без ключа и с неверным ключом -> 401', async () => {
    expect((await rpc('tools/list', {})).statusCode).toBe(401);
    expect((await rpc('tools/list', {}, 'ak-wrong')).statusCode).toBe(401);
  });

  it('с ключом tools/list отдаёт четыре инструмента (3.7)', async () => {
    const res = await rpc('tools/list', {}, 'ak-buyer-demo');
    expect(res.statusCode).toBe(200);
    const tools = (resultOf(res) as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['create_task', 'get_task', 'list_deals', 'wallet_balance']);
  });
});

describe('MCP-инструменты', () => {
  it('wallet_balance отдаёт баланс кошелька пользователя', async () => {
    const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
    await ctx.ledger.deposit({ walletId: w.id, amount: 5000, idempotencyKey: 'd1' });
    const res = await rpc('tools/call', { name: 'wallet_balance', arguments: {} }, 'ak-buyer-demo');
    expect(res.statusCode).toBe(200);
    const content = (resultOf(res) as { content: Array<{ text: string }> }).content[0]!;
    expect(JSON.parse(content.text)).toMatchObject({ balance: 5000, available: 5000 });
  });

  it('create_task: текст -> parse у агента -> задача создана и запущена', async () => {
    const res = await rpc('tools/call', { name: 'create_task', arguments: { text: 'закажи 5 пачек A4' } }, 'ak-buyer-demo');
    expect(res.statusCode).toBe(200);
    const content = (resultOf(res) as { content: Array<{ text: string }> }).content[0]!;
    const out = JSON.parse(content.text) as { taskId: string; status: string };
    expect(out.taskId).toBeTruthy();

    const task = await deals.getTask(out.taskId);
    expect(task?.createdVia).toBe('mcp');
    expect(task?.userId).toBe('buyer-1');
  });

  it('get_task чужую задачу не отдаёт', async () => {
    await ctx.db.insert(users).values({
      id: 'buyer-2', email: 'other@demo.local', role: 'buyer', name: 'Other', apiKey: 'ak-other', createdAt: ctx.clock.now(),
    });
    const created = await rpc('tools/call', { name: 'create_task', arguments: { text: 'бумага' } }, 'ak-buyer-demo');
    const { taskId } = JSON.parse((resultOf(created) as { content: Array<{ text: string }> }).content[0]!.text) as { taskId: string };

    const res = await rpc('tools/call', { name: 'get_task', arguments: { taskId } }, 'ak-other');
    const result = resultOf(res) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not found');
  });
});
