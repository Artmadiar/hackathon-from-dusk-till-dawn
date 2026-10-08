import { createApp } from '@fdtd/shared';
import Stripe from 'stripe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registerStripeRoutes } from '../src/stripe/routes.js';
import { createTestContext, expectWalletMatchesLedger, truncateAll } from './helpers.js';

const ctx = createTestContext();
const WEBHOOK_SECRET = 'whsec_test_local';
const signer = new Stripe('sk_test_offline_dummy');

const app = createApp({ service: 'test-stripe' });
registerStripeRoutes(app, { ledger: ctx.ledger, webhookSecret: WEBHOOK_SECRET });

afterAll(async () => { await app.close(); await ctx.close(); });
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.events.events.length = 0;
});

function checkoutCompleted(eventId: string, opts: { userId?: string; amount?: number } = {}): string {
  return JSON.stringify({
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2025-09-30',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: opts.amount ?? 10_000,
        client_reference_id: opts.userId ?? 'buyer-1',
      },
    },
  });
}

async function post(payload: string, signature?: string) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature ?? signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
    },
    payload,
  });
}

describe('C01: Stripe webhook -> DEPOSIT', () => {
  it('checkout.session.completed зачисляет amount_total в кошелёк пользователя', async () => {
    const res = await post(checkoutCompleted('evt_1'));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { replayed: boolean }).replayed).toBe(false);

    const wallet = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
    expect((await ctx.ledger.getWallet(wallet.id)).balance).toBe(10_000);
    await expectWalletMatchesLedger(ctx.db, wallet.id);

    const dep = ctx.events.events.find((e) => e.type === 'DEPOSIT');
    expect(dep).toBeDefined();
    expect((dep!.payload as { simulated: boolean }).simulated).toBe(false); // реальная sandbox-транзакция
  });

  it('плохая подпись -> 400, леджер не тронут', async () => {
    const res = await post(checkoutCompleted('evt_2'), 't=1,v1=deadbeef');
    expect(res.statusCode).toBe(400);
    expect(ctx.events.events).toHaveLength(0);
  });

  it('не-checkout события вежливо игнорируются', async () => {
    const payload = JSON.stringify({ id: 'evt_3', object: 'event', type: 'payment_intent.created', data: { object: {} } });
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ignored: string }).ignored).toBe('payment_intent.created');
  });
});

describe('C02: повтор того же webhook', () => {
  it('второго DEPOSIT нет: ключ deposit:stripe:{eventId}', async () => {
    await post(checkoutCompleted('evt_dup'));
    const res = await post(checkoutCompleted('evt_dup'));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { replayed: boolean }).replayed).toBe(true);

    const wallet = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
    expect((await ctx.ledger.getWallet(wallet.id)).balance).toBe(10_000);
    const deposits = ctx.events.events.filter((e) => e.type === 'DEPOSIT');
    expect(deposits).toHaveLength(1);
    expect(ctx.events.types).toContain('IDEMPOTENT_REPLAY');
  });
});

describe('Stripe не настроен', () => {
  it('webhook -> 503, checkout -> 503 с подсказкой про SIMULATED', async () => {
    const bare = createApp({ service: 'test-stripe-bare' });
    registerStripeRoutes(bare, { ledger: ctx.ledger });
    const wh = await bare.inject({ method: 'POST', url: '/webhooks/stripe', payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(wh.statusCode).toBe(503);
    const co = await bare.inject({ method: 'POST', url: '/wallet/checkout', payload: { amount: 1000, userId: 'buyer-1' } });
    expect(co.statusCode).toBe(503);
    await bare.close();
  });
});
