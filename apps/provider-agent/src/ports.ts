import type {
  Catalog, CatalogItem, Proof, StoreOrderRequest, StoreOrderResponse, StoreProduct,
} from '@fdtd/contracts';
import type { NewEvent } from '@fdtd/shared';

/** K6: коннектор магазина — ровно контракт онбординга (концепт 3.3). */
export interface StoreClient {
  catalog(): Promise<Catalog>;
  product(sku: string): Promise<StoreProduct | undefined>;
  placeOrder(req: StoreOrderRequest): Promise<StoreOrderResponse>;
  cancelOrder(storeOrderId: string): Promise<void>;
}

/** K5: что исполнитель умеет сказать площадке. HTTP-реализация — S7. */
export interface PlatformPort {
  orderPlaced(dealId: string, storeOrderRef: string): Promise<void>;
  submitProof(dealId: string, proof: Proof): Promise<void>;
  withdrawOffer(dealId: string, reason: string): Promise<void>;
  event(e: NewEvent): Promise<void>;
}

export type CatalogSnapshot = CatalogItem[];
