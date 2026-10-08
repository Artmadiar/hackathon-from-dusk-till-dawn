import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Seed-файл экземпляра магазина (концепт 3.3): один код, четыре магазина.
 * Магазин ничего не знает про площадку — категории тут только ради каталога.
 */
export const SeedProduct = z.object({
  sku: z.string().regex(/^[A-Z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().min(1),
  price: z.number().int().positive(),
  category: z.enum(['paper', 'writing', 'water', 'office']).optional(),
  stock: z.number().int().nonnegative(),
  /** Ночной снимок склада (R1); по умолчанию равен живому остатку. */
  snapshotStock: z.number().int().nonnegative().optional(),
  emoji: z.string().optional(),
});
export type SeedProduct = z.infer<typeof SeedProduct>;

export const Delivery = z.discriminatedUnion('type', [
  /** Доставка по дням недели (ISO: 1=пн … 7=вс), например вода вт/чт. */
  z.object({ type: z.literal('weekdays'), days: z.array(z.number().int().min(1).max(7)).min(1) }),
  /** Доставка через N дней. */
  z.object({ type: z.literal('leadDays'), days: z.number().int().nonnegative() }),
]);
export type Delivery = z.infer<typeof Delivery>;

export const StoreSeed = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().optional(),
  /** R1: GET /products отдаёт снимок, резерв идёт по живому складу. */
  inventoryLag: z.boolean().default(false),
  /** Успешный резерв сразу подтверждается webhook'ом; false — ждёт кнопки в дашборде. */
  autoConfirm: z.boolean().default(true),
  delivery: Delivery,
  products: z.array(SeedProduct).min(1),
});
export type StoreSeed = z.infer<typeof StoreSeed>;

export function loadSeed(path: string): StoreSeed {
  return StoreSeed.parse(JSON.parse(readFileSync(path, 'utf8')));
}
