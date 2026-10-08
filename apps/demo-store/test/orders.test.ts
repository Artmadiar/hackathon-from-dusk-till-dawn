import { describe, expect, it } from 'vitest';
import { StoreWebhook } from '@fdtd/contracts';
import { fixedClock, seqIdGen } from '@fdtd/shared';
import { loadSeed } from '../src/seed.js';
import { fileURLToPath } from 'node:url';
import { makeStore, placeOrder, NOW } from './helpers.js';

describe('B4, C23: атомарный резерв', () => {
  it('два параллельных заказа на последнюю штуку: один confirmed, один rejected', async () => {
    const { app, ctx, receiver } = makeStore(); // PEN: stock 1
    const [a, b] = await Promise.all([
      placeOrder(app, [{ sku: 'PEN', qty: 1 }]),
      placeOrder(app, [{ sku: 'PEN', qty: 1 }]),
    ]);
    // контракт: ответ /orders всегда pending, решение приходит webhook'ом
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect([a.body.status, b.body.status]).toEqual(['pending', 'pending']);

    await expect.poll(() => receiver.received.length).toBe(2);
    const statuses = receiver.received.map((r) => r.body.status).sort();
    expect(statuses).toEqual(['confirmed', 'rejected']);
    expect(ctx.db.product('PEN')!.stock).toBe(0);
    await app.close();
  });

  it('нехватка по одной позиции отклоняет весь заказ, остальные позиции не списаны', async () => {
    const { app, ctx, receiver } = makeStore(); // A4: 5, PEN: 1
    await placeOrder(app, [{ sku: 'A4', qty: 2 }, { sku: 'PEN', qty: 3 }]);
    await expect.poll(() => receiver.received.length).toBe(1);
    expect(receiver.received[0].body).toMatchObject({ status: 'rejected', reason: 'out_of_stock' });
    expect(ctx.db.product('A4')!.stock).toBe(5);
    expect(ctx.db.product('PEN')!.stock).toBe(1);
    await app.close();
  });

  it('неизвестный sku -> rejected webhook с причиной unknown_sku', async () => {
    const { app, ctx, receiver } = makeStore();
    const res = await app.inject({
      method: 'POST', url: '/orders',
      payload: { items: [{ sku: 'GHOST', qty: 1 }], deliveryAddress: 'Praha', buyerRef: 'r' },
    });
    expect(res.statusCode).toBe(201);
    await expect.poll(() => receiver.received.length).toBe(1);
    expect(receiver.received[0].body).toMatchObject({ status: 'rejected', reason: 'unknown_sku:GHOST' });
    expect(ctx.db.product('A4')!.stock).toBe(5);
    await app.close();
  });

  it('кривое тело запроса -> 400', async () => {
    const { app } = makeStore();
    const res = await app.inject({ method: 'POST', url: '/orders', payload: { items: [] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('подтверждение заказа (K7 confirmed)', () => {
  it('webhook confirmed проходит схему: счёт, строки, сумма, срок из расписания', async () => {
    const { app, receiver } = makeStore();
    await placeOrder(app, [{ sku: 'A4', qty: 3 }, { sku: 'PEN', qty: 1 }]);
    await expect.poll(() => receiver.received.length).toBe(1);
    const hook = StoreWebhook.parse(receiver.received[0].body);
    expect(hook).toMatchObject({
      status: 'confirmed',
      invoiceNumber: 'INV-TEST-1',
      lines: [{ sku: 'A4', confirmedQuantity: 3 }, { sku: 'PEN', confirmedQuantity: 1 }],
      confirmedTotal: 3 * 500 + 100,
      deliveryEta: '2026-10-10T15:00:00.000Z', // leadDays 2 от NOW
    });
    await app.close();
  });

  it('weekdays-расписание: четверг -> ближайший вторник', async () => {
    const seed = loadSeed(fileURLToPath(new URL('../seeds/aqua.json', import.meta.url)));
    const { app, receiver } = makeStore({ seed, clock: fixedClock(NOW), idGen: seqIdGen() });
    await placeOrder(app, [{ sku: 'AQU-BOTTLE-19L', qty: 2 }]);
    await expect.poll(() => receiver.received.length).toBe(1);
    // NOW = чт 2026-10-08; доставка вт/чт -> пт..пн мимо, вторник 13-е
    expect(receiver.received[0].body).toMatchObject({ status: 'confirmed', deliveryEta: '2026-10-13T15:00:00.000Z' });
    await app.close();
  });
});

describe('K4/K7: отмена освобождает резерв', () => {
  it('cancel подтверждённого заказа возвращает остаток; повторный cancel — noop', async () => {
    const { app, ctx } = makeStore();
    const { body } = await placeOrder(app, [{ sku: 'A4', qty: 3 }]);
    await expect.poll(() => ctx.db.order(body.storeOrderId)?.status).toBe('confirmed');
    expect(ctx.db.product('A4')!.stock).toBe(2);

    const res = await app.inject({ method: 'POST', url: `/orders/${body.storeOrderId}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(ctx.db.product('A4')!.stock).toBe(5);
    expect(ctx.db.order(body.storeOrderId)!.status).toBe('cancelled');

    await app.inject({ method: 'POST', url: `/orders/${body.storeOrderId}/cancel` });
    expect(ctx.db.product('A4')!.stock).toBe(5); // не задвоился

    const missing = await app.inject({ method: 'POST', url: '/orders/ord-nope/cancel' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('cancel rejected-заказа не трогает склад', async () => {
    const { app, ctx } = makeStore();
    const { body } = await placeOrder(app, [{ sku: 'PEN', qty: 5 }]); // stock 1 -> rejected
    await expect.poll(() => ctx.db.order(body.storeOrderId)?.status).toBe('rejected');
    await app.inject({ method: 'POST', url: `/orders/${body.storeOrderId}/cancel` });
    expect(ctx.db.product('PEN')!.stock).toBe(1);
    await app.close();
  });
});
