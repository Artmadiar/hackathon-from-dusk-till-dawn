import {
  Catalog, StoreOrderResponse, StoreProduct,
  type StoreOrderRequest,
} from '@fdtd/contracts';
import type { StoreClient } from './ports.js';

/** HTTP-коннектор к живому магазину (B15): цена и остаток всегда свежие. */
export function httpStoreClient(storeUrl: string, fetchImpl: typeof fetch = fetch): StoreClient {
  const base = storeUrl.replace(/\/$/, '');
  return {
    async catalog() {
      const res = await fetchImpl(`${base}/catalog`);
      if (!res.ok) throw new Error(`store catalog: http ${res.status}`);
      return Catalog.parse(await res.json());
    },
    async product(sku) {
      const res = await fetchImpl(`${base}/products/${encodeURIComponent(sku)}`);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`store product ${sku}: http ${res.status}`);
      return StoreProduct.parse(await res.json());
    },
    async placeOrder(req: StoreOrderRequest) {
      const res = await fetchImpl(`${base}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(`store order: http ${res.status}`);
      return StoreOrderResponse.parse(await res.json());
    },
    async cancelOrder(storeOrderId) {
      const res = await fetchImpl(`${base}/orders/${encodeURIComponent(storeOrderId)}/cancel`, { method: 'POST' });
      if (!res.ok && res.status !== 404) throw new Error(`store cancel ${storeOrderId}: http ${res.status}`);
    },
  };
}
