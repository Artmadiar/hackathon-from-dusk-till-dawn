import { describe, expect, it } from 'vitest';
import { matchSequence } from '@fdtd/shared';
import { authHeader, fulfil, makeAgent, signedWebhook, sleep, WEBHOOK_SECRET } from './helpers.js';

const confirmedPayload = (over: Record<string, unknown> = {}) => ({
  storeOrderId: 'so-1',
  status: 'confirmed',
  invoiceNumber: 'INV-1',
  lines: [{ sku: 'A4', confirmedQuantity: 2 }, { sku: 'PEN', confirmedQuantity: 5 }],
  confirmedTotal: 1600,
  deliveryEta: '2026-10-10T15:00:00.000Z',
  trackingNumber: 'TRK-1',
  ...over,
});

const postHook = (app: ReturnType<typeof makeAgent>['app'], w: { body: string; signature: string }) =>
  app.inject({
    method: 'POST', url: '/hooks/store',
    headers: { 'content-type': 'application/json', 'x-store-signature': w.signature },
    payload: w.body,
  });

describe('C11: fulfil -> заказ -> webhook confirmed -> submit_proof', () => {
  it('основной путь', async () => {
    const { app, store, platform } = makeAgent();
    const { res } = await fulfil(app);
    expect(res.statusCode).toBe(202);

    await expect.poll(() => store.orders.length).toBe(1);
    expect(store.orders[0]).toMatchObject({
      items: [{ sku: 'A4', qty: 2 }, { sku: 'PEN', qty: 5 }],
      deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
    });
    expect(store.orders[0].buyerRef).not.toContain('deal'); // непрозрачный (B13)
    await expect.poll(() => platform.placed.length).toBe(1);
    expect(platform.placed[0]).toEqual({ dealId: 'deal-1', storeOrderRef: 'so-1' });
    const waiting = platform.events.find((e) => e.type === 'WAITING');
    expect(waiting?.payload).toMatchObject({ for: 'store_webhook', until: '2026-10-08T12:00:00.100Z' });

    const hook = await postHook(app, signedWebhook(confirmedPayload()));
    expect(hook.statusCode).toBe(200);
    expect(platform.proofs).toHaveLength(1);
    expect(platform.proofs[0]).toMatchObject({
      dealId: 'deal-1',
      proof: {
        storeOrderId: 'so-1', invoiceNumber: 'INV-1', confirmedTotal: 1600,
        lines: [{ sku: 'A4', confirmedQuantity: 2 }, { sku: 'PEN', confirmedQuantity: 5 }],
      },
    });
    // таймер снят: спустя таймаут отзыва нет
    await sleep(150);
    expect(platform.withdrawals).toEqual([]);
    const seq = matchSequence(platform.events as unknown as Array<Record<string, unknown>>, [
      { type: 'WAITING' }, { type: 'DECISION', payload: { decision: 'submit_proof' } },
    ]);
    expect(seq.pass, seq.message).toBe(true);
    await app.close();
  });
});

