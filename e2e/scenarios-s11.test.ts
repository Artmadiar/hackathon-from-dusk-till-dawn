import { createHmac, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminEvents, api, pollTask, resetDemo } from './helpers.js';

/** S11: сценарии 2.6 сверх основного — C03, C31, C08 (store replay), C27. */

const DAY = 86_400_000;
const deadline = () => new Date(Date.now() + 4 * DAY).toISOString();
const baseRequest = {
  budget: { max: 0, source: 'estimated' as const },
  deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
};

async function createTask(request: Record<string, unknown>): Promise<string> {
  const res = await api('POST', '/tasks', { userId: 'buyer-1', request });
  expect(res.status).toBe(201);
  return (res.body as { task: { id: string } }).task.id;
}

async function buyerWallet(): Promise<{ balance: number; held: number }> {
  const res = await api('GET', '/wallets/user/buyer-1');
  return res.body as { balance: number; held: number };
}

describe('C03: лимит политики (maxPerDeal)', () => {
  beforeAll(async () => { await resetDemo(); });

  it('оферта сверх maxPerDeal -> REJECTED_BY_POLICY, леджер не тронут', async () => {
    // 40 синих ручек: papirna откажет (остаток 30), kancelar даст оферту > maxPerDeal $75
    const taskId = await createTask({
      ...baseRequest,
      items: [{ itemQuery: 'синие шариковые ручки', quantity: 40, unit: 'шт', category: 'writing' }],
      categories: ['writing'],
      budget: { max: 20_000, source: 'user' },
      deadline: deadline(),
    });
    const { task } = await pollTask(taskId, (t) => t.status === 'FAILED');
    expect(task.failReason).toBe('all_accepts_rejected');

    const events = await adminEvents(taskId);
    expect(events.some((e) => e.type === 'REJECTED_BY_POLICY')).toBe(true);
    expect(events.some((e) => e.type === 'HOLD_PLACED')).toBe(false);

    const wallet = await buyerWallet();
    expect(wallet.balance).toBe(10_000);
    expect(wallet.held).toBe(0);
  });
});

describe('C31 + C08: мультипозиция, один холд, повтор store-webhook', () => {
  let taskId = '';
  beforeAll(async () => {
    await resetDemo();
    taskId = await createTask({
      ...baseRequest,
      items: [
        { itemQuery: 'бумага A4 500 листов', quantity: 2, unit: 'pack', category: 'paper' },
        { itemQuery: 'синие шариковые ручки', quantity: 5, unit: 'шт', category: 'writing' },
      ],
      categories: ['paper', 'writing'],
      deadline: deadline(),
    });
  });

  it('оферты только от покрывающих обе категории; один холд; SETTLED', async () => {
    const { task, deals } = await pollTask(taskId, (t) => t.status === 'DONE');
    expect(task.status).toBe('DONE');

    // discovery: aqua (water/office) и levny (paper/office) не покрывают writing (C31)
    const quotedBy = new Set(deals.map((d) => d.providerId));
    expect([...quotedBy].sort()).toEqual(['kancelar', 'papirna']);

    const settled = deals.filter((d) => d.status === 'SETTLED');
    expect(settled).toHaveLength(1);

    const events = await adminEvents(taskId);
    expect(events.filter((e) => e.type === 'HOLD_PLACED')).toHaveLength(1); // B3: один холд на весь заказ
  });

  it('повтор подписанного webhook магазина -> дедуп, леджер не изменился (C08)', async () => {
    const { deals } = await pollTask(taskId, (t) => t.status === 'DONE');
    const settled = deals.find((d) => d.status === 'SETTLED') as {
      providerId: string;
      proof: { storeOrderId: string; invoiceNumber: string; lines: unknown[]; confirmedTotal: number; deliveryEta: string };
    };
    // обычно papirna (рейтинг 4.9), но при повторных прогонах его сток конечен
    const agentPort = { aqua: 3382, papirna: 3383, kancelar: 3384, levny: 3385 }[settled.providerId]!;
    const secret = `dev-webhook-secret-${settled.providerId}`;

    const before = await buyerWallet();
    const body = JSON.stringify({
      storeOrderId: settled.proof.storeOrderId,
      status: 'confirmed',
      invoiceNumber: settled.proof.invoiceNumber,
      lines: settled.proof.lines,
      confirmedTotal: settled.proof.confirmedTotal,
      deliveryEta: settled.proof.deliveryEta,
    });
    const t = Math.floor(Date.now() / 1000);
    const n = randomBytes(8).toString('hex');
    const v1 = createHmac('sha256', secret).update(`${t}.${n}.${body}`).digest('hex');

    const res = await fetch(`http://localhost:${agentPort}/hooks/store`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-store-signature': `t=${t},n=${n},v1=${v1}` },
      body,
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 500));
    const after = await buyerWallet();
    expect(after).toEqual(before); // второго списания нет
  });
});

describe('C27: онбординг магазина без перезапуска', () => {
  beforeAll(async () => { await resetDemo(); });

  it('новый провайдер появляется в discovery; мёртвый агент не ломает задачу (U7)', async () => {
    const onboard = await api('POST', '/providers/onboard', {
      id: 'store5',
      name: 'Store Five',
      categories: ['paper', 'office'],
      agentUrl: 'http://provider-agent-5:9999', // агента нет — U7 переживёт
    }, { 'x-role': 'admin' });
    expect(onboard.status).toBe(201);

    const providers = await api('GET', '/providers');
    expect((providers.body as Array<{ id: string }>).map((p) => p.id)).toContain('store5');

    const events = await adminEvents();
    expect(events.some((e) => e.type === 'PROVIDER_ONBOARDED'
      && (e.payload as { name?: string }).name === 'Store Five')).toBe(true);

    // задача paper зовёт и store5; его молчание не мешает живым (U7)
    const taskId = await createTask({
      ...baseRequest,
      items: [{ itemQuery: 'бумага A4 500 листов', quantity: 2, unit: 'pack', category: 'paper' }],
      categories: ['paper'],
      deadline: deadline(),
    });
    const { task } = await pollTask(taskId, (t) => t.status === 'DONE' || t.status === 'FAILED');
    expect(task.status).toBe('DONE');
  });
});
