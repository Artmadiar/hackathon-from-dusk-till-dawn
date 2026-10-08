import { Proof, StoreWebhook, type Quote, type Req } from '@fdtd/contracts';
import { verifyWebhook, type Clock, type IdGen } from '@fdtd/shared';
import type { AgentRules } from './config.js';
import type { PlatformPort, StoreClient } from './ports.js';
import { DealBook } from './state.js';

export interface FulfilDeps {
  providerId: string;
  rules: AgentRules;
  store: StoreClient;
  platform: PlatformPort;
  clock: Clock;
  idGen: IdGen;
  book: DealBook;
  webhookSecret: string;
  log?: { warn: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void };
}

const eventBase = (deps: FulfilDeps, dealId: string, correlationId?: string, runId?: string) => ({
  actor: `provider-agent:${deps.providerId}`,
  dealId,
  providerId: deps.providerId,
  correlationId,
  runId,
});

/**
 * C11: /fulfil -> place_order в магазин -> WAITING {until} -> ждём webhook.
 * Таймаут держит исполнитель (B1): не дождались -> withdraw_offer(timeout)
 * + cancel_order в магазин на всякий случай (C20).
 */
export async function startFulfil(
  deps: FulfilDeps,
  input: { dealId: string; taskId: string; quote: Quote; request: Req; correlationId?: string },
): Promise<void> {
  const runId = deps.idGen.next('run');
  const base = { kind: 'agent' as const, taskId: input.taskId, ...eventBase(deps, input.dealId, input.correlationId, runId) };
  try {
    const order = await deps.store.placeOrder({
      items: input.quote.lines.map((l) => ({ sku: l.sku, qty: l.quantity })),
      deliveryAddress: input.request.deliveryAddress,
      buyerRef: deps.idGen.next('ref'), // непрозрачный: магазин не знает про dealId (B13)
    });
    const timer = setTimeout(() => { void onStoreTimeout(deps, input.dealId); }, deps.rules.storeTimeoutMs);
    timer.unref?.();
    deps.book.add({
      dealId: input.dealId,
      runId,
      storeOrderId: order.storeOrderId,
      quote: input.quote,
      orderedLines: input.quote.lines.map((l) => ({ sku: l.sku, qty: l.quantity })),
      phase: 'placed',
      timer,
    });
    await deps.platform.orderPlaced(input.dealId, order.storeOrderId);
    const until = new Date(deps.clock.now().getTime() + deps.rules.storeTimeoutMs).toISOString();
    await deps.platform.event({ ...base, type: 'WAITING', payload: { for: 'store_webhook', storeOrderId: order.storeOrderId, until } });
  } catch (err) {
    deps.log?.error({ dealId: input.dealId, err: String(err) }, 'place_order failed');
    await deps.platform.event({ ...base, type: 'STEP_FAILED', payload: { step: 'place_order', error: String(err) } });
    await deps.platform.withdrawOffer(input.dealId, 'store_unreachable');
  }
}

async function onStoreTimeout(deps: FulfilDeps, dealId: string): Promise<void> {
  const state = deps.book.byDealId(dealId);
  if (!state || state.phase !== 'placed') return;
  deps.book.finish(dealId, 'withdrawn');
  await deps.platform.event({
    kind: 'agent', type: 'DECISION', ...eventBase(deps, dealId, undefined, state.runId),
    payload: { step: 'store_webhook', decision: 'withdraw_offer', reason: 'timeout' },
  });
  await deps.platform.withdrawOffer(dealId, 'timeout');
  /* магазин мог зарезервировать и молчать — отменяем на всякий случай (C20) */
  await deps.store.cancelOrder(state.storeOrderId).catch((err) =>
    deps.log?.warn({ dealId, err: String(err) }, 'cancel_order after timeout failed'));
}

export type WebhookOutcome = { code: number; body: Record<string, unknown> };

/** Повторы nonce отбивает получатель (C24); память ограничена. */
export class NonceGuard {
  private readonly seen = new Set<string>();
  constructor(private readonly max = 10_000) {}
  firstUse(nonce: string): boolean {
    if (this.seen.has(nonce)) return false;
    if (this.seen.size >= this.max) this.seen.clear();
    this.seen.add(nonce);
    return true;
  }
}

/**
 * K7 приёмник: подпись -> nonce -> схема -> связь storeOrderId <-> deal ->
 * дедуп (C08) -> confirmed: свой валидатор + submit_proof | rejected: withdraw (C19).
 */
