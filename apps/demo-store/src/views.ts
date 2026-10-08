import type { FastifyInstance } from 'fastify';
import type { OrderRow, ProductRow } from './db.js';
import type { StoreContext } from './app.js';
import { confirmOrder, rejectOrder } from './api.js';

/**
 * Лендинг и мини-дашборд магазина — server-rendered HTML без сборки (plan 3.1):
 * «это не мы, это магазин». Дашборд: заказы, остатки, кнопки
 * подтвердить / отклонить / продать офлайн (R1, видео).
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 860px; padding: 24px 16px; }
  h1 { font-size: 26px; margin: 0 0 4px; } .tagline { opacity: .7; margin: 0 0 24px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 28px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
  th { font-size: 12px; text-transform: uppercase; opacity: .6; }
  .num { text-align: right; } .emoji { font-size: 22px; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
  .pending { background: #e8a90022; color: #b58900; } .confirmed { background: #2aa19822; color: #2aa198; }
  .rejected { background: #dc322f22; color: #dc322f; } .cancelled { background: #6c71c422; color: #6c71c4; }
  form { display: inline; } button { cursor: pointer; }
  nav a { margin-right: 12px; }
  .lag { font-size: 12px; opacity: .65; }
</style></head><body>${body}</body></html>`;
}

function productsTable(ctx: StoreContext, products: ProductRow[], withActions: boolean): string {
  const lag = ctx.seed.inventoryLag;
  const rows = products.map((p) => `
    <tr>
      <td class="emoji">${esc(p.emoji ?? '📦')}</td>
      <td><b>${esc(p.title)}</b><br><span class="lag">${esc(p.sku)}${p.description ? ' · ' + esc(p.description) : ''}</span></td>
      <td>${esc(p.category ?? '—')}</td>
      <td class="num">${money(p.price)} / ${esc(p.unit)}</td>
      <td class="num">${p.stock}${lag ? ` <span class="lag">(снимок: ${p.snapshot_stock})</span>` : ''}</td>
      ${withActions ? `<td><form method="post" action="/dashboard/products/${encodeURIComponent(p.sku)}/sell-offline"><button>продать офлайн</button></form></td>` : ''}
    </tr>`).join('');
  return `<table><tr><th></th><th>товар</th><th>категория</th><th class="num">цена</th><th class="num">остаток${lag ? ' (живой)' : ''}</th>${withActions ? '<th></th>' : ''}</tr>${rows}</table>`;
}

function ordersTable(ctx: StoreContext, orders: OrderRow[]): string {
  if (orders.length === 0) return '<p class="lag">Заказов пока нет.</p>';
  const rows = orders.map((o) => {
    const lines = ctx.db.orderLines(o.id).map((l) => `${l.sku}×${l.qty}`).join(', ');
    const actions = o.status === 'pending'
      ? `<form method="post" action="/dashboard/orders/${encodeURIComponent(o.id)}/confirm"><button>подтвердить</button></form>
         <form method="post" action="/dashboard/orders/${encodeURIComponent(o.id)}/reject"><button>отклонить</button></form>`
      : '';
    return `<tr>
      <td><span class="lag">${esc(o.id)}</span></td>
      <td>${esc(lines || '—')}</td>
      <td class="num">${o.total != null ? money(o.total) : '—'}</td>
      <td><span class="badge ${o.status}">${o.status}</span>${o.reason ? ` <span class="lag">${esc(o.reason)}</span>` : ''}</td>
      <td class="lag">${esc(o.invoice_number ?? '')}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  return `<table><tr><th>заказ</th><th>позиции</th><th class="num">сумма</th><th>статус</th><th>счёт</th><th></th></tr>${rows}</table>`;
}

export function registerViews(app: FastifyInstance, ctx: StoreContext): void {
  app.get('/', async (_req, reply) => {
    const body = `
      <h1>${esc(ctx.seed.name)}</h1>
      <p class="tagline">${esc(ctx.seed.tagline ?? '')}</p>
      <nav><a href="/dashboard">дашборд магазина</a> <a href="/catalog">каталог (JSON)</a></nav>
      ${productsTable(ctx, ctx.db.catalog(), false)}`;
    return reply.type('text/html').send(page(ctx.seed.name, body));
  });

  app.get('/dashboard', async (_req, reply) => {
    const body = `
      <h1>${esc(ctx.seed.name)} — дашборд</h1>
      <p class="tagline">${ctx.seed.inventoryLag ? 'Склад с отставанием: наружу отдаётся ночной снимок, резерв идёт по живому остатку.' : 'Склад без отставания.'}</p>
      <nav><a href="/">лендинг</a></nav>
      <h2>Заказы</h2>${ordersTable(ctx, ctx.db.orders())}
      <h2>Остатки</h2>${productsTable(ctx, ctx.db.catalog(), true)}`;
    return reply.type('text/html').send(page(`${ctx.seed.name} — дашборд`, body));
  });

  app.post<{ Params: { id: string } }>('/dashboard/orders/:id/confirm', async (req, reply) => {
    confirmOrder(ctx, req.params.id);
    return reply.redirect('/dashboard', 303);
  });

  app.post<{ Params: { id: string } }>('/dashboard/orders/:id/reject', async (req, reply) => {
    rejectOrder(ctx, req.params.id, 'rejected_by_store');
    return reply.redirect('/dashboard', 303);
  });

  app.post<{ Params: { sku: string } }>('/dashboard/products/:sku/sell-offline', async (req, reply) => {
    ctx.db.sellOffline(req.params.sku);
    return reply.redirect('/dashboard', 303);
  });
}
