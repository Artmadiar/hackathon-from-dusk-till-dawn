import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerEntries } from '../src/db/schema.js';
import { idempotencyKeys } from '../src/ledger/ledger.js';
import { acceptHold } from '../src/policy/accept-hold.js';
import { createTestContext, expectWalletMatchesLedger, truncateAll } from './helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());

const USER = 'buyer-1';
let walletId: string;

beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.events.events.length = 0;
  ctx.clock.set('2026-10-08T12:00:00Z');
  const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: USER });
  walletId = w.id;
  await ctx.ledger.deposit({ walletId, amount: 100000, idempotencyKey: idempotencyKeys.depositStripe('seed') });
  await ctx.policy.setPolicy({
    userId: USER, maxPerDeal: 10000, maxPerDay: 15000, totalBudget: 50000,
    allowedCategories: ['paper', 'writing', 'office'],
  });
  ctx.events.events.length = 0; // интересуют только события самих проверок
});

function accept(dealId: string, amount: number, categories: string[] = ['paper']) {
  return acceptHold(
    { db: ctx.db, policy: ctx.policy, events: ctx.events, clock: ctx.clock },
    { userId: USER, walletId, dealId, amount, categories },
  );
}

async function ledgerCount(): Promise<number> {
  return (await ctx.db.select().from(ledgerEntries)).length;
}

describe('Policy + hold в одной транзакции (C03-C06, B6)', () => {
  it('успех: холд поставлен, HOLD_PLACED', async () => {
    const res = await accept('d1', 4200);
    expect(res.ok).toBe(true);
    expect(await ctx.ledger.getWallet(walletId)).toMatchObject({ held: 4200 });
    expect(ctx.events.events).toMatchSequence([
      { type: 'HOLD_PLACED', dealId: 'd1', payload: { amount: 4200 } },
    ]);
    await expectWalletMatchesLedger(ctx.db, walletId);
  });

  it('C03 дороже maxPerDeal: REJECTED_BY_POLICY, баланс и held не изменились', async () => {
    const before = await ledgerCount();
    const res = await accept('d1', 10001);
    expect(res).toMatchObject({ ok: false, code: 'over_max_per_deal' });
    expect(await ctx.ledger.getWallet(walletId)).toMatchObject({ balance: 100000, held: 0 });
    expect(await ledgerCount()).toBe(before);
    expect(ctx.events.events).toMatchSequence([
      { type: 'REJECTED_BY_POLICY', dealId: 'd1', payload: { code: 'over_max_per_deal' } },
    ]);
  });

  it('C04 maxPerDay: вторая сделка сверх лимита отклонена, первая в порядке', async () => {
    expect((await accept('d1', 9000)).ok).toBe(true);
    const res = await accept('d2', 7000); // 9000 + 7000 > 15000
    expect(res).toMatchObject({ ok: false, code: 'over_max_per_day' });
    expect(await ctx.ledger.getWallet(walletId)).toMatchObject({ held: 9000 });

    // следующий день — лимит снова свободен
    ctx.clock.set('2026-10-09T08:00:00Z');
    expect((await accept('d3', 7000)).ok).toBe(true);
    expect(await ctx.ledger.getWallet(walletId)).toMatchObject({ held: 16000 });
  });

  it('B6 HOLD_RELEASE вычитается из дневного расхода', async () => {
    expect((await accept('d1', 9000)).ok).toBe(true);
    await ctx.ledger.releaseHold({ dealId: 'd1' });
    // 9000 - 9000 = 0 за день, значит 7000 проходит
    expect((await accept('d2', 7000)).ok).toBe(true);
    expect(await ctx.ledger.getWallet(walletId)).toMatchObject({ held: 7000 });
  });

  it('B6 capture остаётся в дневном расходе (нельзя "освободить" лимит расчётом)', async () => {
    const provider = await ctx.ledger.createWallet({ ownerType: 'provider', ownerId: 'papirna' });
    expect((await accept('d1', 9000)).ok).toBe(true);
    await ctx.ledger.capture({ dealId: 'd1', buyerWalletId: walletId, providerWalletId: provider.id });
    const res = await accept('d2', 7000); // 9000 потрачено + 7000 > 15000
    expect(res).toMatchObject({ ok: false, code: 'over_max_per_day' });
  });

  it('C05 totalBudget исчерпан: отклонено даже на следующий день', async () => {
    const provider = await ctx.ledger.createWallet({ ownerType: 'provider', ownerId: 'papirna' });
    // тратим 3 дня по 10000+5000 = 45000 капчами
    let deal = 0;
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      ctx.clock.set(`${day}T10:00:00Z`);
      for (const amount of [10000, 5000]) {
        const r = await accept(`spend-${++deal}`, amount);
        expect(r.ok).toBe(true);
        await ctx.ledger.capture({ dealId: `spend-${deal}`, buyerWalletId: walletId, providerWalletId: provider.id });
      }
    }
    ctx.clock.set('2026-10-08T12:00:00Z');
    const res = await accept('d-over', 6000); // 45000 + 6000 > 50000
    expect(res).toMatchObject({ ok: false, code: 'over_total_budget' });
    expect((await accept('d-fit', 5000)).ok).toBe(true); // ровно в бюджет
  });

  it('C06 категория вне allowedCategories: отказ до денег, леджер не тронут', async () => {
    const before = await ledgerCount();
    const res = await accept('d1', 100, ['water']);
    expect(res).toMatchObject({ ok: false, code: 'category_not_allowed' });
    expect(await ledgerCount()).toBe(before);
    expect(ctx.events.events).toMatchSequence([
      { type: 'REJECTED_BY_POLICY', payload: { code: 'category_not_allowed' } },
    ]);
  });

  it('нет политики -> no_policy', async () => {
    const res = await acceptHold(
      { db: ctx.db, policy: ctx.policy, events: ctx.events, clock: ctx.clock },
      { userId: 'stranger', walletId, dealId: 'd1', amount: 100, categories: ['paper'] },
    );
    expect(res).toMatchObject({ ok: false, code: 'no_policy' });
  });

  it('available меньше суммы при живой политике -> insufficient_funds, REJECTED_BY_POLICY', async () => {
    await ctx.policy.setPolicy({
      userId: USER, maxPerDeal: 1000000, maxPerDay: 1000000, totalBudget: 10000000,
      allowedCategories: ['paper'],
    });
    expect((await accept('d1', 95000)).ok).toBe(true);
    const res = await accept('d2', 95000); // available 5000
    expect(res).toMatchObject({ ok: false, code: 'insufficient_funds' });
    await expectWalletMatchesLedger(ctx.db, walletId);
  });

  it('C07 повтор accept по тому же dealId: один HOLD, replay', async () => {
    const first = await accept('d1', 4200);
    const second = await accept('d1', 4200);
    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.replayed).toBe(true);
    expect(await ctx.ledger.getWallet(walletId)).toMatchObject({ held: 4200 });
    expect(ctx.events.events).toMatchSequence(['HOLD_PLACED', 'IDEMPOTENT_REPLAY']);
  });
});
