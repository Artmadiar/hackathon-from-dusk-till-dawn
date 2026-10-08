import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerEntries, wallets } from '../src/db/schema.js';
import { LedgerError } from '../src/ledger/errors.js';
import { idempotencyKeys } from '../src/ledger/ledger.js';
import {
  createTestContext, expectWalletMatchesLedger, truncateAll,
} from './helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.events.events.length = 0;
  ctx.clock.set('2026-10-08T12:00:00Z');
});

async function buyerWallet(deposit = 10000): Promise<string> {
  const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
  if (deposit > 0) {
    await ctx.ledger.deposit({
      walletId: w.id, amount: deposit,
      idempotencyKey: idempotencyKeys.depositStripe('evt_seed'),
    });
  }
  return w.id;
}

describe('Ledger: deposit (C01, C02)', () => {
  it('C01 deposit пишет запись, баланс вырос, событие DEPOSIT', async () => {
    const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
    const res = await ctx.ledger.deposit({
      walletId: w.id, amount: 5000,
      idempotencyKey: idempotencyKeys.depositStripe('evt_1'), simulated: false,
    });
    expect(res.replayed).toBe(false);
    expect(await ctx.ledger.getWallet(w.id)).toMatchObject({ balance: 5000, held: 0 });
    expect(ctx.events.events).toMatchSequence([
      { type: 'DEPOSIT', payload: { amount: 5000, simulated: false, walletId: w.id } },
    ]);
    await expectWalletMatchesLedger(ctx.db, w.id);
  });

  it('C02 повтор того же eventId: второго DEPOSIT нет, IDEMPOTENT_REPLAY', async () => {
    const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
    const first = await ctx.ledger.deposit({
      walletId: w.id, amount: 5000, idempotencyKey: idempotencyKeys.depositStripe('evt_1'),
    });
    const second = await ctx.ledger.deposit({
      walletId: w.id, amount: 5000, idempotencyKey: idempotencyKeys.depositStripe('evt_1'),
    });
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(await ctx.ledger.getWallet(w.id)).toMatchObject({ balance: 5000 });
    expect(ctx.events.types.filter((t) => t === 'DEPOSIT')).toHaveLength(1);
    expect(ctx.events.events).toMatchSequence(['DEPOSIT', 'IDEMPOTENT_REPLAY']);
    await expectWalletMatchesLedger(ctx.db, w.id);
  });

  it('SIMULATED deposit помечен в событии', async () => {
    const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: 'buyer-1' });
    await ctx.ledger.deposit({ walletId: w.id, amount: 100, idempotencyKey: 'deposit:simulated:1', simulated: true });
    expect(ctx.events.events).toMatchSequence([{ type: 'DEPOSIT', payload: { simulated: true } }]);
  });
});

describe('Ledger: hold / release / capture (C07, C08, C10)', () => {
  it('C07 повтор hold по dealId: один HOLD, та же запись, held не удвоен', async () => {
    const w = await buyerWallet();
    const first = await ctx.ledger.hold({ walletId: w, dealId: 'd1', amount: 4200 });
    const second = await ctx.ledger.hold({ walletId: w, dealId: 'd1', amount: 4200 });
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(await ctx.ledger.getWallet(w)).toMatchObject({ balance: 10000, held: 4200 });
    expect(ctx.events.events).toMatchSequence(['HOLD_PLACED', 'IDEMPOTENT_REPLAY']);
    await expectWalletMatchesLedger(ctx.db, w);
  });

  it('hold больше available -> insufficient_funds, леджер не тронут', async () => {
    const w = await buyerWallet(1000);
    await expect(ctx.ledger.hold({ walletId: w, dealId: 'd1', amount: 1001 }))
      .rejects.toThrowError(LedgerError);
    expect(await ctx.ledger.getWallet(w)).toMatchObject({ balance: 1000, held: 0 });
    const entries = await ctx.db.select().from(ledgerEntries);
    expect(entries.filter((e) => e.type === 'HOLD')).toHaveLength(0);
  });

  it('release возвращает сумму холда; повтор — replay без изменений', async () => {
    const w = await buyerWallet();
    await ctx.ledger.hold({ walletId: w, dealId: 'd1', amount: 4200 });
    const rel = await ctx.ledger.releaseHold({ dealId: 'd1' });
    expect(rel.entry).toMatchObject({ type: 'HOLD_RELEASE', amount: 4200 });
    expect(await ctx.ledger.getWallet(w)).toMatchObject({ balance: 10000, held: 0 });

    const again = await ctx.ledger.releaseHold({ dealId: 'd1' });
    expect(again.replayed).toBe(true);
    expect(await ctx.ledger.getWallet(w)).toMatchObject({ balance: 10000, held: 0 });
    expect(ctx.events.events).toMatchSequence(['HOLD_PLACED', 'HOLD_RELEASE', 'IDEMPOTENT_REPLAY']);
    await expectWalletMatchesLedger(ctx.db, w);
  });

  it('release без холда -> hold_not_found', async () => {
    await expect(ctx.ledger.releaseHold({ dealId: 'ghost' })).rejects.toThrowError(/no hold/);
  });

  it('capture: покупатель заплатил, исполнитель получил, available покупателя не менялся', async () => {
    const buyer = await buyerWallet();
    const provider = await ctx.ledger.createWallet({ ownerType: 'provider', ownerId: 'papirna' });
    await ctx.ledger.hold({ walletId: buyer, dealId: 'd1', amount: 4200 });

    const res = await ctx.ledger.capture({ dealId: 'd1', buyerWalletId: buyer, providerWalletId: provider.id });
    expect(res.replayed).toBe(false);
    expect(await ctx.ledger.getWallet(buyer)).toMatchObject({ balance: 5800, held: 0 });
    expect(await ctx.ledger.getWallet(provider.id)).toMatchObject({ balance: 4200, held: 0 });
    expect(ctx.events.events).toMatchSequence([
      { type: 'HOLD_PLACED', dealId: 'd1' },
      { type: 'CAPTURE', dealId: 'd1', payload: { amount: 4200 } },
    ]);
    await expectWalletMatchesLedger(ctx.db, buyer);
    await expectWalletMatchesLedger(ctx.db, provider.id);
  });

  it('C08 повтор capture (дубль webhook): леджер не изменился, IDEMPOTENT_REPLAY', async () => {
    const buyer = await buyerWallet();
    const provider = await ctx.ledger.createWallet({ ownerType: 'provider', ownerId: 'papirna' });
    await ctx.ledger.hold({ walletId: buyer, dealId: 'd1', amount: 4200 });
    await ctx.ledger.capture({ dealId: 'd1', buyerWalletId: buyer, providerWalletId: provider.id });

    const again = await ctx.ledger.capture({ dealId: 'd1', buyerWalletId: buyer, providerWalletId: provider.id });
    expect(again.replayed).toBe(true);
    expect(await ctx.ledger.getWallet(buyer)).toMatchObject({ balance: 5800, held: 0 });
    expect(await ctx.ledger.getWallet(provider.id)).toMatchObject({ balance: 4200 });
    expect(ctx.events.types.filter((t) => t === 'CAPTURE')).toHaveLength(1);
    expect(ctx.events.events).toMatchSequence(['CAPTURE', 'IDEMPOTENT_REPLAY']);
  });

  it('CHECK (available >= 0) живёт и в самой базе', async () => {
    const w = await buyerWallet(1000);
    await expect(
      ctx.db.execute(sql`UPDATE wallets SET held = 2000 WHERE id = ${w}`),
    ).rejects.toSatisfy((e) => /available_non_negative/.test(String((e as Error).cause ?? e)));
  });
});

