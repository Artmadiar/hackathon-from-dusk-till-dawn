import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Req } from '@fdtd/contracts';
import type { Clock, EventWriter } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { deals, wallets } from '../db/schema.js';
import type { DealService } from '../deals/deal-service.js';
import type { AgentDispatcher } from '../dispatcher/dispatcher.js';
import type { LedgerService } from '../ledger/ledger.js';
import type { RegistryService } from '../registry/registry.js';
import { seedDemo } from '../registry/seed.js';
import type { PolicyService } from '../policy/policy.js';

interface Deps {
  db: Db;
  deals: DealService;
  ledger: LedgerService;
  registry: RegistryService;
  policy: PolicyService;
  dispatcher: AgentDispatcher;
  events: EventWriter;
  clock: Clock;
}

/**
 * Публичный API для UI/e2e. TODO(S8): сессии и роли; до auth маршруты открыты,
 * идентичность — в теле запроса.
 */
export function registerPublicRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/tasks', async (req, reply) => {
    const parsed = z.object({
      userId: z.string().min(1),
      request: Req,
      createdVia: z.enum(['ui', 'mcp']).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const task = await deps.deals.createTask(parsed.data);
    /* B1: заказчику уходит /run, задача едет сама */
    deps.dispatcher.runBuyer({ taskId: task.id, reason: 'task_created' }).catch((err) =>
      app.log.error({ taskId: task.id, err: String(err) }, 'runBuyer dispatch failed'));
    return reply.code(201).send({ task });
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
