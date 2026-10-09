import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';
import type { Db } from '../db/client.js';
import { deals, providers, spendingPolicies, tasks, users, wallets } from '../db/schema.js';
import type { EventsQuery } from '../events/query.js';
import { requireRole } from './identity.js';

/** Админские ручки (C34): только role=admin, иначе 403. Журнал — полный, без фильтра R8. */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { db: Db; eventsQuery: EventsQuery; auth?: AuthService },
): void {
  app.get('/admin/events', { preHandler: requireRole(deps.auth, 'admin') }, async (req) => {
    const q = req.query as { since?: string; limit?: string; taskId?: string };
    const list = await deps.eventsQuery.list({
      identity: { role: 'admin' },
      since: q.since ? Number(q.since) : 0,
      limit: q.limit ? Number(q.limit) : 500,
      taskId: q.taskId,
    });
    return { events: list, lastId: list.at(-1)?.id ?? (q.since ? Number(q.since) : 0) };
  });

  /** Обзор площадки: заказчики (кошелёк, задачи, политика) и исполнители (заработок, сделки).
   *  Демо-масштаб — агрегируем в TS, без group by. */
  app.get('/admin/overview', { preHandler: requireRole(deps.auth, 'admin') }, async () => {
    const [allUsers, allWallets, allTasks, allPolicies, allProviders, allDeals] = await Promise.all([
      deps.db.select().from(users),
      deps.db.select().from(wallets),
      deps.db.select().from(tasks),
      deps.db.select().from(spendingPolicies),
      deps.db.select().from(providers),
      deps.db.select().from(deals),
    ]);
    const wallet = (type: 'user' | 'provider', id: string) =>
      allWallets.find((w) => w.ownerType === type && w.ownerId === id);

    const buyers = allUsers.filter((u) => u.role === 'buyer').map((u) => {
      const w = wallet('user', u.id);
      const ts = allTasks.filter((t) => t.userId === u.id);
      const p = allPolicies.find((x) => x.userId === u.id);
      return {
        id: u.id, name: u.name, email: u.email,
        balance: w?.balance ?? 0, held: w?.held ?? 0,
        tasks: {
          total: ts.length,
          done: ts.filter((t) => t.status === 'DONE').length,
          failed: ts.filter((t) => t.status === 'FAILED').length,
          active: ts.filter((t) => t.status !== 'DONE' && t.status !== 'FAILED').length,
        },
        lastTaskAt: ts.map((t) => t.createdAt.toISOString()).sort().at(-1) ?? null,
        policy: p ? {
          maxPerDeal: p.maxPerDeal, maxPerDay: p.maxPerDay,
          totalBudget: p.totalBudget, allowedCategories: p.allowedCategories,
        } : null,
      };
    });

    const providerRows = allProviders.map((p) => {
      const w = wallet('provider', p.id);
      const ds = allDeals.filter((d) => d.providerId === p.id);
      return {
        id: p.id, name: p.name, categories: p.categories,
        rating: p.ratingX100 / 100, active: p.active, agentUrl: p.agentUrl,
        earned: w?.balance ?? 0,
        deals: {
          total: ds.length,
          settled: ds.filter((d) => d.status === 'SETTLED').length,
          cancelled: ds.filter((d) => d.status === 'CANCELLED' || d.status === 'REJECTED_BY_POLICY').length,
        },
        lastDealAt: ds.map((d) => d.updatedAt.toISOString()).sort().at(-1) ?? null,
      };
    });

    return { buyers, providers: providerRows };
  });
}
