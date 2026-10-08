import { and, eq } from 'drizzle-orm';
import type { Clock, EventWriter, NewEvent } from '@fdtd/shared';
import type { Db, Tx } from '../db/client.js';
import { isUniqueViolation } from '../db/client.js';
import {
  ledgerEntries, wallets,
  type LedgerEntry, type LedgerEntryType, type Wallet,
} from '../db/schema.js';
import { LedgerError } from './errors.js';

/**
 * Эффект записи леджера на материализованные balance/held.
 * capture пишет HOLD_RELEASE + CAPTURE_OUT, поэтому CAPTURE_OUT трогает только balance,
 * а дневной лимит (B6) считается как HOLD + CAPTURE_OUT - HOLD_RELEASE без двойного счёта.
 */
export function ledgerEffect(type: LedgerEntryType, amount: number): { balance: number; held: number } {
  switch (type) {
    case 'DEPOSIT': return { balance: amount, held: 0 };
    case 'HOLD': return { balance: 0, held: amount };
    case 'HOLD_RELEASE': return { balance: 0, held: -amount };
    case 'CAPTURE_OUT': return { balance: -amount, held: 0 };
    case 'CAPTURE_IN': return { balance: amount, held: 0 };
    case 'REFUND': return { balance: amount, held: 0 };
  }
}

/** Детерминированные ключи идемпотентности (концепт 3.1). */
export const idempotencyKeys = {
  hold: (dealId: string) => `hold:${dealId}`,
  release: (dealId: string) => `release:${dealId}`,
  captureRelease: (dealId: string) => `capture:${dealId}:release`,
  captureOut: (dealId: string) => `capture:${dealId}:out`,
  captureIn: (dealId: string) => `capture:${dealId}:in`,
  depositStripe: (eventId: string) => `deposit:stripe:${eventId}`,
};

export interface OpResult {
  entry: LedgerEntry;
  replayed: boolean;
}

export class LedgerService {
  constructor(
    private readonly db: Db,
    private readonly events: EventWriter,
    private readonly clock: Clock,
  ) {}

  async createWallet(input: { ownerType: Wallet['ownerType']; ownerId: string }): Promise<Wallet> {
    const [w] = await this.db.insert(wallets).values(input).onConflictDoNothing().returning();
    if (w) return w;
    const [existing] = await this.db.select().from(wallets)
      .where(and(eq(wallets.ownerType, input.ownerType), eq(wallets.ownerId, input.ownerId)));
    return existing!;
  }

  async getWallet(id: string): Promise<Wallet> {
    const [w] = await this.db.select().from(wallets).where(eq(wallets.id, id));
    if (!w) throw new LedgerError('wallet_not_found', `wallet ${id} not found`);
    return w;
  }