describe('C19/C20: отзыв оферты', () => {
  it('C19: webhook rejected -> withdraw_offer с причиной магазина, cancel не шлём', async () => {
    const { app, store, platform } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);

    const hook = await postHook(app, signedWebhook({ storeOrderId: 'so-1', status: 'rejected', reason: 'out_of_stock' }));
    expect(hook.statusCode).toBe(200);
    expect(platform.withdrawals).toEqual([{ dealId: 'deal-1', reason: 'out_of_stock' }]);
    expect(store.cancelled).toEqual([]); // магазин сам отказал — отменять нечего
    await sleep(150); // таймер снят, второго отзыва нет
    expect(platform.withdrawals).toHaveLength(1);
    await app.close();
  });

  it('C20: магазин молчит -> withdraw_offer(timeout) + cancel_order в магазин', async () => {
    const { app, store, platform } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);

    await expect.poll(() => platform.withdrawals.length, { timeout: 2000 }).toBe(1);
    expect(platform.withdrawals[0]).toEqual({ dealId: 'deal-1', reason: 'timeout' });
    expect(store.cancelled).toEqual(['so-1']);
    // поздний webhook после отзыва — ничего
    const late = await postHook(app, signedWebhook(confirmedPayload()));
    expect(late.statusCode).toBe(200);
    expect(late.json()).toMatchObject({ duplicate: true });
    expect(platform.proofs).toEqual([]);
    await app.close();
  });

  it('подтверждение не соответствует заказу (qty меньше) -> withdraw + cancel_order', async () => {
    const { app, store, platform } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);

    await postHook(app, signedWebhook(confirmedPayload({
      lines: [{ sku: 'A4', confirmedQuantity: 1 }, { sku: 'PEN', confirmedQuantity: 5 }],
    })));
    expect(platform.withdrawals).toEqual([{ dealId: 'deal-1', reason: 'confirmation_mismatch:A4' }]);
    expect(store.cancelled).toEqual(['so-1']);
    expect(platform.proofs).toEqual([]);
    await app.close();
  });
});

describe('C08/C24: идемпотентность и защита webhook', () => {
  it('C08: повтор webhook тем же storeOrderId -> ничего, один Proof', async () => {
    const { app, store, platform } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);

    await postHook(app, signedWebhook(confirmedPayload()));
    const again = await postHook(app, signedWebhook(confirmedPayload())); // свежий nonce
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true });
    expect(platform.proofs).toHaveLength(1);
    await app.close();
  });

  it('C24: плохая подпись -> 401 + WEBHOOK_REJECTED', async () => {
    const { app, store, platform } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);

    const res = await postHook(app, signedWebhook(confirmedPayload(), { secret: 'wrong-secret' }));
    expect(res.statusCode).toBe(401);
    expect(platform.events.filter((e) => e.type === 'WEBHOOK_REJECTED')).toHaveLength(1);
    expect(platform.proofs).toEqual([]);
    await app.close();
  });

  it('C24: старый timestamp -> 401', async () => {
    const { app, store } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);
    const res = await postHook(app, signedWebhook(confirmedPayload(), { atIso: '2026-10-08T11:49:00Z' })); // -11 мин
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('C24: повтор nonce -> 401', async () => {
    const { app, store } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);
    const w = signedWebhook(confirmedPayload(), { nonce: 'fixed-nonce' });
    expect((await postHook(app, w)).statusCode).toBe(200);
    expect((await postHook(app, w)).statusCode).toBe(401);
    await app.close();
  });

  it('C24: неизвестный storeOrderId -> 404 + WEBHOOK_REJECTED', async () => {
    const { app, platform } = makeAgent();
    const res = await postHook(app, signedWebhook(confirmedPayload({ storeOrderId: 'so-ghost' })));
    expect(res.statusCode).toBe(404);
    expect(platform.events.at(-1)).toMatchObject({ type: 'WEBHOOK_REJECTED', payload: { reason: 'unknown_store_order' } });
    await app.close();
  });
});

describe('K4: /cancel от платформы', () => {
  it('заказ в магазине отменён, связь закрыта, поздний webhook -> ничего', async () => {
    const { app, store, platform } = makeAgent();
    await fulfil(app);
    await expect.poll(() => store.orders.length).toBe(1);

    const res = await app.inject({
      method: 'POST', url: '/cancel', headers: authHeader(),
      payload: { dealId: 'deal-1', reason: 'proof_invalid' },
    });
    expect(res.statusCode).toBe(202);
    await expect.poll(() => store.cancelled.length).toBe(1);
    expect(store.cancelled).toEqual(['so-1']);

    const late = await postHook(app, signedWebhook(confirmedPayload()));
    expect(late.json()).toMatchObject({ duplicate: true });
    expect(platform.proofs).toEqual([]);
    await sleep(150); // таймер снят
    expect(platform.withdrawals).toEqual([]);
    await app.close();
  });
});
