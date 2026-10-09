import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Req } from '@fdtd/contracts';
import type { Clock, EventWriter } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { deals, tasks, users, wallets } from '../db/schema.js';
import type { DealService } from '../deals/deal-service.js';
import type { AgentDispatcher } from '../dispatcher/dispatcher.js';
import type { LedgerService } from '../ledger/ledger.js';
import type { RegistryService } from '../registry/registry.js';
import { seedDemo } from '../registry/seed.js';
import type { PolicyService } from '../policy/policy.js';
import type { AuthService } from '../auth/service.js';
import { resolveIdentity } from './identity.js';

interface Deps {
  db: Db;
  deals: DealService;
  ledger: LedgerService;
  registry: RegistryService;
  policy: PolicyService;
  dispatcher: AgentDispatcher;
  events: EventWriter;
  clock: Clock;
  auth?: AuthService;
}

/** Публичный API для UI/e2e. Идентичность: сессия (S8) или заголовки/тело (агенты, e2e). */
export function registerPublicRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/tasks', async (req, reply) => {
    const parsed = z.object({
      userId: z.string().min(1).optional(),
      request: Req,
      createdVia: z.enum(['ui', 'mcp']).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const identity = await resolveIdentity(req, deps.auth);
    const userId = identity?.role === 'buyer' ? identity.userId : parsed.data.userId;
    if (!userId) return reply.code(401).send({ error: 'buyer_identity_required' });
    const task = await deps.deals.createTask({ ...parsed.data, userId });
    /* B1: заказчику уходит /run, задача едет сама */
    deps.dispatcher.runBuyer({ taskId: task.id, reason: 'task_created' }).catch((err) =>
      app.log.error({ taskId: task.id, err: String(err) }, 'runBuyer dispatch failed'));
    return reply.code(201).send({ task });
  });

  /** N1: «заполнить из текста» — разбор текста агентом-заказчиком, без создания задачи. */
  app.post('/tasks/parse', async (req, reply) => {
    const parsed = z.object({ text: z.string().min(1), userId: z.string().min(1).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const identity = await resolveIdentity(req, deps.auth);
    const userId = identity?.role === 'buyer' ? identity.userId : parsed.data.userId;
    if (!userId) return reply.code(401).send({ error: 'buyer_identity_required' });
    const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
    const result = await deps.dispatcher.parseTask({
      text: parsed.data.text,
      deliveryAddress: user?.deliveryAddress ?? 'не указан',
      correlationId: req.id,
    });
    if ('error' in result) return reply.code(422).send(result);
    return result;
  });

  /** Список задач активной учётки: buyer — свои, admin — все. */
  app.get('/tasks', async (req, reply) => {
    const identity = await resolveIdentity(req, deps.auth);
    if (!identity || identity.role === 'provider') return reply.code(identity ? 403 : 401).send({ error: 'buyer_or_admin_required' });
    const rows = identity.role === 'admin'
      ? await deps.db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(100)
      : await deps.db.select().from(tasks).where(eq(tasks.userId, identity.userId)).orderBy(desc(tasks.createdAt)).limit(100);
    return { tasks: rows };
  });

  /** Кошелёк активной учётки. */
  app.get('/wallets/me', async (req, reply) => {
    const identity = await resolveIdentity(req, deps.auth);
    if (!identity || identity.role === 'admin') return reply.code(identity ? 403 : 401).send({ error: 'buyer_or_provider_required' });
    const owner = identity.role === 'buyer'
      ? { type: 'user' as const, id: identity.userId }
      : { type: 'provider' as const, id: identity.providerId };
    const [w] = await deps.db.select().from(wallets).where(and(
      eq(wallets.ownerType, owner.type), eq(wallets.ownerId, owner.id),
    ));
    if (!w) return { ownerType: owner.type, ownerId: owner.id, balance: 0, held: 0, available: 0 };
    return { ownerType: w.ownerType, ownerId: w.ownerId, balance: w.balance, held: w.held, available: w.balance - w.held };
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const task = await deps.deals.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    const taskDeals = await deps.db.select().from(deals).where(eq(deals.taskId, task.id));
    return { task, deals: taskDeals };
  });

  app.get<{ Params: { ownerType: 'user' | 'provider'; ownerId: string } }>(
    '/wallets/:ownerType/:ownerId',
    async (req, reply) => {
      const [w] = await deps.db.select().from(wallets).where(and(
        eq(wallets.ownerType, req.params.ownerType), eq(wallets.ownerId, req.params.ownerId),
      ));
      if (!w) return reply.code(404).send({ error: 'wallet_not_found' });
      return { ownerType: w.ownerType, ownerId: w.ownerId, balance: w.balance, held: w.held, available: w.balance - w.held };
    },
  );

  /** Портал провайдера: свои сделки — статистика, история, причины отмен. */
  app.get('/provider/deals', async (req, reply) => {
    const identity = await resolveIdentity(req, deps.auth);
    if (!identity || identity.role !== 'provider') {
      return reply.code(identity ? 403 : 401).send({ error: 'provider_required' });
    }
    const rows = await deps.db.select().from(deals)
      .where(eq(deals.providerId, identity.providerId))
      .orderBy(desc(deals.createdAt)).limit(100);
    return { deals: rows };
  });

  /** C27: онбординг магазина — появляется в discovery без перезапуска. */
  app.post('/providers/onboard', async (req, reply) => {
    const identity = await resolveIdentity(req, deps.auth);
    if (!identity) return reply.code(401).send({ error: 'unauthenticated' });
    if (identity.role === 'buyer') return reply.code(403).send({ error: 'provider_or_admin_required' });
    const parsed = z.object({
      id: z.string().regex(/^[a-z0-9-]{2,32}$/),
      name: z.string().min(1),
      categories: z.array(z.string()).min(1),
      agentUrl: z.string().url(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const provider = await deps.registry.upsert(parsed.data);
    await deps.ledger.createWallet({ ownerType: 'provider', ownerId: provider.id });
    return reply.code(201).send({
      provider: { id: provider.id, name: provider.name, categories: provider.categories, rating: provider.ratingX100 / 100 },
    });
  });

  app.get('/providers', async () => {
    const list = await deps.registry.list();
    return list.map((p) => ({
      id: p.id, name: p.name, categories: p.categories, rating: p.ratingX100 / 100, active: p.active,
    }));
  });

  /* ── dev-маршруты: до Stripe (S8) и админки (S9) ── */

  /** SIMULATED-пополнение. Реальные деньги — Stripe Checkout в S8. */
  app.post('/dev/deposit', async (req, reply) => {
    const parsed = z.object({
      userId: z.string().min(1),
      amount: z.number().int().positive(),
      idempotencyKey: z.string().min(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const wallet = await deps.ledger.createWallet({ ownerType: 'user', ownerId: parsed.data.userId });
    const res = await deps.ledger.deposit({
      walletId: wallet.id,
      amount: parsed.data.amount,
      idempotencyKey: parsed.data.idempotencyKey ?? `dev-deposit-${deps.clock.now().getTime()}`,
      simulated: true,
      correlationId: req.id,
    });
    return { entryId: res.entry.id, replayed: res.replayed, simulated: true };
  });

  /** U2/R3: сброс demo-данных (кнопка в админке — S9). */
  app.post('/dev/seed', async (req) => {
    await seedDemo(deps, {
      agentUrlFor: process.env.AGENT_URL_TEMPLATE
        ? (p) => process.env.AGENT_URL_TEMPLATE!.replace('{port}', String(p.port))
        : undefined,
    });
    app.log.info({ reqId: req.id }, 'demo data reseeded');
    return { ok: true };
  });
}
