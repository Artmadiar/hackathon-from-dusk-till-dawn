import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { resolveIdentity } from '../http/identity.js';
import { idempotencyKeys, type LedgerService } from '../ledger/ledger.js';

export interface StripeDeps {
  ledger: LedgerService;
  auth?: AuthService;
  secretKey?: string;         // STRIPE_SECRET_KEY
  webhookSecret?: string;     // STRIPE_WEBHOOK_SECRET (из `stripe listen`)
  webUrl?: string;            // куда возвращать из Checkout (N4)
}

/**
 * C01: реальная sandbox-транзакция — Stripe Checkout (test mode) + webhook -> DEPOSIT.
 * C02: повтор webhook дедуплицируется ключом deposit:stripe:{eventId} в леджере.
 */
export function registerStripeRoutes(app: FastifyInstance, deps: StripeDeps): void {
  // без ключа инстанс всё равно нужен: верификация подписи webhook — чистая криптография
  const stripe = new Stripe(deps.secretKey ?? 'sk_test_offline_dummy');
  const checkoutEnabled = Boolean(deps.secretKey);
  const webUrl = deps.webUrl ?? 'http://localhost:3387';

  /** Кнопка «Пополнить»: сумма в центах -> URL Checkout-сессии. */
  app.post('/wallet/checkout', async (req, reply) => {
    if (!checkoutEnabled) return reply.code(503).send({ error: 'stripe_not_configured', hint: 'use POST /dev/deposit (SIMULATED)' });
    const parsed = z.object({
      amount: z.number().int().min(50),       // Stripe-минимум ~0.50 $
      userId: z.string().min(1).optional(),   // фоллбэк без сессии (e2e/curl)
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });

    const identity = await resolveIdentity(req, deps.auth);
    const userId = identity?.role === 'buyer' ? identity.userId : parsed.data.userId;
    if (!userId) return reply.code(401).send({ error: 'buyer_identity_required' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: userId,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: parsed.data.amount,
          product_data: { name: 'Wallet top-up' },
        },
      }],
      success_url: `${webUrl}/#/wallet?topup=pending`,
      cancel_url: `${webUrl}/#/wallet?topup=cancelled`,
    });
    return { url: session.url, sessionId: session.id };
  });

  /* Отдельный scope: подпись проверяется по сырому телу, JSON-парсер Fastify мешает */
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post('/webhooks/stripe', async (req, reply) => {
      if (!deps.webhookSecret) return reply.code(503).send({ error: 'stripe_not_configured' });
      const signature = req.headers['stripe-signature'];
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          typeof signature === 'string' ? signature : '',
          deps.webhookSecret,
        );
      } catch (e) {
        req.log.warn({ err: String(e) }, 'stripe webhook: bad signature');
        return reply.code(400).send({ error: 'bad_signature' });
      }

      if (event.type !== 'checkout.session.completed') {
        return { received: true, ignored: event.type };
      }
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== 'paid') return { received: true, ignored: 'not_paid' };
      const userId = session.client_reference_id;
      const amount = session.amount_total;
      if (!userId || !amount) {
        req.log.warn({ eventId: event.id }, 'stripe webhook: no client_reference_id/amount_total');
        return reply.code(400).send({ error: 'missing_user_or_amount' });
      }

      const wallet = await deps.ledger.createWallet({ ownerType: 'user', ownerId: userId });
      const res = await deps.ledger.deposit({
        walletId: wallet.id,
        amount,
        idempotencyKey: idempotencyKeys.depositStripe(event.id),
        simulated: false,
        correlationId: req.id,
      });
      return { received: true, entryId: res.entry.id, replayed: res.replayed };
    });
  });
}
