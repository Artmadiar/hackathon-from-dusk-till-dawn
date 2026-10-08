import { and, eq } from 'drizzle-orm';
import { validateProof, type Proof, type Quote, type Req, type Violation } from '@fdtd/contracts';
import type { Clock, EventWriter, IdGen, NewEvent } from '@fdtd/shared';
import type { Db, Tx } from '../db/client.js';
import { isUniqueViolation } from '../db/client.js';
import {
  deals, tasks, wallets,
  type Deal, type DealStatus, type Task, type TaskStatus,
} from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.js';
import { acceptHoldCore } from '../policy/accept-hold.js';
import type { PolicyRejectionCode, PolicyService } from '../policy/policy.js';
import { RATING_DELTA, RegistryService } from '../registry/registry.js';

/** Платформа зовёт агентов (B1): fulfil/cancel исполнителю (K2/K4), run заказчику. */
export interface AgentGateway {
  sendFulfil(input: { dealId: string; taskId: string; providerId: string; agentUrl: string; quote: Quote; request: Req }): Promise<void>;
  sendCancel(input: { dealId: string; providerId: string; agentUrl: string; reason: string }): Promise<void>;
  runBuyer(input: { taskId: string; reason: string }): Promise<void>;
}

export class DealTransitionError extends Error {
  constructor(readonly dealId: string, readonly from: DealStatus, readonly action: string) {
    super(`deal ${dealId}: "${action}" is not allowed from ${from}`);
    this.name = 'DealTransitionError';
  }
}

/** Таблица переходов 3.5 — единственное место, где они разрешены. */
export const DEAL_TRANSITIONS: Record<DealStatus, readonly DealStatus[]> = {
  QUOTED: ['HELD', 'REJECTED_BY_POLICY', 'CANCELLED'],
  HELD: ['ORDER_PLACED', 'CANCELLED'],
  ORDER_PLACED: ['PROOF_RECEIVED', 'CANCELLED'],
  PROOF_RECEIVED: ['SETTLED', 'CANCELLED'],
  SETTLED: [],
  REJECTED_BY_POLICY: [],
  CANCELLED: [],
};

export type AcceptDealResult =
  | { ok: true; deal: Deal; replayed: boolean }
  | { ok: false; code: PolicyRejectionCode | 'quote_expired'; message: string };

export type SubmitProofResult =
  | { settled: true; deal: Deal }
  | { settled: false; deal: Deal; violations: Violation[] };

interface Deps {
  db: Db;
  events: EventWriter;
  clock: Clock;
  idGen: IdGen;
  policy: PolicyService;
  registry: RegistryService;
  gateway: AgentGateway;
}

export class DealService {
  constructor(private readonly deps: Deps) {}

  // ── tasks ──────────────────────────────────────────────────────────

  async createTask(input: { userId: string; request: Req; createdVia?: 'ui' | 'mcp' }): Promise<Task> {
    const { db, clock, idGen } = this.deps;
    const now = clock.now();
    const [task] = await db.insert(tasks).values({
      id: idGen.next('task'),
      userId: input.userId,
      contractTypeId: 'office-supplies.v1',
      request: input.request,
      status: 'OPEN',
      createdVia: input.createdVia ?? 'ui',
      createdAt: now,
      updatedAt: now,
    }).returning();
    await this.emit({
      type: 'TASK_CREATED', taskId: task!.id, userId: input.userId,
      payload: { createdVia: task!.createdVia, categories: input.request.categories },
    });
    return task!;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [t] = await this.deps.db.select().from(tasks).where(eq(tasks.id, id));
    return t;
  }

