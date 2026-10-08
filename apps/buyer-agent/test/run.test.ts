import { describe, expect, it } from 'vitest';
import { matchSequence } from '@fdtd/shared';
import {
  authHeader, baseReq, FakeBuyerPlatform, llmRules, makeBuyer, PROVIDERS, quoteOf, runTask, sleep, taskView,
} from './helpers.js';

const okOutcome = (providerId: string, total: number, over = {}) =>
  ({ providerId, ok: true as const, dealId: `deal-${providerId}`, quote: quoteOf(total, over) });

describe('C14/C16: ранжирование', () => {
  it('C14: нарушитель validateQuote вне списка с причиной, принят лучший по score', async () => {
    const platform = new FakeBuyerPlatform(taskView(), PROVIDERS, [
      okOutcome('papirna', 4000),
      okOutcome('kancelar', 4200),
      okOutcome('levny', 3500, { deliveryEta: '2026-10-20T15:00:00.000Z' }), // позже дедлайна 12-го
    ]);
    const { app } = makeBuyer(platform);
    await runTask(app, platform);

    expect(platform.acceptedDeals).toEqual(['deal-papirna']); // рейтинг 4.9 решает
    const decision = platform.events.find((e) => e.type === 'DECISION'
      && (e.payload as { step: string }).step === 'evaluate_quotes');
    expect((decision?.payload as { excluded: unknown }).excluded)
      .toEqual([{ providerId: 'levny', reason: 'eta_after_deadline' }]);
    expect(platform.failures).toEqual([]);
  });

  it('C16: предпочтение пользователя перевешивает рейтинг', async () => {
    const platform = new FakeBuyerPlatform(taskView(), PROVIDERS, [
      okOutcome('papirna', 4000),
      okOutcome('kancelar', 4000), // равная цена и match: решают рейтинг против предпочтения
    ]);
    platform.user.preferences.preferredProviderIds = ['kancelar'];
    const { app } = makeBuyer(platform);
    await runTask(app, platform);
    // kancelar: 4.2×0.5 + 0.9×0.3 + 1×0.2 + 0.5 = 3.07 > papirna: 4.9×0.5 + 0.27 + 0.2 = 2.92
    expect(platform.acceptedDeals).toEqual(['deal-kancelar']);
  });
});

describe('C35/R2: бюджет', () => {
  const estimatedTask = () => taskView({ request: baseReq({ budget: { max: 0, source: 'estimated' } }) });

  it('бюджета нет -> оценка ×1.3, записана в задачу, оферты запрошены', async () => {
    const platform = new FakeBuyerPlatform(estimatedTask(), PROVIDERS, [okOutcome('papirna', 4000)]);
    const { app } = makeBuyer(platform, llmRules({ estimate: { lowUsd: 45, highUsd: 60 } }));
    await runTask(app, platform);

    expect(platform.budgets).toEqual([{ max: 7800, source: 'estimated' }]); // 6000 × 1.3
    expect(platform.quoteCalls).toBe(1);
    expect(platform.acceptedDeals).toEqual(['deal-papirna']);
  });

  it('оценка выше maxPerDeal -> FAILED: over_policy до запроса оферт', async () => {
    const platform = new FakeBuyerPlatform(estimatedTask(), PROVIDERS, [okOutcome('papirna', 4000)]);
    const { app } = makeBuyer(platform, llmRules({ estimate: { lowUsd: 120, highUsd: 150 } })); // 15000 > 10000
    await runTask(app, platform);

    expect(platform.failures).toEqual([{ taskId: 'task-1', reason: 'over_policy', details: undefined }]);
    expect(platform.quoteCalls).toBe(0);
  });

  it('потолок режется политикой (available меньше оценки ×1.3)', async () => {
    const platform = new FakeBuyerPlatform(estimatedTask(), PROVIDERS, [okOutcome('papirna', 4000)]);
    platform.policy = { maxPerDeal: 10_000, available: 7_000 };
    const { app } = makeBuyer(platform, llmRules({ estimate: { lowUsd: 45, highUsd: 60 } }));
    await runTask(app, platform);
    expect(platform.budgets).toEqual([{ max: 7000, source: 'estimated' }]);
  });

  it('выше мягкого бюджета — штраф, выше ×2 — ценовая аномалия вне списка', async () => {
    const task = taskView({ request: baseReq({ budget: { max: 4000, source: 'estimated' } }) });
    const platform = new FakeBuyerPlatform(task, PROVIDERS, [
      okOutcome('papirna', 4500),  // выше 4000 — штраф, но в списке
      okOutcome('kancelar', 9000), // выше 8000 = ×2 — аномалия
    ]);
    const { app } = makeBuyer(platform);
    await runTask(app, platform);

    const decision = platform.events.find((e) => e.type === 'DECISION'
      && (e.payload as { step: string }).step === 'evaluate_quotes');
    const payload = decision?.payload as {
      excluded: Array<{ providerId: string; reason: string }>;
      scoreTable: Array<{ providerId: string; aboveEstimate: boolean; score: number }>;
    };
    expect(payload.excluded).toEqual([{ providerId: 'kancelar', reason: 'price_anomaly' }]);
    expect(payload.scoreTable).toEqual([
      // 4.9×0.5 + 0.9×0.3 + 1×0.2 − 0.2 = 2.72
      expect.objectContaining({ providerId: 'papirna', aboveEstimate: true, score: 2.72 }),
    ]);
    expect(platform.acceptedDeals).toEqual(['deal-papirna']);
  });
});

