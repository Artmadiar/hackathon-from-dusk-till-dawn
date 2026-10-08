import type { Quote } from '@fdtd/contracts';

/**
 * Активные сделки исполнителя: связь dealId <-> storeOrderId, строки заказа,
 * таймер ожидания webhook (C20). In-memory — агент без своей БД, при смерти
 * агента страховочный таймер платформы ×2 (B1, P1).
 */
export type DealPhase = 'placed' | 'proof_submitted' | 'withdrawn' | 'cancelled';

export interface DealState {
  dealId: string;
  storeOrderId: string;
  quote: Quote;
  orderedLines: Array<{ sku: string; qty: number }>;
  phase: DealPhase;
  timer?: NodeJS.Timeout;
}

export class DealBook {
  private readonly byDeal = new Map<string, DealState>();
  private readonly byStoreOrder = new Map<string, string>();

  add(state: DealState): void {
    this.byDeal.set(state.dealId, state);
    this.byStoreOrder.set(state.storeOrderId, state.dealId);
  }

  byDealId(dealId: string): DealState | undefined {
    return this.byDeal.get(dealId);
  }

  byStoreOrderId(storeOrderId: string): DealState | undefined {
    const dealId = this.byStoreOrder.get(storeOrderId);
    return dealId ? this.byDeal.get(dealId) : undefined;
  }

  /** Терминальная фаза: гасим таймер; связь оставляем для дедупа повторных webhook (C08). */
  finish(dealId: string, phase: Exclude<DealPhase, 'placed'>): void {
    const s = this.byDeal.get(dealId);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = undefined;
    s.phase = phase;
  }
}
