import { Quote, Req } from '@fdtd/contracts';
import { signJwt, type Clock, type NewEvent } from '@fdtd/shared';
import { z } from 'zod';
import type { AcceptResult, BuyerPlatformPort, QuoteOutcomeView } from './ports.js';

const TaskBundle = z.object({
  task: z.object({
    id: z.string(), userId: z.string(), request: Req,
    excludedProviderIds: z.array(z.string()), status: z.string(),
  }),
  user: z.object({
    deliveryAddress: z.string(),
    preferences: z.object({ preferredProviderIds: z.array(z.string()), notes: z.string().optional() }),
  }),
  policy: z.object({ maxPerDeal: z.number().int(), available: z.number().int() }),
});

const Outcomes = z.array(z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), providerId: z.string(), dealId: z.string(), quote: Quote }),
  z.object({ ok: z.literal(false), providerId: z.string(), refusal: z.string().optional(), error: z.string().optional() }),
]));

/** K3 по HTTP: агент-заказчик -> платформа. Серверные маршруты /agent/* — S7. */
export function httpPlatform(opts: {
  platformUrl: string;
  jwtSecret: string;
  clock: Clock;
  fetchImpl?: typeof fetch;
}): BuyerPlatformPort {
  const base = opts.platformUrl.replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
    const token = signJwt({}, opts.jwtSecret, {
      iss: 'buyer-agent', aud: 'platform', expiresInSec: 60, clock: opts.clock,
    });
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`platform ${path}: http ${res.status}`);
    return res.json();
  };

  return {
    async getTask(taskId) {
      return TaskBundle.parse(await call('GET', `/agent/tasks/${encodeURIComponent(taskId)}`));
    },
    async updateBudget(taskId, budget) {
      await call('POST', `/agent/tasks/${encodeURIComponent(taskId)}/budget`, { budget });
    },
    async findProviders(categories, excludeIds) {
      const res = await call('POST', '/agent/providers/search', { categories, excludeIds });
      return z.array(z.object({ id: z.string(), name: z.string(), rating: z.number() })).parse(res);
    },
    async requestQuotes(taskId, providerIds): Promise<QuoteOutcomeView[]> {
      return Outcomes.parse(await call('POST', `/agent/tasks/${encodeURIComponent(taskId)}/quotes`, { providerIds }));
    },
    async acceptQuote(dealId): Promise<AcceptResult> {
      return await call('POST', `/agent/deals/${encodeURIComponent(dealId)}/accept`, {}) as AcceptResult;
    },
    async failTask(taskId, reason, details) {
      await call('POST', `/agent/tasks/${encodeURIComponent(taskId)}/fail`, { reason, details });
    },
    async event(e: NewEvent) {
      await call('POST', '/agent/events', e);
    },
  };
}
