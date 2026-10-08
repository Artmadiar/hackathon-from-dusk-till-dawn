import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Catalog, StoreProduct } from '@fdtd/contracts';
import { loadSeed } from '../src/seed.js';
import { makeStore } from './helpers.js';

const seedPath = (n: string) => fileURLToPath(new URL(`../seeds/${n}.json`, import.meta.url));
const SEEDS = ['aqua', 'papirna', 'kancelar', 'levny'] as const;

const stores = SEEDS.map((n) => makeStore({ seed: loadSeed(seedPath(n)) }));
afterAll(async () => { for (const s of stores) await s.app.close(); });

describe('K6: контракт каталога', () => {
  it('GET /catalog всех четырёх магазинов проходит схему Catalog', async () => {
    for (const s of stores) {
      const res = await s.app.inject({ method: 'GET', url: '/catalog' });
      expect(res.statusCode).toBe(200);
      expect(() => Catalog.parse(res.json())).not.toThrow();
    }
  });

  it('четыре магазина отдают разные каталоги (DoD S4)', async () => {
    const skuSets = await Promise.all(stores.map(async (s) => {
      const res = await s.app.inject({ method: 'GET', url: '/catalog' });
      return new Set((res.json() as Array<{ sku: string }>).map((p) => p.sku));
    }));
    for (let i = 0; i < skuSets.length; i++) {
      for (let j = i + 1; j < skuSets.length; j++) {
        expect([...skuSets[i]].filter((sku) => skuSets[j].has(sku))).toEqual([]);
      }
    }
  });

  it('GET /products/{sku} отдаёт живую цену и остаток по схеме; 404 на неизвестный', async () => {
    const kancelar = stores[2];
    const res = await kancelar.app.inject({ method: 'GET', url: '/products/KAN-A4-500' });
    const p = StoreProduct.parse(res.json());
    expect(p).toMatchObject({ sku: 'KAN-A4-500', price: 800, stock: 60 });
    const missing = await kancelar.app.inject({ method: 'GET', url: '/products/NOPE' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('R1: inventoryLag у papirna', () => {
  it('/products отдаёт снимок, резерв идёт по живому складу', async () => {
    const { app, receiver } = makeStore({ seed: loadSeed(seedPath('papirna')) });
    // наружу — ночной снимок
    const before = await app.inject({ method: 'GET', url: '/products/PAP-A4-500' });
    expect((before.json() as { stock: number }).stock).toBe(5);
    // заказ на 4 пачки: живой склад 2 → rejected, не частичное
    await app.inject({
      method: 'POST', url: '/orders',
      payload: { items: [{ sku: 'PAP-A4-500', qty: 4 }], deliveryAddress: 'Praha', buyerRef: 'r1' },
    });
    await expect.poll(() => receiver.received.length).toBe(1);
    expect(receiver.received[0].body).toMatchObject({ status: 'rejected', reason: 'out_of_stock' });
    // наружу всё ещё снимок
    const after = await app.inject({ method: 'GET', url: '/products/PAP-A4-500' });
    expect((after.json() as { stock: number }).stock).toBe(5);
    await app.close();
  });

  it('«продать офлайн» меняет только живой остаток, снимок не трогает', async () => {
    const { app, ctx } = makeStore({ seed: loadSeed(seedPath('papirna')) });
    await app.inject({ method: 'POST', url: '/dashboard/products/PAP-A4-500/sell-offline' });
    const row = ctx.db.product('PAP-A4-500');
    expect(row).toMatchObject({ stock: 1, snapshot_stock: 5 });
    const outside = await app.inject({ method: 'GET', url: '/products/PAP-A4-500' });
    expect((outside.json() as { stock: number }).stock).toBe(5);
    await app.close();
  });

  it('магазин без inventoryLag отдаёт живой остаток', async () => {
    const { app } = makeStore(); // testSeed: inventoryLag false, A4 stock 5
    await app.inject({ method: 'POST', url: '/dashboard/products/A4/sell-offline' });
    const res = await app.inject({ method: 'GET', url: '/products/A4' });
    expect((res.json() as { stock: number }).stock).toBe(4);
    await app.close();
  });
});
