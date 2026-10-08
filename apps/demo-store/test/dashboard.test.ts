import { describe, expect, it } from 'vitest';
import { makeStore, placeOrder } from './helpers.js';

describe('дашборд магазина', () => {
  it('показывает заказы и остатки', async () => {
    const { app } = makeStore();
    const { body } = await placeOrder(app, [{ sku: 'A4', qty: 2 }]);
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(body.storeOrderId);
    expect(res.payload).toContain('Papír A4');
    expect(res.payload).toContain('confirmed'); // autoConfirm
    await app.close();
  });

  it('ручной магазин: заказ ждёт кнопки, «подтвердить» шлёт webhook confirmed', async () => {
    const { app, ctx, receiver } = makeStore({ autoConfirm: false });
    const { body } = await placeOrder(app, [{ sku: 'A4', qty: 2 }]);
    expect(ctx.db.order(body.storeOrderId)!.status).toBe('pending');
    expect(receiver.received.length).toBe(0);

    const res = await app.inject({ method: 'POST', url: `/dashboard/orders/${body.storeOrderId}/confirm` });
    expect(res.statusCode).toBe(303);
    await expect.poll(() => receiver.received.length).toBe(1);
    expect(receiver.received[0].body).toMatchObject({ status: 'confirmed', storeOrderId: body.storeOrderId });
    expect(ctx.db.order(body.storeOrderId)!.status).toBe('confirmed');
    // повторная кнопка — webhook не задвоился
    await app.inject({ method: 'POST', url: `/dashboard/orders/${body.storeOrderId}/confirm` });
    await new Promise((r) => setTimeout(r, 30));
    expect(receiver.received.length).toBe(1);
    await app.close();
  });

  it('«отклонить» возвращает резерв и шлёт webhook rejected', async () => {
    const { app, ctx, receiver } = makeStore({ autoConfirm: false });
    const { body } = await placeOrder(app, [{ sku: 'A4', qty: 3 }]);
    expect(ctx.db.product('A4')!.stock).toBe(2);

    await app.inject({ method: 'POST', url: `/dashboard/orders/${body.storeOrderId}/reject` });
    await expect.poll(() => receiver.received.length).toBe(1);
    expect(receiver.received[0].body).toMatchObject({ status: 'rejected', reason: 'rejected_by_store' });
    expect(ctx.db.product('A4')!.stock).toBe(5);
    expect(ctx.db.order(body.storeOrderId)!.status).toBe('rejected');
    await app.close();
  });

  it('лендинг отвечает и показывает товары', async () => {
    const { app, ctx } = makeStore();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(ctx.seed.name);
    expect(res.payload).toContain('Papír A4');
    await app.close();
  });
});
