import type { Req } from '@fdtd/contracts';
import type { Clock, IdGen, Llm, NewEvent } from '@fdtd/shared';
import { BudgetEstimate, estimatePrompt, matchPrompt, QuoteMatches } from './prompts.js';
import { rankQuotes } from './rank.js';
import type { BuyerPlatformPort, QuoteOutcomeView } from './ports.js';

export interface RunnerDeps {
  llm: Llm;
  platform: BuyerPlatformPort;
  clock: Clock;
  idGen: IdGen;
  log?: { error: (o: unknown, msg: string) => void };
}

/**
 * Цикл заказчика (концепт 3.6): бюджет -> исполнители -> оферты -> ранжирование
 * -> accept по рангу. Простой и линейный; выбирает агент, деньги и валидации —
 * платформа. R7: на задачу один прогон за раз, повторный /run — флаг «пересмотреть».
 */
export class BuyerRunner {
  private readonly running = new Map<string, { reconsider: boolean }>();

  constructor(private readonly deps: RunnerDeps) {}

  /** true — прогон запущен; false — уже шёл, поставлен флаг (R7). */
  async run(input: { taskId: string; reason?: string; correlationId?: string }): Promise<boolean> {
    const inflight = this.running.get(input.taskId);
    const base = {
      kind: 'agent' as const, actor: 'buyer-agent',
      taskId: input.taskId, correlationId: input.correlationId,
    };
    if (inflight) {
      inflight.reconsider = true;
      await this.deps.platform.event({ ...base, type: 'DECISION',
        payload: { step: 'run', decision: 'already_running_reconsider_flag', reason: input.reason } });
      return false;
    }
    this.running.set(input.taskId, { reconsider: false });
    try {
      await this.execute(input);
    } catch (err) {
      this.deps.log?.error({ taskId: input.taskId, err: String(err) }, 'buyer run crashed');
      await this.deps.platform.event({ ...base, type: 'STEP_FAILED',
        payload: { step: 'run', error: String(err) } }).catch(() => {});
    } finally {
      this.running.delete(input.taskId);
    }
    return true;
  }