  async setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.deps.db.update(tasks)
      .set({ status, updatedAt: this.deps.clock.now() })
      .where(eq(tasks.id, taskId));
  }

  async failTask(taskId: string, reason: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    await this.deps.db.update(tasks)
      .set({ status: 'FAILED', failReason: reason, updatedAt: this.deps.clock.now() })
      .where(eq(tasks.id, taskId));
    await this.emit({ type: 'TASK_FAILED', taskId, userId: task.userId, payload: { reason } });
  }

  async excludeProvider(taskId: string, providerId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    if (task.excludedProviderIds.includes(providerId)) return;
    await this.deps.db.update(tasks)
      .set({ excludedProviderIds: [...task.excludedProviderIds, providerId], updatedAt: this.deps.clock.now() })
      .where(eq(tasks.id, taskId));
  }

  // ── deals ──────────────────────────────────────────────────────────

  async createDeal(input: { taskId: string; providerId: string; quote: Quote }): Promise<Deal> {
    const { db, clock, idGen } = this.deps;
    const task = await this.getTask(input.taskId);
    if (!task) throw new Error(`task ${input.taskId} not found`);
    const now = clock.now();
    const [deal] = await db.insert(deals).values({
      id: idGen.next('deal'),
      taskId: input.taskId,
      providerId: input.providerId,
      status: 'QUOTED',
      quote: input.quote,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await this.emit({
      type: 'DEAL_QUOTED', taskId: input.taskId, dealId: deal!.id,
      providerId: input.providerId, userId: task.userId,
      payload: { total: input.quote.total, deliveryEta: input.quote.deliveryEta },
    });
    return deal!;
  }

  async getDeal(id: string): Promise<Deal | undefined> {
    const [d] = await this.deps.db.select().from(deals).where(eq(deals.id, id));
    return d;
  }

  /** C07/C17: accept = политика + холд + переход в одной транзакции; повтор — replay. */
  async accept(dealId: string, opts: { correlationId?: string } = {}): Promise<AcceptDealResult> {
    const { db, clock, policy, events } = this.deps;

    const run = () => db.transaction(async (tx): Promise<
      | { kind: 'ok'; deal: Deal; task: Task; amount: number; walletId: string; entryId: number; replayed: boolean }
      | { kind: 'expired'; deal: Deal }
      | { kind: 'rejected'; deal: Deal; task: Task; code: PolicyRejectionCode; message: string }
    > => {
      const deal = await this.lockDeal(tx, dealId);
      if (deal.status === 'HELD') {
        // повторный accept после успешного — replay без побочных эффектов
        const task = (await tx.select().from(tasks).where(eq(tasks.id, deal.taskId)))[0]!;
        return { kind: 'ok', deal, task, amount: deal.quote.total, walletId: '', entryId: 0, replayed: true };
      }
      this.assertTransition(deal, 'HELD', 'accept');
      const task = (await tx.select().from(tasks).where(eq(tasks.id, deal.taskId)))[0];
      if (!task) throw new Error(`task ${deal.taskId} not found`);

      if (new Date(deal.quote.validUntil).getTime() <= clock.now().getTime()) {
        return { kind: 'expired', deal };
      }

      const [wallet] = await tx.select().from(wallets)
        .where(and(eq(wallets.ownerType, 'user'), eq(wallets.ownerId, task.userId)));
      if (!wallet) throw new Error(`no wallet for user ${task.userId}`);

      const hold = await acceptHoldCore(tx, { policy, clock }, {
        userId: task.userId, walletId: wallet.id, dealId,
        amount: deal.quote.total, categories: task.request.categories,
      });
      if (!hold.ok) {
        const updated = await this.updateDealTx(tx, dealId, { status: 'REJECTED_BY_POLICY', cancelReason: hold.code });
        return { kind: 'rejected', deal: updated, task, code: hold.code, message: hold.message };
      }
      const updated = await this.updateDealTx(tx, dealId, { status: 'HELD' });
      await tx.update(tasks).set({ status: 'ORDERED', updatedAt: clock.now() }).where(eq(tasks.id, task.id));
      return {
        kind: 'ok', deal: updated, task, amount: hold.entry.amount,
        walletId: hold.entry.walletId, entryId: hold.entry.id, replayed: hold.replayed,
      };
    });

    let res: Awaited<ReturnType<typeof run>>;
    try {
      res = await run();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      res = await run();
    }

    if (res.kind === 'expired') {
      return { ok: false, code: 'quote_expired', message: `quote expired at ${res.deal.quote.validUntil}` };
    }
    if (res.kind === 'rejected') {
      await this.emit({
        type: 'REJECTED_BY_POLICY', taskId: res.task.id, dealId, userId: res.task.userId,
        providerId: res.deal.providerId,
        payload: { code: res.code, message: res.message, amount: res.deal.quote.total },
        correlationId: opts.correlationId,
      });
      return { ok: false, code: res.code, message: res.message };
    }

    if (res.replayed) {
      await this.emit({
        type: 'IDEMPOTENT_REPLAY', taskId: res.task.id, dealId,
        payload: { action: 'accept' }, correlationId: opts.correlationId,
      });
      return { ok: true, deal: res.deal, replayed: true };
    }

    await this.emit({
      type: 'DEAL_ACCEPTED', taskId: res.task.id, dealId, providerId: res.deal.providerId,
      userId: res.task.userId, payload: { amount: res.amount }, correlationId: opts.correlationId,
    });
    await this.emit({
      type: 'HOLD_PLACED', taskId: res.task.id, dealId, userId: res.task.userId,
      payload: { amount: res.amount, walletId: res.walletId, entryId: res.entryId },
      correlationId: opts.correlationId,
    });

    // сделка дальше едет сама: исполнителю уходит fulfil (B1)
    const provider = await this.deps.registry.get(res.deal.providerId);
    if (provider) {
      try {
        await this.deps.gateway.sendFulfil({
          dealId, taskId: res.task.id, providerId: provider.id, agentUrl: provider.agentUrl,
          quote: res.deal.quote, request: res.task.request,
        });
      } catch {
        // доставка fulfil — ответственность диспетчера/ретраев; сделка останется в HELD до таймаута исполнителя
      }
    }
    return { ok: true, deal: res.deal, replayed: false };
  }

  /** Исполнитель разместил заказ в магазине (K5 сторона придёт в S5; здесь переход). */
  async markOrderPlaced(dealId: string, opts: { storeOrderRef?: string; correlationId?: string } = {}): Promise<Deal> {
    const { db } = this.deps;
    const { deal, task } = await db.transaction(async (tx) => {
      const d = await this.lockDeal(tx, dealId);
      this.assertTransition(d, 'ORDER_PLACED', 'markOrderPlaced');
      const updated = await this.updateDealTx(tx, dealId, { status: 'ORDER_PLACED' });
      const t = (await tx.select().from(tasks).where(eq(tasks.id, d.taskId)))[0]!;
      return { deal: updated, task: t };
    });
    await this.emit({
      type: 'ORDER_PLACED', taskId: deal.taskId, dealId, providerId: deal.providerId,
      userId: task.userId, payload: { storeOrderRef: opts.storeOrderRef ?? null },
      correlationId: opts.correlationId,
    });
    return deal;
  }

  /**
   * Webhook магазина дошёл до исполнителя, тот собрал Proof.
   * validateProof ок -> CAPTURE + SETTLED (+рейтинг +0.05); fail -> CANCELLED + release
   * + cancel исполнителю (K4) + рейтинг -0.5 + задача обратно в DECIDING (C21).
   */
  async submitProof(dealId: string, proof: Proof, opts: { correlationId?: string } = {}): Promise<SubmitProofResult> {
    const { db, clock } = this.deps;

    const res = await db.transaction(async (tx) => {
      const deal = await this.lockDeal(tx, dealId);
      this.assertTransition(deal, 'PROOF_RECEIVED', 'submitProof');
      const task = (await tx.select().from(tasks).where(eq(tasks.id, deal.taskId)))[0]!;
      const violations = validateProof(deal.quote, proof);
      const ledger = this.txLedger(tx);

      if (violations.length === 0) {
        const [buyerWallet] = await tx.select().from(wallets)
          .where(and(eq(wallets.ownerType, 'user'), eq(wallets.ownerId, task.userId)));
        const providerWallet = await ledger.createWallet({ ownerType: 'provider', ownerId: deal.providerId });
        const cap = await ledger.capture({
          dealId, buyerWalletId: buyerWallet!.id, providerWalletId: providerWallet.id,
        });
        const updated = await this.updateDealTx(tx, dealId, { status: 'SETTLED', proof });
        await tx.update(tasks).set({ status: 'DONE', updatedAt: clock.now() }).where(eq(tasks.id, task.id));
        return { settled: true as const, deal: updated, task, amount: cap.amount };
      }

      await ledger.releaseHold({ dealId });
      const updated = await this.updateDealTx(tx, dealId, {
        status: 'CANCELLED', proof, cancelReason: 'proof_rejected',
      });
      await tx.update(tasks).set({ status: 'DECIDING', updatedAt: clock.now() }).where(eq(tasks.id, task.id));
      return { settled: false as const, deal: updated, task, violations };
    });

    const base = {
      taskId: res.deal.taskId, dealId, providerId: res.deal.providerId,
      userId: res.task.userId, correlationId: opts.correlationId,
    };
    await this.emit({ ...base, type: 'PROOF_RECEIVED', payload: { storeOrderId: proof.storeOrderId } });

    if (res.settled) {
      await this.emit({ ...base, type: 'CAPTURE', payload: { amount: res.amount } });
      await this.emit({ ...base, type: 'DEAL_SETTLED', payload: { amount: res.amount } });
      await this.deps.registry.changeRating(res.deal.providerId, RATING_DELTA.settled, 'deal_settled',
        { dealId, taskId: res.deal.taskId });
      await this.emit({ ...base, type: 'TASK_DONE', payload: {} });
      return { settled: true, deal: res.deal };
    }

    await this.emit({ ...base, type: 'HOLD_RELEASE', payload: { amount: res.deal.quote.total } });
    await this.emit({
      ...base, type: 'DEAL_CANCELLED',
      payload: { reason: 'proof_rejected', violations: res.violations },
    });
    await this.deps.registry.changeRating(res.deal.providerId, RATING_DELTA.cancelledProviderFault,
      'proof_rejected', { dealId, taskId: res.deal.taskId });
    await this.excludeProvider(res.deal.taskId, res.deal.providerId);
    await this.notifyCancelAndRerun(res.deal, 'proof_rejected');
    return { settled: false, deal: res.deal, violations: res.violations };
  }

  /**
   * Исполнитель отзывает оферту (C19/C20): магазин rejected или молчит.
   * Холд снят, OFFER_WITHDRAWN, рейтинг -0.3, задача обратно в DECIDING, заказчику /run.
   */
  async withdrawOffer(dealId: string, reason: string, opts: { correlationId?: string } = {}): Promise<Deal> {
    const { db, clock } = this.deps;
    const res = await db.transaction(async (tx) => {
      const deal = await this.lockDeal(tx, dealId);
      this.assertTransition(deal, 'CANCELLED', 'withdrawOffer');
      const task = (await tx.select().from(tasks).where(eq(tasks.id, deal.taskId)))[0]!;
      let released = 0;
      if (deal.status === 'HELD' || deal.status === 'ORDER_PLACED') {
        const rel = await this.txLedger(tx).releaseHold({ dealId });
        released = rel.entry.amount;
      }
      const updated = await this.updateDealTx(tx, dealId, { status: 'CANCELLED', cancelReason: reason });
      await tx.update(tasks).set({ status: 'DECIDING', updatedAt: clock.now() }).where(eq(tasks.id, task.id));
      return { deal: updated, task, released };
    });

    const base = {
      taskId: res.deal.taskId, dealId, providerId: res.deal.providerId,
      userId: res.task.userId, correlationId: opts.correlationId,
    };
    if (res.released > 0) await this.emit({ ...base, type: 'HOLD_RELEASE', payload: { amount: res.released } });
    await this.emit({ ...base, type: 'OFFER_WITHDRAWN', payload: { reason } });
    await this.deps.registry.changeRating(res.deal.providerId, RATING_DELTA.offerWithdrawn,
      `offer_withdrawn:${reason}`, { dealId, taskId: res.deal.taskId });
    await this.excludeProvider(res.deal.taskId, res.deal.providerId);
    try {
      await this.deps.gateway.runBuyer({ taskId: res.deal.taskId, reason: 'offer_withdrawn' });
    } catch { /* заказчик перечитает состояние на следующем шаге (R7) */ }
    return res.deal;
  }

  // ── internals ──────────────────────────────────────────────────────

  private async notifyCancelAndRerun(deal: Deal, reason: string): Promise<void> {
    const provider = await this.deps.registry.get(deal.providerId);
    if (provider) {
      try {
        await this.deps.gateway.sendCancel({
          dealId: deal.id, providerId: provider.id, agentUrl: provider.agentUrl, reason,
        });
      } catch { /* не дошло — DISPUTED в P1 (C25) */ }
    }
    try {
      await this.deps.gateway.runBuyer({ taskId: deal.taskId, reason });
    } catch { /* R7 */ }
  }

  private txLedger(tx: Tx): LedgerService {
    // события эмитим сами после коммита — внутрь отдаём глушилку
    const silent = { emit: async (e: NewEvent) => ({ ...e, id: 0, ts: '' }) };
    return new LedgerService(tx as unknown as Db, silent, this.deps.clock);
  }

  private async lockDeal(tx: Tx, dealId: string): Promise<Deal> {
    const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for('update');
    if (!d) throw new Error(`deal ${dealId} not found`);
    return d;
  }

  private assertTransition(deal: Deal, to: DealStatus, action: string): void {
    if (!DEAL_TRANSITIONS[deal.status].includes(to)) {
      throw new DealTransitionError(deal.id, deal.status, action);
    }
  }

  private async updateDealTx(tx: Tx, dealId: string, set: Partial<Deal>): Promise<Deal> {
    const [d] = await tx.update(deals)
      .set({ ...set, updatedAt: this.deps.clock.now() })
      .where(eq(deals.id, dealId)).returning();
    return d!;
  }

  private async emit(e: Omit<NewEvent, 'kind' | 'actor'>): Promise<void> {
    await this.deps.events.emit({ kind: 'domain', actor: 'platform', ...e });
  }
}
