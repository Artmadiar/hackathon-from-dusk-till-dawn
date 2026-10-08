import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Proof, Req } from '@fdtd/contracts';
import {
  AGENT_EVENT_TYPES, DOMAIN_EVENT_TYPES, type Clock, type EventWriter,
} from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { wallets } from '../db/schema.js';
import { DealService, DealTransitionError } from '../deals/deal-service.js';
import type { AgentDispatcher } from '../dispatcher/dispatcher.js';
import type { PolicyService } from '../policy/policy.js';
import type { RegistryService } from '../registry/registry.js';
import { DEMO_USER_PROFILE } from '../registry/seed.js';
import { agentAuth } from './agent-auth.js';

interface Deps {
  db: Db;
  deals: DealService;
  registry: RegistryService;
  policy: PolicyService;
  dispatcher: AgentDispatcher;
  events: EventWriter;
  clock: Clock;
  jwtSecret: string;
}

const Budget = Req.shape.budget;
const AgentEvent = z.object({
  kind: z.enum(['domain', 'agent']),
  actor: z.string().min(1),
  type: z.enum([...DOMAIN_EVENT_TYPES, ...AGENT_EVENT_TYPES]),
  runId: z.string().optional(),
  taskId: z.string().optional(),
  dealId: z.string().optional(),
  providerId: z.string().optional(),
  userId: z.string().optional(),
  payload: z.unknown().optional(),
  correlationId: z.string().optional(),
});

/** K3/K5 по HTTP: всё, что агенты просят у платформы (B1). */
export function registerAgentRoutes(app: FastifyInstance, deps: Deps): void {
  const preHandler = agentAuth(deps);

  /* K3: контекст задачи — задача + профиль пользователя + политика */
  app.get<{ Params: { id: string } }>('/agent/tasks/:id', { preHandler }, async (req, reply) => {
    const task = await deps.deals.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    const policy = await deps.policy.getPolicy(task.userId);
    const [wallet] = await deps.db.select().from(wallets)
      .where(and(eq(wallets.ownerType, 'user'), eq(wallets.ownerId, task.userId)));
    return {
      task: {
        id: task.id, userId: task.userId, request: task.request,
        excludedProviderIds: task.excludedProviderIds, status: task.status,
      },
      /* TODO(S8): профиль из users; до auth — демо-профиль */
      user: DEMO_USER_PROFILE,
      policy: {
        maxPerDeal: policy?.maxPerDeal ?? 0,
        available: wallet ? wallet.balance - wallet.held : 0,
      },
    };
  });

  app.post<{ Params: { id: string } }>('/agent/tasks/:id/budget', { preHandler }, async (req, reply) => {
    const parsed = z.object({ budget: Budget }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const task = await deps.deals.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    await deps.deals.updateRequest(task.id, { ...task.request, budget: parsed.data.budget });
    return { ok: true };
  });

  app.post('/agent/providers/search', { preHandler }, async (req, reply) => {
    const parsed = z.object({
      categories: z.array(z.string()).min(1),
      excludeIds: z.array(z.string()).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const found = await deps.registry.discover({
      contractTypeId: 'office-supplies.v1',
      categories: parsed.data.categories,
      excludeIds: parsed.data.excludeIds,
    });
    return found.map((p) => ({ id: p.id, name: p.name, rating: p.ratingX100 / 100 }));
  });

  /* K2: платформа собирает оферты и создаёт Deal на каждую (DEAL_QUOTED) */
  app.post<{ Params: { id: string } }>('/agent/tasks/:id/quotes', { preHandler }, async (req, reply) => {
    const parsed = z.object({ providerIds: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const task = await deps.deals.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    const providers = [];
    for (const id of parsed.data.providerIds) {
      const p = await deps.registry.get(id);
      if (p) providers.push({ id: p.id, agentUrl: p.agentUrl });
    }
    await deps.deals.setTaskStatus(task.id, 'SOURCING');
    const outcomes = await deps.dispatcher.requestQuotes({
      taskId: task.id, request: task.request, providers, correlationId: req.id,
    });
    const result = [];
    for (const o of outcomes) {
      if (o.ok && o.quote) {
        const deal = await deps.deals.createDeal({ taskId: task.id, providerId: o.providerId, quote: o.quote });
        result.push({ ok: true, providerId: o.providerId, dealId: deal.id, quote: o.quote });
      } else {
        result.push({ ok: false, providerId: o.providerId, refusal: o.refusal, error: o.error });
      }
    }
    await deps.deals.setTaskStatus(task.id, 'DECIDING');
    return result;
  });

  app.post<{ Params: { id: string } }>('/agent/deals/:id/accept', { preHandler }, async (req) => {
    const res = await deps.deals.accept(req.params.id, { correlationId: req.id });
    return res.ok ? { ok: true } : { ok: false, reason: res.code };
  });

  app.post<{ Params: { id: string } }>('/agent/tasks/:id/fail', { preHandler }, async (req, reply) => {
    const parsed = z.object({
      reason: z.string().min(1),
      details: z.record(z.string(), z.string()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    await deps.deals.failTask(req.params.id, parsed.data.reason, parsed.data.details);
    return { ok: true };
  });

  /* K5: исполнитель разместил заказ; поздний вызов по отменённой сделке — не ошибка */
  app.post<{ Params: { id: string } }>('/agent/deals/:id/order-placed', { preHandler }, async (req, reply) => {
    const parsed = z.object({ storeOrderRef: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      await deps.deals.markOrderPlaced(req.params.id, { storeOrderRef: parsed.data.storeOrderRef, correlationId: req.id });
      return { ok: true };
    } catch (e) {
      if (e instanceof DealTransitionError) return { ok: true, ignored: true, from: e.from };
      return reply.code(500).send({ error: String(e) });
    }
  });

  app.post<{ Params: { id: string } }>('/agent/deals/:id/proof', { preHandler }, async (req, reply) => {
    const parsed = z.object({ proof: Proof }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    /* webhook магазина мог обогнать order-placed — дотягиваем переход */
    const deal = await deps.deals.getDeal(req.params.id);
    if (!deal) return reply.code(404).send({ error: 'deal_not_found' });
    if (deal.status === 'HELD') await deps.deals.markOrderPlaced(deal.id, { correlationId: req.id });
    const res = await deps.deals.submitProof(req.params.id, parsed.data.proof, { correlationId: req.id });
    return { settled: res.settled };
  });

  app.post<{ Params: { id: string } }>('/agent/deals/:id/withdraw', { preHandler }, async (req, reply) => {
    const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      await deps.deals.withdrawOffer(req.params.id, parsed.data.reason, { correlationId: req.id });
      return { ok: true };
    } catch (e) {
      if (e instanceof DealTransitionError && e.from === 'CANCELLED') return { ok: true, replayed: true };
      throw e;
    }
  });

  /* K3/K5: структурированные шаги агентов в общий журнал (3.8) */
  app.post('/agent/events', { preHandler }, async (req, reply) => {
    const parsed = AgentEvent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const stored = await deps.events.emit(parsed.data);
    return { id: stored.id };
  });

}