describe('Ledger: гонки (C09)', () => {
  it('10 параллельных hold при available на один: ровно один успех', async () => {
    const w = await buyerWallet(1000);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        ctx.ledger.hold({ walletId: w, dealId: `race-${i}`, amount: 1000 })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter(
      (r) => r.status === 'rejected' && (r.reason as LedgerError).code === 'insufficient_funds',
    );
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    expect(await ctx.ledger.getWallet(w)).toMatchObject({ balance: 1000, held: 1000 });
    await expectWalletMatchesLedger(ctx.db, w);
  });
});

describe('Ledger: инвариант после любой последовательности (C10)', () => {
  it('50 случайных операций + повторы: balance/held = сумме леджера', async () => {
    // детерминированный LCG, чтобы прогон был воспроизводим
    let seed = 20261008;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

    const buyer = await buyerWallet(0);
    const provider = await ctx.ledger.createWallet({ ownerType: 'provider', ownerId: 'papirna' });
    const openDeals: string[] = [];
    let dealSeq = 0;

    for (let i = 0; i < 50; i++) {
      const op = pick(['deposit', 'hold', 'hold', 'release', 'capture']);
      try {
        if (op === 'deposit') {
          await ctx.ledger.deposit({
            walletId: buyer, amount: 100 + Math.floor(rand() * 5000),
            idempotencyKey: `deposit:rand:${i}`,
          });
        } else if (op === 'hold') {
          const dealId = `rd-${++dealSeq}`;
          await ctx.ledger.hold({ walletId: buyer, dealId, amount: 100 + Math.floor(rand() * 3000) });
          openDeals.push(dealId);
        } else if (openDeals.length > 0) {
          const dealId = openDeals.splice(Math.floor(rand() * openDeals.length), 1)[0]!;
          if (op === 'release') await ctx.ledger.releaseHold({ dealId });
          else await ctx.ledger.capture({ dealId, buyerWalletId: buyer, providerWalletId: provider.id });
        }
      } catch (e) {
        if (!(e instanceof LedgerError && e.code === 'insufficient_funds')) throw e;
      }
      // иногда повторяем последнюю операцию тем же ключом
      if (rand() < 0.2 && openDeals.length > 0) {
        const dealId = pick(openDeals);
        const before = await ctx.ledger.getWallet(buyer);
        const replay = await ctx.ledger.hold({ walletId: buyer, dealId, amount: 999999 });
        expect(replay.replayed).toBe(true); // сумма из повterа игнорируется
        expect(await ctx.ledger.getWallet(buyer)).toMatchObject({ balance: before.balance, held: before.held });
      }
    }

    await expectWalletMatchesLedger(ctx.db, buyer);
    await expectWalletMatchesLedger(ctx.db, provider.id);

    const [{ count }] = (await ctx.db.execute(
      sql`SELECT count(*)::int AS count FROM ledger_entries`,
    )).rows as [{ count: number }];
    expect(count).toBeGreaterThan(20);
    const ws = await ctx.db.select().from(wallets);
    for (const w of ws) {
      expect(w.balance).toBeGreaterThanOrEqual(0);
      expect(w.held).toBeGreaterThanOrEqual(0);
      expect(w.balance - w.held).toBeGreaterThanOrEqual(0);
    }
  });
});
