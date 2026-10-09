import fastifyCookie from '@fastify/cookie';
import { createApp } from '@fdtd/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { AuthService } from '../src/auth/service.js';
import { users } from '../src/db/schema.js';
import { EventsQuery } from '../src/events/query.js';
import { registerAdminRoutes } from '../src/http/admin-routes.js';
import { createTestContext, truncateAll } from './helpers.js';

const ctx = createTestContext();
const auth = new AuthService(ctx.db, ctx.clock);
const app: FastifyInstance = createApp({ service: 'test-auth' });
await app.register(fastifyCookie);
registerAuthRoutes(app, { auth });
registerAdminRoutes(app, { db: ctx.db, eventsQuery: new EventsQuery(ctx.db), auth });

afterAll(async () => { await app.close(); await ctx.close(); });
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.clock.set('2026-10-08T12:00:00Z');
  await ctx.db.insert(users).values([
    { id: 'buyer-1', email: 'buyer@demo.local', role: 'buyer', name: 'Buyer', apiKey: 'ak-buyer-demo', createdAt: ctx.clock.now() },
    { id: 'admin-1', email: 'admin@demo.local', role: 'admin', name: 'Admin', apiKey: 'ak-admin-demo', createdAt: ctx.clock.now() },
  ]);
});

async function otp(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/otp', payload: { email } });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { code: string; simulated: boolean };
  expect(body.simulated).toBe(true); // SIMULATED email: код в ответе, не в почте
  return body.code;
}

async function verify(email: string, code: string, cookie?: string) {
  return app.inject({
    method: 'POST', url: '/auth/verify', payload: { email, code },
    ...(cookie ? { cookies: { sid: cookie } } : {}),
  });
}

function sidOf(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((c) => c.name === 'sid');
  expect(c).toBeDefined();
  return c!.value;
}

describe('C34: OTP-вход', () => {
  it('код выдан, верификация создаёт сессию с cookie', async () => {
    const code = await otp('buyer@demo.local');
    const res = await verify('buyer@demo.local', code);
    expect(res.statusCode).toBe(200);
    const { session } = res.json() as { session: { activeIdentity: string; identities: Array<{ id: string }> } };
    expect(session.activeIdentity).toBe('buyer-1');
    expect(session.identities.map((i) => i.id)).toEqual(['buyer-1']);
    expect(sidOf(res)).toBeTruthy();
  });

  it('код одноразовый: второй verify тем же кодом -> 401', async () => {
    const code = await otp('buyer@demo.local');
    expect((await verify('buyer@demo.local', code)).statusCode).toBe(200);
    const again = await verify('buyer@demo.local', code);
    expect(again.statusCode).toBe(401);
    expect((again.json() as { error: string }).error).toBe('invalid_code');
  });

  it('TTL: код протухает через 10 минут -> 401 expired_code', async () => {
    const code = await otp('buyer@demo.local');
    ctx.clock.set('2026-10-08T12:10:01Z');
    const res = await verify('buyer@demo.local', code);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('expired_code');
  });

  it('чужой код не подходит -> 401', async () => {
    await otp('buyer@demo.local');
    const res = await verify('buyer@demo.local', '000000');
    expect(res.statusCode).toBe(401);
  });

  it('неизвестный email регистрируется заказчиком на лету', async () => {
    const code = await otp('fresh@office.cz');
    const res = await verify('fresh@office.cz', code);
    expect(res.statusCode).toBe(200);
    const { session } = res.json() as { session: { identities: Array<{ role: string; email: string }> } };
    expect(session.identities[0]!.role).toBe('buyer');
    expect(session.identities[0]!.email).toBe('fresh@office.cz');
  });
});

describe('C34: несколько учёток в одной сессии', () => {
  it('добавление второй учётки и переключение без повторного входа', async () => {
    const sid = sidOf(await verify('buyer@demo.local', await otp('buyer@demo.local')));

    // verify с cookie добавляет учётку в ту же сессию и делает её активной
    const res2 = await verify('admin@demo.local', await otp('admin@demo.local'), sid);
    const { session } = res2.json() as { session: { id: string; activeIdentity: string; identities: Array<{ id: string }> } };
    expect(session.identities.map((i) => i.id)).toEqual(['buyer-1', 'admin-1']);
    expect(session.activeIdentity).toBe('admin-1');

    const sw = await app.inject({ method: 'POST', url: '/auth/switch', payload: { userId: 'buyer-1' }, cookies: { sid } });
    expect(sw.statusCode).toBe(200);
    expect((sw.json() as { session: { activeIdentity: string } }).session.activeIdentity).toBe('buyer-1');
  });

  it('переключение на учётку не из сессии -> 403', async () => {
    const sid = sidOf(await verify('buyer@demo.local', await otp('buyer@demo.local')));
    const sw = await app.inject({ method: 'POST', url: '/auth/switch', payload: { userId: 'admin-1' }, cookies: { sid } });
    expect(sw.statusCode).toBe(403);
  });

  it('GET /auth/session отдаёт сессию; logout убивает', async () => {
    const sid = sidOf(await verify('buyer@demo.local', await otp('buyer@demo.local')));
    expect((await app.inject({ method: 'GET', url: '/auth/session', cookies: { sid } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/auth/logout', cookies: { sid } });
    expect((await app.inject({ method: 'GET', url: '/auth/session', cookies: { sid } })).statusCode).toBe(401);
  });
});

describe('C34: раздел не по роли -> 403', () => {
  it('админский журнал: заказчику 403, админу 200, анониму 401', async () => {
    const sid = sidOf(await verify('buyer@demo.local', await otp('buyer@demo.local')));
    expect((await app.inject({ method: 'GET', url: '/admin/events', cookies: { sid } })).statusCode).toBe(403);

    await verify('admin@demo.local', await otp('admin@demo.local'), sid); // активная — админ
    expect((await app.inject({ method: 'GET', url: '/admin/events', cookies: { sid } })).statusCode).toBe(200);

    // переключились обратно на заказчика — снова 403
    await app.inject({ method: 'POST', url: '/auth/switch', payload: { userId: 'buyer-1' }, cookies: { sid } });
    expect((await app.inject({ method: 'GET', url: '/admin/events', cookies: { sid } })).statusCode).toBe(403);

    expect((await app.inject({ method: 'GET', url: '/admin/events' })).statusCode).toBe(401);
  });
});
