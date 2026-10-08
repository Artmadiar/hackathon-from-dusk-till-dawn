import { eq } from 'drizzle-orm';
import type { Clock, EventWriter } from '@fdtd/shared';
import type { Db, Tx } from '../db/client.js';
import { isUniqueViolation } from '../db/client.js';
import { ledgerEntries, wallets, type LedgerEntry } from '../db/schema.js';
import { LedgerError } from '../ledger/errors.js';
import { idempotencyKeys } from '../ledger/ledger.js';
import type { PolicyRejectionCode, PolicyService } from './policy.js';

export type AcceptHoldResult =
  | { ok: true; entry: LedgerEntry; replayed: boolean }
  | { ok: false; code: PolicyRejectionCode; message: string };

export interface AcceptHoldInput {
  userId: string;
  walletId: string;
  dealId: string;
  amount: number;
  categories: string[];
  correlationId?: string;
}

/**
 * Ядро «политика + холд» для выполнения ВНУТРИ чужой транзакции
 * (DealService.accept оборачивает это вместе с переходом сделки).
 * Отказ не пишет в леджер (C03-C06).
 */
export async function acceptHoldCore(
  tx: Tx,
  deps: { policy: PolicyService; clock: Clock },
  input: AcceptHoldInput,
): Promise<AcceptHoldResult> {
  const key = idempotencyKeys.hold(input.dealId);

  const [existing] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, key));
  if (existing) return { ok: true, entry: existing, replayed: true };

  const [w] = await tx.select().from(wallets).where(eq(wallets.id, input.walletId)).for('update');
  if (!w) throw new LedgerError('wallet_not_found', `wallet ${input.walletId} not found`);

  const decision = await deps.policy.check(tx, { ...input, now: deps.clock.now() });
  if (!decision.ok) return { ok: false, code: decision.code, message: decision.message };

  if (w.balance - w.held < input.amount) {
    return { ok: false, code: 'insufficient_funds',
      message: `available ${w.balance - w.held} < amount ${input.amount}` };
  }

  const [entry] = await tx.insert(ledgerEntries).values({
    walletId: input.walletId,
    type: 'HOLD',
    amount: input.amount,
    dealId: input.dealId,
    idempotencyKey: key,
    createdAt: deps.clock.now(),
  }).returning();
  await tx.update(wallets).set({ held: w.held + input.amount }).where(eq(wallets.id, input.walletId));
  return { ok: true, entry: entry!, replayed: false };
}

/** accept = политика + холд в одной транзакции, с событиями (plan 2.2). */
export async function acceptHold(
  deps: { db: Db; policy: PolicyService; events: EventWriter; clock: Clock },
  input: AcceptHoldInput,
): Promise<AcceptHoldResult> {
  const { db, events, clock, policy } = deps;
  const key = idempotencyKeys.hold(input.dealId);

  const run = () => db.transaction((tx) => acceptHoldCore(tx, { policy, clock }, input));
  let res: AcceptHoldResult;
  try {
    res = await run();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    res = await run();
  }

  if (!res.ok) {
    await events.emit({
      kind: 'domain', actor: 'platform', type: 'REJECTED_BY_POLICY',
      dealId: input.dealId, userId: input.userId,
      payload: { code: res.code, message: res.message, amount: input.amount },
      correlationId: input.correlationId,
    });
  } else if (res.replayed) {
    await events.emit({
      kind: 'domain', actor: 'platform', type: 'IDEMPOTENT_REPLAY',
      dealId: input.dealId, payload: { idempotencyKey: key }, correlationId: input.correlationId,
    });
  } else {
    await events.emit({
      kind: 'domain', actor: 'platform', type: 'HOLD_PLACED',
      dealId: input.dealId, userId: input.userId,
      payload: { amount: input.amount, walletId: input.walletId, entryId: res.entry.id },
      correlationId: input.correlationId,
    });
  }
  return res;
}
