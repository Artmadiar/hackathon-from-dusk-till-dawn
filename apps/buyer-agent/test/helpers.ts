import type { Quote, Req } from '@fdtd/contracts';
import {
  FakeLlm, fixedClock, seqIdGen, signJwt,
  type FakeLlmRule, type NewEvent,
} from '@fdtd/shared';
import { createBuyerAgent } from '../src/app.js';
import type {
  AcceptResult, BuyerPlatformPort, PolicyView, ProviderView, QuoteOutcomeView, TaskView, UserView,
} from '../src/ports.js';

process.env.LOG_LEVEL ??= 'silent';

export const NOW = '2026-10-08T12:00:00Z';
export const JWT_SECRET = 'test-jwt-secret';
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const baseReq = (over: Partial<Req> = {}): Req => ({
  items: [{ itemQuery: 'бумага A4 80г', quantity: 5, unit: 'pack', category: 'paper' }],
  categories: ['paper'],
  budget: { max: 6000, source: 'user' },
  deadline: '2026-10-12T00:00:00Z',
  deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
  ...over,
});

export const quoteOf = (total: number, over: Partial<Quote> = {}): Quote => ({
  lines: [{ itemIndex: 0, sku: 'A4', title: 'Papír A4 500 listů', unitPrice: total / 5, quantity: 5, lineTotal: total }],
  total,
  deliveryEta: '2026-10-10T15:00:00.000Z',
  validUntil: '2026-10-08T14:00:00.000Z',
  ...over,
});

/** K3-фейк: in-memory платформа, записывает всё, что делает агент. */
export class FakeBuyerPlatform implements BuyerPlatformPort {
  readonly events: NewEvent[] = [];
  readonly failures: Array<{ taskId: string; reason: string; details?: Record<string, string> }> = [];
  readonly acceptedDeals: string[] = [];
  readonly budgets: Array<Req['budget']> = [];
  readonly findCalls: string[][] = [];
  quoteCalls = 0;
  quotesDelayMs = 0;
  acceptResults: Record<string, AcceptResult> = {};

  constructor(
    public task: TaskView,
    public providers: ProviderView[],
    public outcomes: QuoteOutcomeView[],
    public user: UserView = {
      deliveryAddress: 'Praha 7', preferences: { preferredProviderIds: [] },
    },
    public policy: PolicyView = { maxPerDeal: 10_000, available: 20_000 },
  ) {}

  async getTask() { return { task: this.task, user: this.user, policy: this.policy }; }
  async updateBudget(_taskId: string, budget: Req['budget']) {
    this.budgets.push(budget);
    this.task = { ...this.task, request: { ...this.task.request, budget } };
  }
  async findProviders(_categories: Req['categories'], excludeIds: string[]) {
    this.findCalls.push(excludeIds);
    return this.providers.filter((p) => !excludeIds.includes(p.id));
  }
  async requestQuotes() {
    this.quoteCalls++;
    if (this.quotesDelayMs) await sleep(this.quotesDelayMs);
    return this.outcomes;
  }
  async acceptQuote(dealId: string): Promise<AcceptResult> {
    const res = this.acceptResults[dealId] ?? { ok: true as const };
    if (res.ok) this.acceptedDeals.push(dealId);
    return res;
  }
  async failTask(taskId: string, reason: string, details?: Record<string, string>) {
    this.failures.push({ taskId, reason, details });
  }
  async event(e: NewEvent) { this.events.push(e); }
}

export const taskView = (over: Partial<TaskView> = {}): TaskView => ({
  id: 'task-1', userId: 'user-1', request: baseReq(),
  excludedProviderIds: [], status: 'SOURCING',
  ...over,
});

export const PROVIDERS: ProviderView[] = [
  { id: 'papirna', name: 'Papírna Holešovice', rating: 4.9 },
  { id: 'kancelar', name: 'Kancelář Plus', rating: 4.2 },
  { id: 'levny', name: 'Levný Papír', rating: 3.8 },
];

/** Правила FakeLlm по именам инструментов в системном промпте. */
export const llmRules = (over: {
  estimate?: { lowUsd: number; highUsd: number };
  matches?: Array<{ providerId: string; match: number }>;
} = {}): FakeLlmRule[] => [
  {
    when: 'estimate_budget',
    toolUses: [{ name: 'estimate_budget', input: over.estimate ?? { lowUsd: 45, highUsd: 60 } }],
  },
  {
    when: 'score_quotes',
    toolUses: [{
      name: 'score_quotes',
      input: { matches: over.matches ?? PROVIDERS.map((p) => ({ providerId: p.id, match: 0.9 })) },
    }],
  },
];

export function makeBuyer(platform: FakeBuyerPlatform, rules: FakeLlmRule[] = llmRules()) {
  return createBuyerAgent({
    llm: new FakeLlm(rules),
    platform,
    clock: fixedClock(NOW),
    idGen: seqIdGen(),
    jwtSecret: JWT_SECRET,
  });
}

export const authHeader = (): Record<string, string> => ({
  authorization: `Bearer ${signJwt({}, JWT_SECRET, {
    iss: 'platform', aud: 'buyer-agent', expiresInSec: 60, clock: fixedClock(NOW),
  })}`,
});

/** Прогон через HTTP /run и ожидание исхода (accept или fail). */
export async function runTask(
  app: ReturnType<typeof makeBuyer>['app'],
  platform: FakeBuyerPlatform,
  body: Record<string, unknown> = { taskId: 'task-1' },
) {
  const res = await app.inject({ method: 'POST', url: '/run', headers: authHeader(), payload: body });
  if (res.statusCode === 202) {
    const { expect } = await import('vitest');
    await expect.poll(() => platform.acceptedDeals.length + platform.failures.length, { timeout: 2000 })
      .toBeGreaterThan(0);
  }
  return res;
}
