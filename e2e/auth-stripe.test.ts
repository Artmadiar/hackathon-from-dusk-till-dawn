import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLATFORM, adminEvents, api } from './helpers.js';

/** S8-сценарии: C34 (OTP, учётки, 403) и C01/C02 (Stripe webhook, идемпотентность). */

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_E2E ?? 'whsec_e2e';

async function rawPost(path: string, body: string, headers: Record<string, string>) {
  const res = await fetch(`${PLATFORM}${path}`, { method: 'POST', headers, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) as Record<string, unknown> : {}, headers: res.headers };
}

function stripeSignature(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

beforeAll(async () => {
  const seed = await api('POST', '/dev/seed');
  expect(seed.status).toBe(200);
});

describe('C34: вход по OTP и переключение учёток', () => {
  let cookie = '';

  async function withSession(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
    const res = await fetch(`${PLATFORM}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  }

  async function login(email: string) {
    const otp = await rawPost('/auth/otp', JSON.stringify({ email }), { 'content-type': 'application/json' });
    expect(otp.status).toBe(200);
    expect(otp.body.simulated).toBe(true); // SIMULATED email — код в ответе
    const verify = await fetch(`${PLATFORM}/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ email, code: otp.body.code }),
    });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return await verify.json() as { session: { activeIdentity: string; identities: Array<{ id: string; role: string }> } };
  }

  it('заказчик входит; админский журнал ему недоступен (403)', async () => {
    const { session } = await login('buyer@demo.local');
    expect(session.activeIdentity).toBe('buyer-1');
    expect((await withSession('/admin/events')).status).toBe(403);
  });

  it('добавление учётки админа в ту же сессию открывает журнал', async () => {
    const { session } = await login('admin@demo.local');
    expect(session.identities.map((i) => i.id)).toEqual(['buyer-1', 'admin-1']);
    expect(session.activeIdentity).toBe('admin-1');

    const journal = await withSession('/admin/events');
    expect(journal.status).toBe(200);
    expect(Array.isArray(journal.body.events)).toBe(true);
  });

  it('переключение обратно на заказчика — снова 403', async () => {
    const sw = await withSession('/auth/switch', 'POST', { userId: 'buyer-1' });
    expect(sw.status).toBe(200);
    expect((await withSession('/admin/events')).status).toBe(403);
  });

  it('MCP: без ключа 401, с ключом отвечает', async () => {
    const no = await rawPost('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
    });
    expect(no.status).toBe(401);

    const yes = await rawPost('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: 'Bearer ak-buyer-demo',
    });
    expect(yes.status).toBe(200);
    expect((yes.body as { result: { tools: unknown[] } }).result.tools.length).toBe(4);
  });
});

describe('C01/C02: Stripe webhook', () => {
  const payload = JSON.stringify({
    id: 'evt_e2e_1',
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_e2e_1', object: 'checkout.session',
        payment_status: 'paid', amount_total: 2500, client_reference_id: 'buyer-1',
      },
    },
  });

  it('подписанный webhook зачисляет DEPOSIT', async () => {
    const res = await rawPost('/webhooks/stripe', payload, {
      'content-type': 'application/json', 'stripe-signature': stripeSignature(payload),
    });
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(false);

    const wallet = await api('GET', '/wallets/user/buyer-1');
    expect((wallet.body as { balance: number }).balance).toBe(2500);
  });

  it('повтор того же события — леджер не изменился, IDEMPOTENT_REPLAY в ленте', async () => {
    const res = await rawPost('/webhooks/stripe', payload, {
      'content-type': 'application/json', 'stripe-signature': stripeSignature(payload),
    });
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);

    const wallet = await api('GET', '/wallets/user/buyer-1');
    expect((wallet.body as { balance: number }).balance).toBe(2500);

    const events = await adminEvents();
    const deposits = events.filter((e) => e.type === 'DEPOSIT');
    expect(deposits).toHaveLength(1);
    expect((deposits[0]!.payload as { simulated: boolean }).simulated).toBe(false);
    expect(events.some((e) => e.type === 'IDEMPOTENT_REPLAY')).toBe(true);
  });

  it('битая подпись -> 400', async () => {
    const res = await rawPost('/webhooks/stripe', payload, {
      'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad',
    });
    expect(res.status).toBe(400);
  });
});
