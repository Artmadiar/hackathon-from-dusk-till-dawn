import { and, eq } from 'drizzle-orm';
import type { Proof, Quote, Req } from '@fdtd/contracts';
import { seqIdGen } from '@fdtd/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DealService, DealTransitionError, type AgentGateway,
} from '../src/deals/deal-service.js';
import { ledgerEntries, wallets, type Deal, type DealStatus } from '../src/db/schema.js';
import { RegistryService } from '../src/registry/registry.js';
import { DEMO_USER_ID, seedDemo } from '../src/registry/seed.js';
import { createTestContext, expectWalletMatchesLedger, truncateAll } from './helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());

class FakeGateway implements AgentGateway {
  calls: Array<{ method: 'fulfil' | 'cancel' | 'run'; input: Record<string, unknown> }> = [];
  async sendFulfil(input: Record<string, unknown>) { this.calls.push({ method: 'fulfil', input }); }
  async sendCancel(input: Record<string, unknown>) { this.calls.push({ method: 'cancel', input }); }
  async runBuyer(input: Record<string, unknown>) { this.calls.push({ method: 'run', input }); }
  of(method: 'fulfil' | 'cancel' | 'run') { return this.calls.filter((c) => c.method === method); }
}

let gateway: FakeGateway;
let service: DealService;
let registry: RegistryService;

const request: Req = {
  items: [{ itemQuery: 'бумага A4 80г', quantity: 5, unit: 'pack', category: 'paper' }],
  categories: ['paper'],
  budget: { max: 5000, source: 'user' },
  deadline: '2026-10-10T00:00:00Z',
  deliveryAddress: 'Praha 7',
};

const quote: Quote = {
  lines: [{ itemIndex: 0, sku: 'A4-80', title: 'Paper A4 80g', unitPrice: 840, quantity: 5, lineTotal: 4200 }],
  total: 4200,
  deliveryEta: '2026-10-09T15:00:00Z',
  validUntil: '2026-10-08T18:00:00Z',
};

const validProof: Proof = {
  storeOrderId: 'so-1', invoiceNumber: 'INV-1',
  lines: [{ sku: 'A4-80', confirmedQuantity: 5 }],
  confirmedTotal: 4200, deliveryEta: '2026-10-09T15:00:00Z',
};

beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.clock.set('2026-10-08T12:00:00Z');
  await seedDemo({ db: ctx.db, events: ctx.events, clock: ctx.clock });
  registry = new RegistryService(ctx.db, ctx.events, ctx.clock);
  const buyerWallet = await getBuyerWallet();
  await ctx.ledger.deposit({ walletId: buyerWallet.id, amount: 10000, idempotencyKey: 'deposit:test:seed' });
  gateway = new FakeGateway();
  service = new DealService({
    db: ctx.db, events: ctx.events, clock: ctx.clock, idGen: seqIdGen(),
    policy: ctx.policy, registry, gateway,
  });
  ctx.events.events.length = 0;
});

async function getBuyerWallet() {
  const [w] = await ctx.db.select().from(wallets)
    .where(and(eq(wallets.ownerType, 'user'), eq(wallets.ownerId, DEMO_USER_ID)));
  return w!;
}

async function mkDeal(status: DealStatus, over: Partial<Quote> = {}): Promise<Deal> {
  const task = await service.createTask({ userId: DEMO_USER_ID, request });
  const deal = await service.createDeal({ taskId: task.id, providerId: 'papirna', quote: { ...quote, ...over } });
  if (status === 'QUOTED') return deal;
  if (status === 'REJECTED_BY_POLICY') {
    const bad = await service.createDeal({
      taskId: task.id, providerId: 'papirna', quote: { ...quote, total: 7600 },
    });
    await service.accept(bad.id);
    return (await service.getDeal(bad.id))!;
  }
  const acc = await service.accept(deal.id);
  if (!acc.ok) throw new Error(`accept failed: ${acc.code}`);
  if (status === 'HELD') return (await service.getDeal(deal.id))!;
  if (status === 'CANCELLED') {
    await service.withdrawOffer(deal.id, 'out_of_stock');
    return (await service.getDeal(deal.id))!;
  }
  await service.markOrderPlaced(deal.id);
  if (status === 'ORDER_PLACED') return (await service.getDeal(deal.id))!;
  await service.submitProof(deal.id, validProof);
  return (await service.getDeal(deal.id))!; // SETTLED
}

