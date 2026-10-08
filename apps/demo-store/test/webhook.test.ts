import { describe, expect, it } from 'vitest';
import { fixedClock, verifyWebhook } from '@fdtd/shared';
import { makeStore, placeOrder, SECRET, NOW } from './helpers.js';

describe('K7: подпись и доставка webhook', () => {
  it('webhook подписан HMAC с timestamp и nonce, подпись сходится', async () => {
    const { app, receiver } = makeStore();
    await placeOrder(app, [{ sku: 'A4', qty: 1 }]);
    await expect.poll(() => receiver.received.length).toBe(1);

    const { raw, signature } = receiver.received[0];
    expect(signature).toMatch(/^t=\d+,n=[0-9a-f]+,v1=[0-9a-f]{64}$/);
    const check = verifyWebhook(raw, signature, SECRET, { clock: fixedClock(NOW) });
    expect(check).toMatchObject({ ok: true });
    const wrong = verifyWebhook(raw, signature, 'other-secret', { clock: fixedClock(NOW) });
    expect(wrong).toMatchObject({ ok: false, reason: 'bad_signature' });
    await app.close();
  });

  it('ретрай с backoff при 5xx и сетевой ошибке; тело одно, подпись свежая', async () => {
    const { app, receiver } = makeStore({ statuses: [500, 'network_error'] }); // затем 200
    await placeOrder(app, [{ sku: 'A4', qty: 1 }]);
    await expect.poll(() => receiver.attempts(), { timeout: 2000 }).toBe(3);
    // до приёмника дошли первая (500) и третья (200) попытки; сетевая не записана
    expect(receiver.received.length).toBe(2);
    expect(receiver.received[0].raw).toBe(receiver.received[1].raw);
    expect(receiver.received[0].signature).not.toBe(receiver.received[1].signature); // новый nonce
    await app.close();
  });

  it('4xx от приёмника — не ретраим', async () => {
    const { app, receiver } = makeStore({ statuses: [400] });
    await placeOrder(app, [{ sku: 'A4', qty: 1 }]);
    await expect.poll(() => receiver.attempts()).toBe(1);
    await new Promise((r) => setTimeout(r, 50)); // окно, в котором ретрай успел бы случиться
    expect(receiver.attempts()).toBe(1);
    await app.close();
  });

  it('ретраи исчерпаны (все 5xx) — попыток ровно 1 + len(backoff)', async () => {
    const { app, receiver } = makeStore({ statuses: [500, 500, 500, 500] });
    await placeOrder(app, [{ sku: 'A4', qty: 1 }]);
    await expect.poll(() => receiver.attempts(), { timeout: 2000 }).toBe(3); // backoffMs [5,10]
    await new Promise((r) => setTimeout(r, 50));
    expect(receiver.attempts()).toBe(3);
    await app.close();
  });
});