  private async execute(input: { taskId: string; reason?: string; correlationId?: string }): Promise<void> {
    const { platform, llm, clock } = this.deps;
    const runId = this.deps.idGen.next('run');
    const base: Omit<NewEvent, 'type'> = {
      kind: 'agent', actor: 'buyer-agent', runId,
      taskId: input.taskId, correlationId: input.correlationId,
    };
    const emit = (type: NewEvent['type'], payload: unknown) => platform.event({ ...base, type, payload });

    await emit('STEP_STARTED', { step: 'run', reason: input.reason ?? 'task_created' });
    const { task, user, policy } = await platform.getTask(input.taskId);
    let req: Req = task.request;

    /* C35, R2: бюджет не назван -> оценка LLM x1.3, потолок политикой */
    if (req.budget.source === 'estimated' && req.budget.max === 0) {
      await emit('TOOL_CALL', { tool: 'estimate_budget', items: req.items.map((i) => i.itemQuery) });
      const res = await llm.complete(estimatePrompt(req));
      const est = BudgetEstimate.safeParse(res.toolUses.find((t) => t.name === 'estimate_budget')?.input);
      if (!est.success) {
        await platform.failTask(input.taskId, 'estimate_failed');
        return;
      }
      const estimate = Math.round(est.data.highUsd * 100); // R5: центы на границе
      await emit('TOOL_RESULT', { tool: 'estimate_budget', lowUsd: est.data.lowUsd, highUsd: est.data.highUsd });
      if (estimate > policy.maxPerDeal) {
        await emit('DECISION', { step: 'estimate_budget', decision: 'over_policy', estimate, maxPerDeal: policy.maxPerDeal });
        await platform.failTask(input.taskId, 'over_policy');
        return;
      }
      const max = Math.min(Math.round(estimate * 1.3), policy.maxPerDeal, policy.available);
      req = { ...req, budget: { max, source: 'estimated' } };
      await platform.updateBudget(input.taskId, req.budget);
      await emit('DECISION', {
        step: 'estimate_budget',
        reasoning: `ожидаю ${est.data.lowUsd}–${est.data.highUsd} $, потолок ${(max / 100).toFixed(2)} $`,
        budget: req.budget,
      });
    }

    await emit('TOOL_CALL', { tool: 'find_providers', categories: req.categories, excludeIds: task.excludedProviderIds });
    const providers = await platform.findProviders(req.categories, task.excludedProviderIds);
    await emit('TOOL_RESULT', { tool: 'find_providers', providers: providers.map((p) => p.id) });
    if (providers.length === 0) {
      await platform.failTask(input.taskId, 'no_providers');
      return;
    }

    await emit('TOOL_CALL', { tool: 'request_quotes', providerIds: providers.map((p) => p.id) });
    const outcomes = await platform.requestQuotes(input.taskId, providers.map((p) => p.id));
    await emit('TOOL_RESULT', {
      tool: 'request_quotes',
      outcomes: outcomes.map((o) => o.ok
        ? { providerId: o.providerId, total: o.quote.total }
        : { providerId: o.providerId, refusal: o.refusal, error: o.error }),
    });

    const failures: Record<string, string> = {};
    for (const o of outcomes) {
      if (!o.ok) failures[o.providerId] = o.refusal ?? o.error ?? 'unknown';
    }
    const okOutcomes = outcomes.filter((o): o is Extract<QuoteOutcomeView, { ok: true }> => o.ok);
    if (okOutcomes.length === 0) {
      /* C22: все исполнители отвалились — одно уведомление с причиной по каждому */
      await platform.failTask(input.taskId, 'no_quotes', failures);
      return;
    }

    /* LLM даёт только «соответствие товару»; формула — в коде (3.6) */
    await emit('TOOL_CALL', { tool: 'score_quotes', providerIds: okOutcomes.map((o) => o.providerId) });
    const matchRes = await llm.complete(matchPrompt(
      req,
      okOutcomes.map((o) => ({ providerId: o.providerId, quote: o.quote })),
      user.preferences.notes,
    ));
    const matchParsed = QuoteMatches.safeParse(matchRes.toolUses.find((t) => t.name === 'score_quotes')?.input);
    const matches = new Map<string, number>(
      matchParsed.success ? matchParsed.data.matches.map((m) => [m.providerId, m.match]) : [],
    );
    await emit('TOOL_RESULT', { tool: 'score_quotes', matches: Object.fromEntries(matches) });

    const byProvider = new Map(providers.map((p) => [p.id, p]));
    const { ranked, excluded } = rankQuotes({
      req,
      candidates: okOutcomes.map((o) => ({
        dealId: o.dealId, providerId: o.providerId,
        rating: byProvider.get(o.providerId)?.rating ?? 0, quote: o.quote,
      })),
      matches,
      preferredProviderIds: user.preferences.preferredProviderIds,
      now: clock.now(),
    });
    await emit('DECISION', {
      step: 'evaluate_quotes',
      scoreTable: ranked.map((r) => ({
        providerId: r.providerId, score: r.score, rating: r.rating, match: r.match,
        priceAdvantage: r.priceAdvantage, preferred: r.preferred, aboveEstimate: r.aboveEstimate, total: r.quote.total,
      })),
      excluded: excluded.map((e) => ({ providerId: e.providerId, reason: e.reason })),
    });

    if (ranked.length === 0) {
      /* C13: все оферты с нарушениями — причина по каждой, одно уведомление */
      for (const e of excluded) failures[e.providerId] = e.reason;
      await platform.failTask(input.taskId, 'no_acceptable_quotes', failures);
      return;
    }

    for (const candidate of ranked) {
      await emit('TOOL_CALL', { tool: 'accept_quote', dealId: candidate.dealId, providerId: candidate.providerId });
      const res = await platform.acceptQuote(candidate.dealId);
      if (res.ok) {
        await emit('DECISION', {
          step: 'accept_quote', decision: 'accepted',
          providerId: candidate.providerId, dealId: candidate.dealId, score: candidate.score,
        });
        return;
      }
      failures[candidate.providerId] = res.reason;
      await emit('DECISION', { step: 'accept_quote', decision: 'rejected', providerId: candidate.providerId, reason: res.reason });
    }
    await platform.failTask(input.taskId, 'all_accepts_rejected', failures);
  }
}