describe('C19/C21 (сторона заказчика): переключение после отзыва', () => {
  it('/run {reason: offer_withdrawn}: исключённый не участвует, принята следующая оферта', async () => {
    const platform = new FakeBuyerPlatform(
      taskView({ excludedProviderIds: ['papirna'] }),
      PROVIDERS,
      [okOutcome('kancelar', 4200), okOutcome('levny', 3500, { deliveryEta: '2026-10-11T15:00:00.000Z' })],
    );
    const { app } = makeBuyer(platform);
    await runTask(app, platform, { taskId: 'task-1', reason: 'offer_withdrawn' });

    expect(platform.findCalls).toEqual([['papirna']]);
    expect(platform.acceptedDeals).toEqual(['deal-kancelar']); // рейтинг выше levny
    const started = platform.events.find((e) => e.type === 'STEP_STARTED');
    expect(started?.payload).toMatchObject({ reason: 'offer_withdrawn' });
  });
});

describe('C13/C22: подходящих оферт нет', () => {
  it('C13: все оферты с нарушениями -> один fail_task с причиной по каждой', async () => {
    const late = { deliveryEta: '2026-10-20T15:00:00.000Z' };
    const platform = new FakeBuyerPlatform(taskView(), PROVIDERS, [
      okOutcome('papirna', 4000, late),
      okOutcome('kancelar', 4200, late),
    ]);
    const { app } = makeBuyer(platform);
    await runTask(app, platform);

    expect(platform.failures).toHaveLength(1);
    expect(platform.failures[0]).toEqual({
      taskId: 'task-1',
      reason: 'no_acceptable_quotes',
      details: { papirna: 'eta_after_deadline', kancelar: 'eta_after_deadline' },
    });
    expect(platform.acceptedDeals).toEqual([]);
  });

  it('C22: все исполнители отвалились -> один fail_task с причиной по каждому', async () => {
    const platform = new FakeBuyerPlatform(taskView(), PROVIDERS, [
      { providerId: 'papirna', ok: false, refusal: 'out_of_stock:PAP-A4-500' },
      { providerId: 'kancelar', ok: false, error: 'http_500' },
    ]);
    const { app } = makeBuyer(platform);
    await runTask(app, platform);

    expect(platform.failures).toEqual([{
      taskId: 'task-1',
      reason: 'no_quotes',
      details: { papirna: 'out_of_stock:PAP-A4-500', kancelar: 'http_500' },
    }]);
  });

  it('исполнителей нет вовсе -> fail_task(no_providers)', async () => {
    const platform = new FakeBuyerPlatform(taskView(), [], []);
    const { app } = makeBuyer(platform);
    await runTask(app, platform);
    expect(platform.failures).toEqual([{ taskId: 'task-1', reason: 'no_providers', details: undefined }]);
  });
});

describe('R7: один прогон на задачу', () => {
  it('второй /run во время работы -> 202, флаг «пересмотреть», оферты запрошены один раз', async () => {
    const platform = new FakeBuyerPlatform(taskView(), PROVIDERS, [okOutcome('papirna', 4000)]);
    platform.quotesDelayMs = 80;
    const { app } = makeBuyer(platform);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/run', headers: authHeader(), payload: { taskId: 'task-1' } }),
      sleep(20).then(() =>
        app.inject({ method: 'POST', url: '/run', headers: authHeader(), payload: { taskId: 'task-1', reason: 'reconsider' } })),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await expect.poll(() => platform.acceptedDeals.length).toBe(1);

    expect(platform.quoteCalls).toBe(1);
    const flag = platform.events.find((e) => e.type === 'DECISION'
      && (e.payload as { decision?: string }).decision === 'already_running_reconsider_flag');
    expect(flag).toBeDefined();
  });
});

describe('C30: форма событий агента', () => {
  it('каждый шаг — STEP_STARTED/TOOL_CALL/TOOL_RESULT/DECISION с runId и correlationId', async () => {
    const platform = new FakeBuyerPlatform(taskView(), PROVIDERS, [okOutcome('papirna', 4000)]);
    const { app } = makeBuyer(platform);
    await runTask(app, platform);

    const seq = matchSequence(platform.events as unknown as Array<Record<string, unknown>>, [
      { type: 'STEP_STARTED', payload: { step: 'run' } },
      { type: 'TOOL_CALL', payload: { tool: 'find_providers' } },
      { type: 'TOOL_RESULT', payload: { tool: 'find_providers' } },
      { type: 'TOOL_CALL', payload: { tool: 'request_quotes' } },
      { type: 'TOOL_RESULT', payload: { tool: 'request_quotes' } },
      { type: 'TOOL_CALL', payload: { tool: 'score_quotes' } },
      { type: 'DECISION', payload: { step: 'evaluate_quotes' } },
      { type: 'TOOL_CALL', payload: { tool: 'accept_quote' } },
      { type: 'DECISION', payload: { step: 'accept_quote', decision: 'accepted' } },
    ]);
    expect(seq.pass, seq.message).toBe(true);
    for (const e of platform.events) {
      expect(e.runId, `event ${e.type} without runId`).toBeTruthy();
      expect(e.correlationId, `event ${e.type} without correlationId`).toBeTruthy();
      expect(e.kind).toBe('agent');
      expect(e.actor).toBe('buyer-agent');
    }
  });
});
