import type { FastifyInstance } from 'fastify';
import type { OrderRow, ProductRow } from './db.js';
import type { StoreContext } from './app.js';
import { confirmOrder, rejectOrder } from './api.js';

/**
 * Лендинг и бэк-офис магазина — server-rendered HTML без сборки (plan 3.1):
 * «это не мы, это магазин». Витрина: карточки товаров. Бэк-офис: входящие
 * заказы с платформы (confirm / reject), склад с живым остатком и снимком,
 * «продать офлайн» (R1, видео). Автообновление 5s — заказы прилетают живьём.
 */

const ACCENTS: Record<string, string> = {
  papirna: '#4f6ef7', kancelar: '#8b5cf6', aqua: '#0ea5b7', levny: '#e8841a',
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const WEEKDAYS = ['?', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // ISO: 1=Mon … 7=Sun

function deliveryLabel(ctx: StoreContext): string {
  const d = ctx.seed.delivery;
  if (d.type === 'weekdays') return `🚚 Delivers ${d.days.map((n) => WEEKDAYS[n] ?? '?').join(' & ')}`;
  return d.days <= 1 ? '🚚 Next-day delivery' : `🚚 Ships in ${d.days} days`;
}

function page(ctx: StoreContext, active: 'store' | 'office', body: string): string {
  const accent = ACCENTS[ctx.seed.id] ?? '#64748b';
  const tab = (href: string, label: string, is: boolean) =>
    `<a href="${href}" class="tab${is ? ' active' : ''}">${label}</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ctx.seed.name)}${active === 'office' ? ' — Back office' : ''}</title>
<style>
  :root { color-scheme: light dark; --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, -apple-system, sans-serif; margin: 0;
         background: color-mix(in srgb, var(--accent) 4%, canvas); }
  .wrap { max-width: 980px; margin: 0 auto; padding: 20px 16px 48px; }
  header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .logo { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center;
          font-size: 28px; background: color-mix(in srgb, var(--accent) 18%, canvas);
          border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
  h1 { font-size: 24px; margin: 0; letter-spacing: -.01em; }
  .tagline { margin: 2px 0 0; font-size: 13px; opacity: .65; }
  .chip { margin-left: auto; font-size: 12.5px; padding: 6px 12px; border-radius: 999px;
          background: color-mix(in srgb, var(--accent) 12%, canvas);
          border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); white-space: nowrap; }
  nav { display: flex; gap: 6px; margin-bottom: 22px; }
  .tab { padding: 7px 16px; border-radius: 999px; text-decoration: none; color: inherit;
         font-size: 13.5px; border: 1px solid transparent; opacity: .7; }
  .tab:hover { opacity: 1; }
  .tab.active { background: var(--accent); color: #fff; opacity: 1; font-weight: 600; }
  h2 { font-size: 15px; margin: 26px 0 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; }
  .hint { font-size: 12.5px; opacity: .55; margin: -6px 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 12px; }
  .card { border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 14px;
          padding: 14px; background: canvas; display: flex; flex-direction: column; gap: 6px; }
  .card .emoji { font-size: 32px; line-height: 1; }
  .card .title { font-weight: 600; font-size: 14.5px; line-height: 1.3; }
  .card .desc { font-size: 12.5px; opacity: .6; flex: 1; }
  .card .foot { display: flex; align-items: baseline; justify-content: space-between; margin-top: 4px; }
  .price { font-weight: 700; font-size: 16px; }
  .unit { font-size: 11.5px; opacity: .55; font-weight: 400; }
  .badge { padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .ok { background: #16a34a22; color: #15803d; } .low { background: #e8a90026; color: #a16207; }
  .out { background: #dc262622; color: #b91c1c; }
  .pending { background: #e8a90026; color: #a16207; } .confirmed { background: #16a34a22; color: #15803d; }
  .rejected { background: #dc262622; color: #b91c1c; } .cancelled { background: #6c71c422; color: #6c71c4; }
  @media (prefers-color-scheme: dark) {
    .ok, .confirmed { color: #4ade80; } .low, .pending { color: #fbbf24; }
    .out, .rejected { color: #f87171; } .cancelled { color: #a5b4fc; }
  }
  table { border-collapse: collapse; width: 100%; margin: 0 0 8px; background: canvas;
          border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 14px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; vertical-align: top;
           border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
  tr:last-child td { border-bottom: none; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; opacity: .55; }
  .num { text-align: right; } .mono { font-family: ui-monospace, monospace; font-size: 11.5px; opacity: .6; }
  .sub { font-size: 12px; opacity: .6; }
  form { display: inline; }
  button { cursor: pointer; font: 600 12.5px system-ui; padding: 5px 12px; border-radius: 8px;
           border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: canvas; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  footer { margin-top: 36px; font-size: 12px; opacity: .5; text-align: center; }
</style>
<script>setTimeout(function(){location.reload()}, 5000)</script>
</head><body><div class="wrap">
<header>
  <div class="logo">${esc(ctx.seed.products[0]?.emoji ?? '🏬')}</div>
  <div><h1>${esc(ctx.seed.name)}</h1><p class="tagline">${esc(ctx.seed.tagline ?? '')}</p></div>
  <span class="chip">${deliveryLabel(ctx)}</span>
</header>
<nav>${tab('/', 'Storefront', active === 'store')}${tab('/dashboard', 'Back office', active === 'office')}</nav>
${body}
<footer>Independent demo store · orders arrive through the store’s public API · page auto-refreshes</footer>
</div></body></html>`;
}

function stockBadge(stock: number): string {
  if (stock <= 0) return '<span class="badge out">Out of stock</span>';
  if (stock <= 5) return `<span class="badge low">Low stock: ${stock}</span>`;
  return `<span class="badge ok">In stock: ${stock}</span>`;
}

function productCards(ctx: StoreContext, products: ProductRow[]): string {
  /* Витрина честная: при inventoryLag наружу смотрит снимок, как и в API (R1) */
  const cards = products.map((p) => {
    const shown = ctx.seed.inventoryLag ? p.snapshot_stock : p.stock;
    return `
    <div class="card">
      <div class="emoji">${esc(p.emoji ?? '📦')}</div>
      <div class="title">${esc(p.title)}</div>
      <div class="desc">${esc(p.description ?? '')}</div>
      <div class="foot">
        <span class="price">${money(p.price)} <span class="unit">/ ${esc(p.unit)}</span></span>
        ${stockBadge(shown)}
      </div>
    </div>`;
  }).join('');
  return `<div class="grid">${cards}</div>`;
}

function inventoryTable(ctx: StoreContext, products: ProductRow[]): string {
  const lag = ctx.seed.inventoryLag;
  const rows = products.map((p) => `
    <tr>
      <td style="font-size:20px">${esc(p.emoji ?? '📦')}</td>
      <td><b>${esc(p.title)}</b><br><span class="mono">${esc(p.sku)}</span></td>
      <td class="sub">${esc(p.category ?? '—')}</td>
      <td class="num">${money(p.price)}<span class="sub"> / ${esc(p.unit)}</span></td>
      <td class="num"><b>${p.stock}</b>${lag ? `<br><span class="sub">public: ${p.snapshot_stock}</span>` : ''}</td>
      <td class="num"><form method="post" action="/dashboard/products/${encodeURIComponent(p.sku)}/sell-offline"><button title="A walk-in customer buys one — live stock drops, the public snapshot doesn’t">Sell 1 offline</button></form></td>
    </tr>`).join('');
  return `<table><tr><th></th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Live stock${lag ? ' / public' : ''}</th><th></th></tr>${rows}</table>`;
}

function ordersTable(ctx: StoreContext, orders: OrderRow[]): string {
  if (orders.length === 0) {
    return '<p class="hint" style="margin-top:4px">No orders yet — they arrive live through the store API.</p>';
  }
  const titleOf = (sku: string): string => ctx.db.product(sku)?.title ?? sku;
  const rows = orders.map((o) => {
    const lines = ctx.db.orderLines(o.id).map((l) => `${esc(titleOf(l.sku))} ×${l.qty}`).join('<br>');
    const actions = o.status === 'pending'
      ? `<form method="post" action="/dashboard/orders/${encodeURIComponent(o.id)}/confirm"><button>Confirm</button></form>
         <form method="post" action="/dashboard/orders/${encodeURIComponent(o.id)}/reject"><button>Reject</button></form>`
      : '';
    const time = o.created_at.slice(11, 19) || o.created_at;
    return `<tr>
      <td><span class="sub">${esc(time)}</span><br><span class="mono">${esc(o.id.slice(0, 12))}</span></td>
      <td>${lines || '—'}<br><span class="sub">→ ${esc(o.delivery_address)}</span></td>
      <td class="num"><b>${o.total != null ? money(o.total) : '—'}</b></td>
      <td><span class="badge ${o.status}">${o.status}</span>${o.reason ? `<br><span class="sub">${esc(o.reason)}</span>` : ''}</td>
      <td class="sub">${esc(o.invoice_number ?? '—')}${o.delivery_eta ? `<br>ETA ${esc(o.delivery_eta.slice(0, 10))}` : ''}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  return `<table><tr><th>Received</th><th>Items</th><th class="num">Total</th><th>Status</th><th>Invoice / ETA</th><th></th></tr>${rows}</table>`;
}

export function registerViews(app: FastifyInstance, ctx: StoreContext): void {
  app.get('/', async (_req, reply) => {
    const body = `
      <h2>Catalog</h2>
      ${productCards(ctx, ctx.db.catalog())}`;
    return reply.type('text/html').send(page(ctx, 'store', body));
  });

  app.get('/dashboard', async (_req, reply) => {
    const lagHint = ctx.seed.inventoryLag
      ? 'This store publishes a nightly stock snapshot; reservations run on live stock — the two can disagree.'
      : 'Live stock is published as-is.';
    const body = `
      <h2>Incoming orders</h2>
      <p class="hint">Placed by platform agents through the public store API.</p>
      ${ordersTable(ctx, ctx.db.orders())}
      <h2>Inventory</h2>
      <p class="hint">${lagHint}</p>
      ${inventoryTable(ctx, ctx.db.catalog())}`;
    return reply.type('text/html').send(page(ctx, 'office', body));
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
