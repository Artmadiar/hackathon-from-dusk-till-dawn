import { fixedClock, seqIdGen } from '@fdtd/shared';
import { createStore, type CreateStoreOpts } from '../src/app.js';
import { StoreSeed } from '../src/seed.js';

process.env.LOG_LEVEL ??= 'silent';

export const SECRET = 'test-webhook-secret';
export const NOW = '2026-10-08T12:00:00Z'; // четверг

/** Фейковый приёмник webhook: очередь статусов ответа, по умолчанию 200. */
export function fakeReceiver(statuses: Array<number | 'network_error'> = []) {
  const received: Array<{ raw: string; body: Record<string, unknown>; signature: string | undefined }> = [];
  const queue = [...statuses];
  let attempts = 0;
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    attempts++;
    const next = queue.shift() ?? 200;
    if (next === 'network_error') throw new Error('ECONNREFUSED');
    const raw = String(init?.body);
    received.push({
      raw,
      body: JSON.parse(raw) as Record<string, unknown>,
      signature: (init?.headers as Record<string, string>)['x-store-signature'],
    });
    return new Response(next >= 400 ? 'err' : 'ok', { status: next });
  }) as typeof fetch;
  return { received, fetchFn, attempts: () => attempts };
}

export const testSeed = (over: Partial<StoreSeed> = {}): StoreSeed =>
  StoreSeed.parse({
    id: 'test',
    name: 'Testovací obchod',
    delivery: { type: 'leadDays', days: 2 },
    products: [
      { sku: 'A4', title: 'Papír A4', unit: 'pack', price: 500, category: 'paper', stock: 5 },
      { sku: 'PEN', title: 'Pero modré', unit: 'pcs', price: 100, category: 'writing', stock: 1 },
    ],
    ...over,
  });

export function makeStore(over: Partial<CreateStoreOpts> & { statuses?: Array<number | 'network_error'> } = {}) {
  const receiver = fakeReceiver(over.statuses);
  const { statuses: _statuses, ...rest } = over;
  const store = createStore({
    seed: testSeed(),
    clock: fixedClock(NOW),
    idGen: seqIdGen(),
    webhook: { url: 'http://agent.test/hooks/store', secret: SECRET, backoffMs: [5, 10], fetchFn: receiver.fetchFn },
    ...rest,
  });
  return { ...store, receiver };
}

export async function placeOrder(
  app: ReturnType<typeof makeStore>['app'],
  items: Array<{ sku: string; qty: number }>,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: { items, deliveryAddress: 'Praha 7, Dukelských hrdinů 21', buyerRef: 'ref-1' },
  });
  return { status: res.statusCode, body: res.json() as { storeOrderId: string; status: string } };
}
