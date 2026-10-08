import { z } from 'zod';
import { Category } from './categories.js';
import { Cents, PositiveInt } from './money.js';
import { ProofLine } from './office-supplies.v1.js';

const IsoDateTime = z.iso.datetime({ offset: true });

/** GET {apiUrl}/catalog (концепт 3.3) */
export const CatalogItem = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().min(1),
  price: Cents,
  category: Category.optional(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;
export const Catalog = z.array(CatalogItem);
export type Catalog = z.infer<typeof Catalog>;

/** GET {apiUrl}/products/{sku} — живая цена и остаток (B15) */
export const StoreProduct = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  price: Cents,
  stock: z.number().int().nonnegative(),
});
export type StoreProduct = z.infer<typeof StoreProduct>;

/** POST {orderUrl} */
export const StoreOrderRequest = z.object({
  items: z.array(z.object({ sku: z.string().min(1), qty: PositiveInt })).min(1),
  deliveryAddress: z.string().min(1),
  buyerRef: z.string().min(1), // непрозрачный идентификатор, магазин не знает про dealId (B13)
});
export type StoreOrderRequest = z.infer<typeof StoreOrderRequest>;

export const StoreOrderResponse = z.object({
  storeOrderId: z.string().min(1),
  status: z.literal('pending'),
});
export type StoreOrderResponse = z.infer<typeof StoreOrderResponse>;

/** POST {providerAgentUrl}/hooks/store — единственный webhook магазина (K7) */
export const StoreWebhook = z.discriminatedUnion('status', [
  z.object({
    storeOrderId: z.string().min(1),
    status: z.literal('confirmed'),
    invoiceNumber: z.string().min(1),
    lines: z.array(ProofLine).min(1),
    confirmedTotal: Cents,
    deliveryEta: IsoDateTime,
    trackingNumber: z.string().optional(),
  }),
  z.object({
    storeOrderId: z.string().min(1),
    status: z.literal('rejected'),
    reason: z.string().min(1),
  }),
]);
export type StoreWebhook = z.infer<typeof StoreWebhook>;