export async function handleStoreWebhook(
  deps: FulfilDeps & { nonces: NonceGuard },
  rawBody: string,
  signatureHeader: string | undefined,
  correlationId?: string,
): Promise<WebhookOutcome> {
  const rejected = async (code: number, reason: string, dealId = ''): Promise<WebhookOutcome> => {
    await deps.platform.event({
      kind: 'domain', type: 'WEBHOOK_REJECTED', ...eventBase(deps, dealId, correlationId),
      payload: { reason },
    });
    return { code, body: { error: reason } };
  };

  const sig = verifyWebhook(rawBody, signatureHeader, deps.webhookSecret, { clock: deps.clock });
  if (!sig.ok) return rejected(401, sig.reason);
  if (!deps.nonces.firstUse(sig.nonce)) return rejected(401, 'nonce_replayed');

  let payload: StoreWebhook;
  try {
    payload = StoreWebhook.parse(JSON.parse(rawBody));
  } catch {
    return rejected(400, 'malformed_payload');
  }

  const state = deps.book.byStoreOrderId(payload.storeOrderId);
  if (!state) return rejected(404, 'unknown_store_order');
  /* C08: повтор по storeOrderId -> ничего */
  if (state.phase !== 'placed') return { code: 200, body: { ok: true, duplicate: true } };

  const base = { kind: 'agent' as const, ...eventBase(deps, state.dealId, correlationId, state.runId) };

  if (payload.status === 'rejected') {
    deps.book.finish(state.dealId, 'withdrawn');
    await deps.platform.event({ ...base, type: 'DECISION', payload: { step: 'store_webhook', decision: 'withdraw_offer', reason: payload.reason } });
    await deps.platform.withdrawOffer(state.dealId, payload.reason); // C19
    return { code: 200, body: { ok: true } };
  }

  /* свой валидатор (концепт 3.4): подтверждение соответствует размещённому заказу.
     Сумму и срок не сверяем — это validateProof платформы (C21). */
  const confirmed = new Map(payload.lines.map((l) => [l.sku, l.confirmedQuantity]));
  const mismatch = state.orderedLines.find((l) => (confirmed.get(l.sku) ?? 0) < l.qty);
  if (mismatch) {
    deps.book.finish(state.dealId, 'withdrawn');
    await deps.platform.event({ ...base, type: 'DECISION', payload: { step: 'store_webhook', decision: 'withdraw_offer', reason: `confirmation_mismatch:${mismatch.sku}` } });
    await deps.platform.withdrawOffer(state.dealId, `confirmation_mismatch:${mismatch.sku}`);
    await deps.store.cancelOrder(state.storeOrderId).catch((err) =>
      deps.log?.warn({ dealId: state.dealId, err: String(err) }, 'cancel_order after mismatch failed'));
    return { code: 200, body: { ok: true } };
  }

  const proof = Proof.parse({
    storeOrderId: payload.storeOrderId,
    invoiceNumber: payload.invoiceNumber,
    lines: payload.lines,
    confirmedTotal: payload.confirmedTotal,
    deliveryEta: payload.deliveryEta,
    ...(payload.trackingNumber ? { trackingNumber: payload.trackingNumber } : {}),
  });
  deps.book.finish(state.dealId, 'proof_submitted');
  await deps.platform.event({ ...base, type: 'DECISION', payload: { step: 'store_webhook', decision: 'submit_proof', storeOrderId: payload.storeOrderId } });
  await deps.platform.submitProof(state.dealId, proof);
  return { code: 200, body: { ok: true } };
}

/** K4: отмена со стороны площадки/заказчика — отменить заказ в магазине, закрыть связь. */
export async function cancelDeal(deps: FulfilDeps, dealId: string, reason: string): Promise<void> {
  const state = deps.book.byDealId(dealId);
  if (!state || state.phase === 'cancelled' || state.phase === 'withdrawn') return;
  deps.book.finish(dealId, 'cancelled');
  await deps.store.cancelOrder(state.storeOrderId).catch((err) =>
    deps.log?.warn({ dealId, err: String(err) }, 'cancel_order failed'));
  await deps.platform.event({
    kind: 'agent', type: 'TOOL_RESULT', ...eventBase(deps, dealId, undefined, state.runId),
    payload: { tool: 'cancel_order', storeOrderId: state.storeOrderId, reason },
  });
}