describe('DealService: happy path (C11 ядро)', () => {
  it('QUOTED -> accept -> ORDER_PLACED -> proof -> SETTLED, деньги и события по разделу 4', async () => {
    const task = await service.createTask({ userId: DEMO_USER_ID, request });
    const deal = await service.createDeal({ taskId: task.id, providerId: 'papirna', quote });

    const acc = await service.accept(deal.id);
    expect(acc).toMatchObject({ ok: true, replayed: false });
    expect((await service.getTask(task.id))!.status).toBe('ORDERED');
    expect(await getBuyerWallet()).toMatchObject({ balance: 10000, held: 4200 });
    expect(gateway.of('fulfil')).toHaveLength(1);
    expect(gateway.of('fulfil')[0]!.input).toMatchObject({ dealId: deal.id, providerId: 'papirna' });

    await service.markOrderPlaced(deal.id, { storeOrderRef: 'ref-1' });
    const res = await service.submitProof(deal.id, validProof);
    expect(res.settled).toBe(true);

    expect(await getBuyerWallet()).toMatchObject({ balance: 5800, held: 0 });
    const [pw] = await ctx.db.select().from(wallets)
      .where(and(eq(wallets.ownerType, 'provider'), eq(wallets.ownerId, 'papirna')));
    expect(pw).toMatchObject({ balance: 4200 });
    expect((await service.getTask(task.id))!.status).toBe('DONE');
    expect((await registry.get('papirna'))!.ratingX100).toBe(495);

    expect(ctx.events.events).toMatchSequence([
      { type: 'TASK_CREATED', taskId: task.id },
      { type: 'DEAL_QUOTED', dealId: deal.id, providerId: 'papirna', payload: { total: 4200 } },
      { type: 'DEAL_ACCEPTED', dealId: deal.id },
      { type: 'HOLD_PLACED', payload: { amount: 4200 } },
      { type: 'ORDER_PLACED', payload: { storeOrderRef: 'ref-1' } },
      { type: 'PROOF_RECEIVED', payload: { storeOrderId: 'so-1' } },
      { type: 'CAPTURE', payload: { amount: 4200 } },
      { type: 'DEAL_SETTLED' },
      { type: 'RATING_CHANGED', payload: { after: 4.95 } },
      { type: 'TASK_DONE' },
    ]);
    await expectWalletMatchesLedger(ctx.db, (await getBuyerWallet()).id);
  });

  it('C07 повтор accept: replay, один HOLD, fulfil не дублируется', async () => {
    const deal = await mkDeal('QUOTED');
    const first = await service.accept(deal.id);
    const second = await service.accept(deal.id);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });
    const holds = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'HOLD'));
    expect(holds).toHaveLength(1);
    expect(gateway.of('fulfil')).toHaveLength(1);
    expect(ctx.events.events).toMatchSequence(['DEAL_ACCEPTED', 'HOLD_PLACED', 'IDEMPOTENT_REPLAY']);
  });
});

describe('DealService: отказы политики и сроки', () => {
  it('C03 оферта дороже maxPerDeal -> REJECTED_BY_POLICY, леджер нетронут, fulfil не ушёл', async () => {
    const deal = await mkDeal('QUOTED', { total: 7600, lines: [{ ...quote.lines[0]!, unitPrice: 1520, lineTotal: 7600 }] });
    const res = await service.accept(deal.id);
    expect(res).toMatchObject({ ok: false, code: 'over_max_per_deal' });
    expect((await service.getDeal(deal.id))!.status).toBe('REJECTED_BY_POLICY');
    expect(await getBuyerWallet()).toMatchObject({ balance: 10000, held: 0 });
    expect(gateway.of('fulfil')).toHaveLength(0);
    expect(ctx.events.events).toMatchSequence([
      { type: 'DEAL_QUOTED' },
      { type: 'REJECTED_BY_POLICY', payload: { code: 'over_max_per_deal' } },
    ]);
  });

  it('C17 оферта истекла к моменту accept: отказ, сделка остаётся QUOTED', async () => {
    const deal = await mkDeal('QUOTED');
    ctx.clock.set('2026-10-08T19:00:00Z'); // validUntil 18:00 позади
    const res = await service.accept(deal.id);
    expect(res).toMatchObject({ ok: false, code: 'quote_expired' });
    expect((await service.getDeal(deal.id))!.status).toBe('QUOTED');
    expect(await getBuyerWallet()).toMatchObject({ held: 0 });
  });
});

