import Database from 'better-sqlite3';
import type { StoreSeed } from './seed.js';

/**
 * SQLite магазина: товары с живым остатком и снимком (R1), заказы, строки заказов.
 * better-sqlite3 синхронный — транзакция резерва атомарна по построению (B4).
 */

export type OrderStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface ProductRow {
  sku: string;
  title: string;
  description: string | null;
  unit: string;
  price: number;
  category: string | null;
  emoji: string | null;
  stock: number;
  snapshot_stock: number;
}

export interface OrderRow {
  id: string;
  buyer_ref: string;
  delivery_address: string;
  status: OrderStatus;
  reason: string | null;
  invoice_number: string | null;
  delivery_eta: string | null;
  tracking_number: string | null;
  total: number | null;
  created_at: string;
}

export interface OrderLineRow {
  order_id: string;
  sku: string;
  qty: number;
  unit_price: number;
}

export type ReserveResult =
  | { ok: true; lines: Array<{ sku: string; qty: number; unitPrice: number }>; total: number }
  | { ok: false; reason: string };

export class StoreDb {
  readonly db: Database.Database;

  constructor(file = ':memory:') {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        sku TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        unit TEXT NOT NULL,
        price INTEGER NOT NULL,
        category TEXT,
        emoji TEXT,
        stock INTEGER NOT NULL CHECK (stock >= 0),
        snapshot_stock INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        buyer_ref TEXT NOT NULL,
        delivery_address TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        invoice_number TEXT,
        delivery_eta TEXT,
        tracking_number TEXT,
        total INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS order_lines (
        order_id TEXT NOT NULL REFERENCES orders(id),
        sku TEXT NOT NULL,
        qty INTEGER NOT NULL,
        unit_price INTEGER NOT NULL
      );
    `);
  }

  applySeed(seed: StoreSeed): void {
    const upsert = this.db.prepare(`
      INSERT INTO products (sku, title, description, unit, price, category, emoji, stock, snapshot_stock)
      VALUES (@sku, @title, @description, @unit, @price, @category, @emoji, @stock, @snapshot)
      ON CONFLICT(sku) DO UPDATE SET
        title=@title, description=@description, unit=@unit, price=@price,
        category=@category, emoji=@emoji, stock=@stock, snapshot_stock=@snapshot
    `);
    const all = this.db.transaction(() => {
      for (const p of seed.products) {
        upsert.run({
          sku: p.sku, title: p.title, description: p.description ?? null, unit: p.unit,
          price: p.price, category: p.category ?? null, emoji: p.emoji ?? null,
          stock: p.stock, snapshot: p.snapshotStock ?? p.stock,
        });
      }
    });
    all();
  }

  catalog(): ProductRow[] {
    return this.db.prepare('SELECT * FROM products ORDER BY sku').all() as ProductRow[];
  }

  product(sku: string): ProductRow | undefined {
    return this.db.prepare('SELECT * FROM products WHERE sku = ?').get(sku) as ProductRow | undefined;
  }

  /**
   * Атомарный резерв: весь заказ или ничего (B4, C23). Проверки и списание
   * в одной транзакции, по живому складу — независимо от inventoryLag (R1).
   */
  reserve(items: Array<{ sku: string; qty: number }>): ReserveResult {
    const txn = this.db.transaction((): ReserveResult => {
      const lines: Array<{ sku: string; qty: number; unitPrice: number }> = [];
      for (const { sku, qty } of items) {
        const p = this.product(sku);
        if (!p) return { ok: false, reason: `unknown_sku:${sku}` };
        if (p.stock < qty) return { ok: false, reason: 'out_of_stock' };
        lines.push({ sku, qty, unitPrice: p.price });
      }
      for (const { sku, qty } of items) {
        this.db.prepare('UPDATE products SET stock = stock - ? WHERE sku = ?').run(qty, sku);
      }
      return { ok: true, lines, total: lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) };
    });
    return txn();
  }

  insertOrder(o: {
    id: string; buyerRef: string; deliveryAddress: string; status: OrderStatus;
    reason?: string; total?: number; createdAt: string;
    lines?: Array<{ sku: string; qty: number; unitPrice: number }>;
  }): void {
    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO orders (id, buyer_ref, delivery_address, status, reason, total, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(o.id, o.buyerRef, o.deliveryAddress, o.status, o.reason ?? null, o.total ?? null, o.createdAt);
      for (const l of o.lines ?? []) {
        this.db.prepare('INSERT INTO order_lines (order_id, sku, qty, unit_price) VALUES (?, ?, ?, ?)')
          .run(o.id, l.sku, l.qty, l.unitPrice);
      }
    });
    txn();
  }

  order(id: string): OrderRow | undefined {
    return this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  }

  orders(): OrderRow[] {
    return this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC, id DESC').all() as OrderRow[];
  }

  orderLines(orderId: string): OrderLineRow[] {
    return this.db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(orderId) as OrderLineRow[];
  }

  setConfirmed(id: string, c: { invoiceNumber: string; deliveryEta: string; trackingNumber: string }): void {
    this.db.prepare(`
      UPDATE orders SET status='confirmed', invoice_number=?, delivery_eta=?, tracking_number=? WHERE id=?
    `).run(c.invoiceNumber, c.deliveryEta, c.trackingNumber, id);
  }

  setStatus(id: string, status: OrderStatus, reason?: string): void {
    this.db.prepare('UPDATE orders SET status=?, reason=? WHERE id=?').run(status, reason ?? null, id);
  }

  /** Вернуть резерв на склад (отмена / ручной отказ по зарезервированному заказу). */
  restock(orderId: string): void {
    const txn = this.db.transaction(() => {
      for (const l of this.orderLines(orderId)) {
        this.db.prepare('UPDATE products SET stock = stock + ? WHERE sku = ?').run(l.qty, l.sku);
      }
    });
    txn();
  }

  /** «Продать офлайн» (R1): трогает только живой склад, снимок не меняется. */
  sellOffline(sku: string, qty = 1): boolean {
    const r = this.db.prepare('UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?')
      .run(qty, sku, qty);
    return r.changes > 0;
  }

  orderCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}