  async deposit(input: {
    walletId: string;
    amount: number;
    idempotencyKey: string;
    simulated?: boolean;
    correlationId?: string;
  }): Promise<OpResult> {
    const res = await this.withReplay(input.idempotencyKey, input.correlationId, (tx) =>
      this.applyEntry(tx, {
        walletId: input.walletId,
        type: 'DEPOSIT',
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    if (!res.replayed) {
      await this.emit({
        type: 'DEPOSIT',
        walletId: input.walletId,
        payload: { amount: input.amount, simulated: input.simulated ?? false, entryId: res.entry.id },
        correlationId: input.correlationId,
      });
    }
    return res;
  }

  /** C07: повтор по dealId возвращает тот же HOLD. Нехватка available -> LedgerError. */
  async hold(input: { walletId: string; dealId: string; amount: number; correlationId?: string }): Promise<OpResult> {
    const key = idempotencyKeys.hold(input.dealId);
    const res = await this.withReplay(key, input.correlationId, (tx) =>
      this.applyEntry(tx, {
        walletId: input.walletId,
        type: 'HOLD',
        amount: input.amount,
        dealId: input.dealId,
        idempotencyKey: key,
      }),
    );
    if (!res.replayed) {
      await this.emit({
        type: 'HOLD_PLACED',
        walletId: input.walletId,
        dealId: input.dealId,
        payload: { amount: input.amount, entryId: res.entry.id },
        correlationId: input.correlationId,
      });
    }
    return res;
  }

  /** Снятие холда при отзыве оферты / отмене сделки. Сумму берёт из записи HOLD. */
  async releaseHold(input: { dealId: string; correlationId?: string }): Promise<OpResult> {
    const key = idempotencyKeys.release(input.dealId);
    const res = await this.withReplay(key, input.correlationId, async (tx) => {
      const holdEntry = await this.findEntry(tx, idempotencyKeys.hold(input.dealId));
      if (!holdEntry) throw new LedgerError('hold_not_found', `no hold for deal ${input.dealId}`);
      return this.applyEntry(tx, {
        walletId: holdEntry.walletId,
        type: 'HOLD_RELEASE',
        amount: holdEntry.amount,
        dealId: input.dealId,
        idempotencyKey: key,
      });
    });
    if (!res.replayed) {
      await this.emit({
        type: 'HOLD_RELEASE',
        walletId: res.entry.walletId,
        dealId: input.dealId,
        payload: { amount: res.entry.amount, entryId: res.entry.id },
        correlationId: input.correlationId,
      });
    }
    return res;
  }

  /**
   * Расчёт: у покупателя HOLD_RELEASE + CAPTURE_OUT, исполнителю CAPTURE_IN.
   * Одна транзакция, кошельки лочатся в детерминированном порядке.
   */
  async capture(input: {
    dealId: string;
    buyerWalletId: string;
    providerWalletId: string;
    correlationId?: string;
  }): Promise<{ out: LedgerEntry; in: LedgerEntry; amount: number; replayed: boolean }> {
    const outKey = idempotencyKeys.captureOut(input.dealId);

    const run = async () => this.db.transaction(async (tx) => {
      const existing = await this.findEntry(tx, outKey);
      if (existing) {
        const inEntry = await this.findEntry(tx, idempotencyKeys.captureIn(input.dealId));
        return { out: existing, in: inEntry!, amount: existing.amount, replayed: true };
      }
      const holdEntry = await this.findEntry(tx, idempotencyKeys.hold(input.dealId));
      if (!holdEntry) throw new LedgerError('hold_not_found', `no hold for deal ${input.dealId}`);
      const amount = holdEntry.amount;

      // лочим оба кошелька в порядке id — без дедлоков
      for (const id of [input.buyerWalletId, input.providerWalletId].sort()) {
        await this.lockWallet(tx, id);
      }
      const release = await this.applyEntry(tx, {
        walletId: input.buyerWalletId, type: 'HOLD_RELEASE', amount,
        dealId: input.dealId, idempotencyKey: idempotencyKeys.captureRelease(input.dealId),
      }, { locked: true });
      const out = await this.applyEntry(tx, {
        walletId: input.buyerWalletId, type: 'CAPTURE_OUT', amount,
        dealId: input.dealId, idempotencyKey: outKey,
      }, { locked: true });
      const inn = await this.applyEntry(tx, {
        walletId: input.providerWalletId, type: 'CAPTURE_IN', amount,
        dealId: input.dealId, idempotencyKey: idempotencyKeys.captureIn(input.dealId),
      }, { locked: true });
      void release;
      return { out: out.entry, in: inn.entry, amount, replayed: false };
    });

    let res: Awaited<ReturnType<typeof run>>;
    try {
      res = await run();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      res = await run(); // параллельный двойник успел первым — вернётся replay
    }

    if (res.replayed) {
      await this.emitReplay(outKey, input.correlationId);
    } else {
      await this.emit({
        type: 'CAPTURE',
        walletId: input.buyerWalletId,
        dealId: input.dealId,
        payload: {
          amount: res.amount,
          buyerWalletId: input.buyerWalletId,
          providerWalletId: input.providerWalletId,
        },
        correlationId: input.correlationId,
      });
    }
    return res;
  }

  /** Повтор любой операции с тем же ключом: та же запись + IDEMPOTENT_REPLAY (C02, C07, C08). */
  private async withReplay(
    key: string,
    correlationId: string | undefined,
    fn: (tx: Tx) => Promise<OpResult>,
  ): Promise<OpResult> {
    const run = () => this.db.transaction(async (tx) => {
      const existing = await this.findEntry(tx, key);
      if (existing) return { entry: existing, replayed: true };
      return fn(tx);
    });
    let res: OpResult;
    try {
      res = await run();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      res = await run();
    }
    if (res.replayed) await this.emitReplay(key, correlationId);
    return res;
  }

  private async findEntry(tx: Tx, key: string): Promise<LedgerEntry | undefined> {
    const [e] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, key));
    return e;
  }

  private async lockWallet(tx: Tx, walletId: string): Promise<Wallet> {
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, walletId)).for('update');
    if (!w) throw new LedgerError('wallet_not_found', `wallet ${walletId} not found`);
    return w;
  }

  /** Вставка записи + обновление материализованных balance/held под локом кошелька. */
  private async applyEntry(
    tx: Tx,
    input: { walletId: string; type: LedgerEntryType; amount: number; dealId?: string; idempotencyKey: string },
    opts: { locked?: boolean } = {},
  ): Promise<OpResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new Error(`amount must be a positive integer (cents), got ${input.amount}`);
    }
    const w = opts.locked
      ? (await tx.select().from(wallets).where(eq(wallets.id, input.walletId)))[0]
      : await this.lockWallet(tx, input.walletId);
    if (!w) throw new LedgerError('wallet_not_found', `wallet ${input.walletId} not found`);

    const effect = ledgerEffect(input.type, input.amount);
    const balance = w.balance + effect.balance;
    const held = w.held + effect.held;
    if (balance < 0 || held < 0 || balance - held < 0) {
      throw new LedgerError('insufficient_funds',
        `wallet ${input.walletId}: ${input.type} ${input.amount} -> balance ${balance}, held ${held}`);
    }

    const [entry] = await tx.insert(ledgerEntries).values({
      walletId: input.walletId,
      type: input.type,
      amount: input.amount,
      dealId: input.dealId,
      idempotencyKey: input.idempotencyKey,
      createdAt: this.clock.now(),
    }).returning();
    await tx.update(wallets).set({ balance, held }).where(eq(wallets.id, input.walletId));
    return { entry: entry!, replayed: false };
  }

  private async emit(e: Omit<NewEvent, 'kind' | 'actor'> & { walletId?: string }): Promise<void> {
    const { walletId, ...rest } = e;
    await this.events.emit({
      kind: 'domain',
      actor: 'platform',
      ...rest,
      payload: { ...(rest.payload as Record<string, unknown> ?? {}), ...(walletId ? { walletId } : {}) },
    });
  }

  private async emitReplay(key: string, correlationId?: string): Promise<void> {
    await this.events.emit({
      kind: 'domain',
      actor: 'platform',
      type: 'IDEMPOTENT_REPLAY',
      payload: { idempotencyKey: key },
      correlationId,
    });
  }
}