describe('DealService: отмены (C19, C21)', () => {
  it('C21 магазин подтвердил другие условия: CANCELLED, релиз, cancel в K4, рейтинг -0.5, задача в DECIDING', async () => {
    const deal = await mkDeal('ORDER_PLACED');
    ctx.events.events.length = 0;
    gateway.calls.length = 0;

    const res = await service.submitProof(deal.id, { ...validProof, confirmedTotal: 4700 });
    expect(res.settled).toBe(false);
    if (!res.settled) expect(res.violations.map((v) => v.code)).toEqual(['over_total']);

    expect((await service.getDeal(deal.id))!).toMatchObject({ status: 'CANCELLED', cancelReason: 'proof_rejected' });
    expect(await getBuyerWallet()).toMatchObject({ balance: 10000, held: 0 });
    expect((await registry.get('papirna'))!.ratingX100).toBe(440); // 490 - 50
    const task = await service.getTask(deal.taskId);
    expect(task!.status).toBe('DECIDING');
    expect(task!.excludedProviderIds).toEqual(['papirna']);
    expect(gateway.of('cancel')[0]!.input).toMatchObject({ dealId: deal.id, reason: 'proof_rejected' });
    expect(gateway.of('run')[0]!.input).toMatchObject({ taskId: deal.taskId, reason: 'proof_rejected' });
    expect(ctx.events.events).toMatchSequence([
      'PROOF_RECEIVED', 'HOLD_RELEASE',
      { type: 'DEAL_CANCELLED', payload: { reason: 'proof_rejected' } },
      { type: 'RATING_CHANGED', payload: { after: 4.4 } },
    ]);
  });

  it('C19 отзыв оферты из ORDER_PLACED: релиз, OFFER_WITHDRAWN, рейтинг -0.3, /run заказчику', async () => {
    const deal = await mkDeal('ORDER_PLACED');
    ctx.events.events.length = 0;
    gateway.calls.length = 0;

    await service.withdrawOffer(deal.id, 'out_of_stock');
    expect((await service.getDeal(deal.id))!).toMatchObject({ status: 'CANCELLED', cancelReason: 'out_of_stock' });
    expect(await getBuyerWallet()).toMatchObject({ balance: 10000, held: 0 });
    expect((await registry.get('papirna'))!.ratingX100).toBe(460); // 490 - 30
    expect((await service.getTask(deal.taskId))!.status).toBe('DECIDING');
    expect(gateway.of('run')[0]!.input).toMatchObject({ reason: 'offer_withdrawn' });
    expect(ctx.events.events).toMatchSequence([
      { type: 'HOLD_RELEASE', payload: { amount: 4200 } },
      { type: 'OFFER_WITHDRAWN', payload: { reason: 'out_of_stock' } },
      { type: 'RATING_CHANGED', payload: { before: 4.9, after: 4.6 } },
    ]);
    await expectWalletMatchesLedger(ctx.db, (await getBuyerWallet()).id);
  });

  it('отзыв из QUOTED (до холда): без HOLD_RELEASE', async () => {
    const deal = await mkDeal('QUOTED');
    ctx.events.events.length = 0;
    await service.withdrawOffer(deal.id, 'out_of_stock');
    expect((await service.getDeal(deal.id))!.status).toBe('CANCELLED');
    expect(ctx.events.types).not.toContain('HOLD_RELEASE');
    expect(ctx.events.events).toMatchSequence(['OFFER_WITHDRAWN', 'RATING_CHANGED']);
  });
});

describe('DealService: таблица переходов — недопустимое отвергается без побочных эффектов', () => {
  const actions = {
    accept: (d: Deal) => service.accept(d.id),
    markOrderPlaced: (d: Deal) => service.markOrderPlaced(d.id),
    submitProof: (d: Deal) => service.submitProof(d.id, validProof),
    withdrawOffer: (d: Deal) => service.withdrawOffer(d.id, 'x'),
  } as const;

  const invalid: Array<[DealStatus, keyof typeof actions]> = [
    ['QUOTED', 'markOrderPlaced'], ['QUOTED', 'submitProof'],
    ['HELD', 'submitProof'],
    ['ORDER_PLACED', 'accept'], // HELD -> accept это replay, не ошибка; из ORDER_PLACED — ошибка
    ['SETTLED', 'accept'], ['SETTLED', 'markOrderPlaced'], ['SETTLED', 'submitProof'], ['SETTLED', 'withdrawOffer'],
    ['CANCELLED', 'accept'], ['CANCELLED', 'markOrderPlaced'], ['CANCELLED', 'submitProof'], ['CANCELLED', 'withdrawOffer'],
    ['REJECTED_BY_POLICY', 'accept'], ['REJECTED_BY_POLICY', 'markOrderPlaced'],
    ['REJECTED_BY_POLICY', 'submitProof'], ['REJECTED_BY_POLICY', 'withdrawOffer'],
  ];

  for (const [status, action] of invalid) {
    it(`${action} из ${status} -> DealTransitionError`, async () => {
      const deal = await mkDeal(status);
      const eventsBefore = ctx.events.events.length;
      const ledgerBefore = (await ctx.db.select().from(ledgerEntries)).length;
      const walletBefore = await getBuyerWallet();

      await expect(actions[action](deal)).rejects.toThrowError(DealTransitionError);

      expect((await service.getDeal(deal.id))!.status).toBe(status);
      expect(ctx.events.events.length).toBe(eventsBefore);
      expect((await ctx.db.select().from(ledgerEntries)).length).toBe(ledgerBefore);
      expect(await getBuyerWallet()).toMatchObject({ balance: walletBefore.balance, held: walletBefore.held });
    });
  }

  it('HELD -> markOrderPlaced -> ORDER_PLACED (допустимый переход работает)', async () => {
    const deal = await mkDeal('HELD');
    const updated = await service.markOrderPlaced(deal.id);
    expect(updated.status).toBe('ORDER_PLACED');
  });
});
