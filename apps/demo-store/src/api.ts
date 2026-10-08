import type { FastifyInstance } from 'fastify';
import { Catalog, StoreOrderRequest, type Category, type StoreProduct, type StoreWebhook } from '@fdtd/contracts';
import type { StoreContext } from './app.js';

/**
 * Публичный API магазина — ровно контракт онбординга (концепт 3.3):
 * GET /catalog · GET /products/{sku} · POST /orders · POST /orders/{id}/cancel.
 * Решение по заказу всегда приходит webhook'ом, ответ /orders — только 'pending'.
 */
export function registerApi(app: FastifyInstance, ctx: StoreContext): void {
  app.get('/catalog', async () => {
    const items = ctx.db.catalog().map((p) => ({
      sku: p.sku,
      title: p.title,
      description: p.description ?? undefined,
      unit: p.unit,
      price: p.price,
      category: (p.category ?? undefined) as Category | undefined,
    }));
    return Catalog.parse(items);
  });

  app.get<{ Params: { sku: string } }>('/products/:sku', async (req, reply) => {
    const p = ctx.db.product(req.params.sku);
    if (!p) return reply.code(404).send({ error: 'unknown_sku' });
    /* R1: при inventoryLag наружу смотрит ночной снимок, не живой склад */
    const product: StoreProduct = {
      sku: p.sku,
      title: p.title,
      price: p.price,
      stock: ctx.seed.inventoryLag ? p.snapshot_stock : p.stock,
    };
    return product;
  });

  app.post('/orders', async (req, reply) => {
    const parsed = StoreOrderRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const order = parsed.data;

    const id = ctx.idGen.next('ord');
    const createdAt = ctx.clock.now().toISOString();
    /* Резерв атомарный и по живому складу (B4, C23, R1) */
    const reserved = ctx.db.reserve(order.items);

    if (!reserved.ok) {
      ctx.db.insertOrder({
        id, buyerRef: order.buyerRef, deliveryAddress: order.deliveryAddress,
        status: 'rejected', reason: reserved.reason, createdAt,
      });
      void ctx.webhook.send({ storeOrderId: id, status: 'rejected', reason: reserved.reason });
    } else {
      ctx.db.insertOrder({
        id, buyerRef: order.buyerRef, deliveryAddress: order.deliveryAddress,
        status: 'pending', total: reserved.total, createdAt, lines: reserved.lines,
      });
      if (ctx.autoConfirm) confirmOrder(ctx, id);
    }

    return reply.code(201).send({ storeOrderId: id, status: 'pending' as const });
  });

  app.post<{ Params: { id: string } }>('/orders/:id/cancel', async (req, reply) => {
    const o = ctx.db.order(req.params.id);
    if (!o) return reply.code(404).send({ error: 'unknown_order' });
    /* Отмена pending/confirmed возвращает резерв; повтор и отмена rejected — noop (K4) */
    if (o.status === 'pending' || o.status === 'confirmed') {
      ctx.db.restock(o.id);
      ctx.db.setStatus(o.id, 'cancelled', 'cancelled_by_buyer');
    }
    return { storeOrderId: o.id, status: 'cancelled' as const };
  });
}

/** Подтверждение зарезервированного заказа: счёт, срок, трек → webhook confirmed. */
export function confirmOrder(ctx: StoreContext, orderId: string): void {
  const o = ctx.db.order(orderId);
  if (!o || o.status !== 'pending') return;
  const lines = ctx.db.orderLines(orderId);
  const invoiceNumber = `INV-${ctx.seed.id.toUpperCase()}-${ctx.db.orderCount()}`;
  const deliveryEta = ctx.nextEta(ctx.clock.now());
  const trackingNumber = ctx.idGen.next('trk').toUpperCase();
  ctx.db.setConfirmed(orderId, { invoiceNumber, deliveryEta, trackingNumber });
  const payload: StoreWebhook = {
    storeOrderId: orderId,
    status: 'confirmed',
    invoiceNumber,
    lines: lines.map((l) => ({ sku: l.sku, confirmedQuantity: l.qty })),
    confirmedTotal: o.total ?? 0,
    deliveryEta,
    trackingNumber,
  };
  void ctx.webhook.send(payload);
}

/** Ручной отказ по зарезервированному заказу: вернуть резерв → webhook rejected. */
export function rejectOrder(ctx: StoreContext, orderId: string, reason: string): void {
  const o = ctx.db.order(orderId);
  if (!o || o.status !== 'pending') return;
  ctx.db.restock(orderId);
  ctx.db.setStatus(orderId, 'rejected', reason);
  void ctx.webhook.send({ storeOrderId: orderId, status: 'rejected', reason });
}
