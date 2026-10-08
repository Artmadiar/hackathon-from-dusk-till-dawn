import { sql } from 'drizzle-orm';
import { MemoryEventWriter, fixedClock, type Clock } from '@fdtd/shared';
import { createDb, type Db } from '../src/db/client.js';
import { ledgerEntries, wallets } from '../src/db/schema.js';
import { LedgerService, ledgerEffect } from '../src/ledger/ledger.js';
import { PolicyService } from '../src/policy/policy.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:3386/platform_test';

export const NOW = '2026-10-08T12:00:00Z';

/** Мутируемые часы: тесты двигают время (C04/C05 через границу дня). */
export function testClock(start: string = NOW): Clock & { set(iso: string): void } {
  let current = fixedClock(start);
  return {
    now: () => current.now(),
    set(iso: string) { current = fixedClock(iso); },
  };
}

export interface TestContext {
  db: Db;
  events: MemoryEventWriter;
  clock: ReturnType<typeof testClock>;
  ledger: LedgerService;
  policy: PolicyService;
  close(): Promise<void>;
}

export function createTestContext(): TestContext {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  const clock = testClock();
  const events = new MemoryEventWriter(clock);
  return {
    db, events, clock,
    ledger: new LedgerService(db, events, clock),
    policy: new PolicyService(db),
    close: () => pool.end(),
  };
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE events, deals, tasks, providers, ledger_entries, wallets, spending_policies RESTART IDENTITY CASCADE`);
}

/** Инвариант C10: материализованные balance/held = сумме леджера. */
export async function expectWalletMatchesLedger(db: Db, walletId: string): Promise<void> {
  const [w] = await db.select().from(wallets).where(sql`${wallets.id} = ${walletId}`);
  const entries = await db.select().from(ledgerEntries).where(sql`${ledgerEntries.walletId} = ${walletId}`);
  let balance = 0;
  let held = 0;
  for (const e of entries) {
    const eff = ledgerEffect(e.type, e.amount);
    balance += eff.balance;
    held += eff.held;
  }
  if (w!.balance !== balance || w!.held !== held) {
    throw new Error(
      `wallet ${walletId} drifted from ledger: materialized balance=${w!.balance} held=${w!.held}, ledger balance=${balance} held=${held}`,
    );
  }
}
