import { beforeAll, describe, expect, it } from 'vitest';
import { matchSequence } from '@fdtd/shared';
import { adminEvents, api, pollTask, resetDemo, STORES } from './helpers.js';

/**
 * Основной сквозной сценарий (plan 2.6, концепт 7): C11 + C19 + C35.
 * Задача «бумага» без бюджета -> оценка -> три оферты (levny мимо по сроку) ->
 * papirna принят -> магазин out_of_stock -> отзыв, рейтинг -0.3 -> kancelar ->
 * confirmed -> Proof -> CAPTURE -> SETTLED. Баланс 58 $, кошелёк kancelar 42 $.
 */
describe('e2e: основной сценарий', () => {
  let taskId = '';

  beforeAll(async () => {
    await resetDemo();
    const deadline = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const res = await api('POST', '/tasks', {
      userId: 'buyer-1',
      request: {
        items: [{ itemQuery: 'бумага A4 500 листов', quantity: 5, unit: 'pack', category: 'paper' }],
        categories: ['paper'],
        budget: { max: 0, source: 'estimated' }, // C35: бюджет оценит агент
        deadline,
        deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
      },
    });
    expect(res.status).toBe(201);
    taskId = (res.body as { task: { id: string } }).task.id;
  }, 30_000);

  it('задача доходит до DONE: отзыв papirna, расчёт с kancelar', async () => {
    const { deals } = await pollTask(taskId, (t) => t.status === 'DONE');

    const papirna = deals.filter((d) => d.providerId === 'papirna');
    const kancelar = deals.filter((d) => d.providerId === 'kancelar');
    expect(papirna.some((d) => d.status === 'CANCELLED' && d.cancelReason === 'out_of_stock')).toBe(true);
    expect(kancelar.some((d) => d.status === 'SETTLED')).toBe(true);
    // levny давал оферту, но не был принят (срок позже дедлайна)
    for (const d of deals.filter((x) => x.providerId === 'levny')) expect(d.status).toBe('QUOTED');
  }, 90_000);

  it('события в порядке раздела 6 схемы', async () => {
    const events = await adminEvents(taskId);
    const seq = matchSequence(events, [
      'TASK_CREATED',
      { type: 'DECISION', payload: { step: 'estimate_budget' } },            // C35
      { type: 'DEAL_QUOTED', providerId: 'papirna' },
      { type: 'DEAL_QUOTED', providerId: 'kancelar' },
      { type: 'DEAL_QUOTED', providerId: 'levny' },
      { type: 'DECISION', payload: { step: 'evaluate_quotes' } },
      { type: 'DEAL_ACCEPTED', providerId: 'papirna' },
      { type: 'HOLD_PLACED', payload: { amount: 4485 } },                    // 897 x 5
      { type: 'ORDER_PLACED', providerId: 'papirna' },
      { type: 'HOLD_RELEASE', payload: { amount: 4485 } },
      { type: 'OFFER_WITHDRAWN', providerId: 'papirna', payload: { reason: 'out_of_stock' } }, // C19
      { type: 'RATING_CHANGED', providerId: 'papirna', payload: { after: 4.6 } },
      { type: 'DEAL_ACCEPTED', providerId: 'kancelar' },
      { type: 'HOLD_PLACED', payload: { amount: 4200 } },                    // 840 x 5
      { type: 'ORDER_PLACED', providerId: 'kancelar' },
      { type: 'PROOF_RECEIVED', providerId: 'kancelar' },                    // C11
      { type: 'CAPTURE', payload: { amount: 4200 } },
      { type: 'DEAL_SETTLED', providerId: 'kancelar' },
      'TASK_DONE',
    ]);
    expect(seq.pass, seq.message).toBe(true);

    // наблюдаемость C30: шаги агентов с runId в том же журнале
    const agentEvents = events.filter((e) => e.kind === 'agent');
    expect(agentEvents.length).toBeGreaterThan(5);
    for (const e of agentEvents) expect(e.runId, `agent event ${e.type} without runId`).toBeTruthy();
  });

  it('деньги: баланс покупателя 58 $, кошелёк kancelar 42 $, холдов нет', async () => {
    const buyer = await api('GET', '/wallets/user/buyer-1');
    expect(buyer.body).toMatchObject({ balance: 5800, held: 0 });
    const provider = await api('GET', '/wallets/provider/kancelar');
    expect(provider.body).toMatchObject({ balance: 4200, held: 0 });
    const papirna = await api('GET', '/wallets/provider/papirna');
    expect(papirna.body).toMatchObject({ balance: 0 });
  });

  it('рейтинги: papirna -0.3, kancelar +0.05', async () => {
    const res = await api('GET', '/providers');
    const byId = new Map((res.body as Array<{ id: string; rating: number }>).map((p) => [p.id, p.rating]));
    expect(byId.get('papirna')).toBe(4.6);
    expect(byId.get('kancelar')).toBe(4.25);
  });

  it('в магазинах: заказ papirna rejected, kancelar confirmed', async () => {
    const papirna = await (await fetch(`${STORES.papirna}/dashboard`)).text();
    expect(papirna).toContain('rejected');
    expect(papirna).toContain('out_of_stock');
    const kancelar = await (await fetch(`${STORES.kancelar}/dashboard`)).text();
    expect(kancelar).toContain('confirmed');
  });
});
