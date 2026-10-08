import {
  Catalog, StoreOrderRequest, StoreOrderResponse, StoreProduct,
  type Proof, type Req,
} from '@fdtd/contracts';
import {
  FakeLlm, fixedClock, seqIdGen, signJwt, signWebhook,
  type FakeLlmRule, type NewEvent,
} from '@fdtd/shared';
import { AgentRules } from '../src/config.js';
import { createProviderAgent, type ProviderAgentDeps } from '../src/app.js';
import type { PlatformPort, StoreClient } from '../src/ports.js';

process.env.LOG_LEVEL ??= 'silent';

export const NOW = '2026-10-08T12:00:00Z'; // четверг
export const JWT_SECRET = 'test-jwt-secret';
export const WEBHOOK_SECRET = 'test-webhook-secret';
export const PROVIDER_ID = 'papirna';

/** K6-фейк из тех же Zod-схем, что и реальный магазин (plan 1.5). */
export class FakeStore implements StoreClient {
  readonly orders: StoreOrderRequest[] = [];
  readonly cancelled: string[] = [];
  private seq = 0;

  constructor(
    public products: Array<{ sku: string; title: string; unit: string; price: number; livePrice?: number; stock: number; category?: 'paper' | 'writing' | 'water' | 'office' }>,
  ) {}

  async catalog() {
    return Catalog.parse(this.products.map((p) => ({
      sku: p.sku, title: p.title, unit: p.unit, price: p.price, category: p.category,
    })));
  }

  async product(sku: string) {
    const p = this.products.find((x) => x.sku === sku);
    if (!p) return undefined;
    return StoreProduct.parse({ sku: p.sku, title: p.title, price: p.livePrice ?? p.price, stock: p.stock });
  }

  async placeOrder(req: StoreOrderRequest) {
    this.orders.push(StoreOrderRequest.parse(req));
    return StoreOrderResponse.parse({ storeOrderId: `so-${++this.seq}`, status: 'pending' });
  }

  async cancelOrder(storeOrderId: string) {
    this.cancelled.push(storeOrderId);
  }
}

/** K5-фейк: записывает всё, что агент говорит площадке. */
export class FakePlatform implements PlatformPort {
  readonly placed: Array<{ dealId: string; storeOrderRef: string }> = [];
  readonly proofs: Array<{ dealId: string; proof: Proof }> = [];
  readonly withdrawals: Array<{ dealId: string; reason: string }> = [];
  readonly events: NewEvent[] = [];

  async orderPlaced(dealId: string, storeOrderRef: string) { this.placed.push({ dealId, storeOrderRef }); }
  async submitProof(dealId: string, proof: Proof) { this.proofs.push({ dealId, proof }); }
  async withdrawOffer(dealId: string, reason: string) { this.withdrawals.push({ dealId, reason }); }
  async event(e: NewEvent) { this.events.push(e); }
}

export const CATALOG = [
  { sku: 'A4', title: 'Kancelářský papír A4', unit: 'pack', price: 500, livePrice: 510, stock: 10, category: 'paper' as const },
  { sku: 'PEN', title: 'Modré kuličkové pero', unit: 'pcs', price: 100, stock: 5, category: 'writing' as const },
];

export const baseReq = (over: Partial<Req> = {}): Req => ({
  items: [
    { itemQuery: 'бумага A4 80г', quantity: 2, unit: 'pack', category: 'paper' },
    { itemQuery: 'синие ручки', quantity: 5, unit: 'pcs', category: 'writing' },
  ],
  categories: ['paper', 'writing'],
  budget: { max: 10_000, source: 'user' },
  deadline: '2026-10-20T00:00:00Z',
  deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
  ...over,
});

/** Правило FakeLlm на базовый запрос: обе позиции найдены. */
export const pickBoth: FakeLlmRule = {
  when: 'бумага a4',
  toolUses: [{
    name: 'select_products',
    input: { selections: [{ itemIndex: 0, sku: 'A4' }, { itemIndex: 1, sku: 'PEN' }] },
  }],
};

export function makeAgent(over: {
  rules?: Partial<AgentRules>;
  store?: FakeStore;
  llmRules?: FakeLlmRule[];
  deps?: Partial<ProviderAgentDeps>;
} = {}) {
  const store = over.store ?? new FakeStore(structuredClone(CATALOG));
  const platform = new FakePlatform();
  const rules = AgentRules.parse({
    schedule: { type: 'leadDays', days: 2 },
    markupPct: 15,
    minOrderTotal: 1000,
    storeTimeoutMs: 100, // plan 1.4
    ...over.rules,
  });
  const { app, book } = createProviderAgent({
    providerId: PROVIDER_ID,
    rules,
    llm: new FakeLlm(over.llmRules ?? [pickBoth]),
    store,
    platform,
    clock: fixedClock(NOW),
    idGen: seqIdGen(),
    jwtSecret: JWT_SECRET,
    webhookSecret: WEBHOOK_SECRET,
    ...over.deps,
  });
  return { app, book, store, platform, rules };
}

export const authHeader = (): Record<string, string> => ({
  authorization: `Bearer ${signJwt({}, JWT_SECRET, {
    iss: 'platform', aud: 'provider-agent', expiresInSec: 60, clock: fixedClock(NOW),
  })}`,
});

export function signedWebhook(payload: unknown, opts: { secret?: string; atIso?: string; nonce?: string } = {}) {
  const body = JSON.stringify(payload);
  const signature = signWebhook(body, opts.secret ?? WEBHOOK_SECRET, {
    clock: fixedClock(opts.atIso ?? NOW),
    ...(opts.nonce ? { nonce: opts.nonce } : {}),
  });
  return { body, signature };
}

export async function fulfil(app: ReturnType<typeof makeAgent>['app'], over: Record<string, unknown> = {}) {
  const quote = {
    lines: [
      { itemIndex: 0, sku: 'A4', title: 'Kancelářský papír A4', unitPrice: 587, quantity: 2, lineTotal: 1174 },
      { itemIndex: 1, sku: 'PEN', title: 'Modré kuličkové pero', unitPrice: 115, quantity: 5, lineTotal: 575 },
    ],
    total: 1749,
    deliveryEta: '2026-10-10T15:00:00.000Z',
    validUntil: '2026-10-08T13:00:00.000Z',
  };
  const res = await app.inject({
    method: 'POST', url: '/fulfil', headers: authHeader(),
    payload: { dealId: 'deal-1', taskId: 'task-1', quote, request: baseReq(), ...over },
  });
  return { res, quote };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
