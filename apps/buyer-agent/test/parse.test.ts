import { describe, expect, it } from 'vitest';
import { Req } from '@fdtd/contracts';
import { FakeBuyerPlatform, authHeader, makeBuyer, taskView } from './helpers.js';
import type { FakeLlmRule } from '@fdtd/shared';

const parseRule = (input: Record<string, unknown>): FakeLlmRule => ({
  when: 'parse_task',
  toolUses: [{ name: 'parse_task', input }],
});

const post = (app: ReturnType<typeof makeBuyer>['app'], text: string) =>
  app.inject({
    method: 'POST', url: '/parse', headers: authHeader(),
    payload: { text, deliveryAddress: 'Praha 7, Dukelských hrdinů 21' },
  });

describe('N1: parse_task', () => {
  it('текст -> Req: категории из enum, абсолютный дедлайн, предположения в ASSUMPTION', async () => {
    const platform = new FakeBuyerPlatform(taskView(), [], []);
    const { app } = makeBuyer(platform, [parseRule({
      items: [
        { itemQuery: 'бумага A4 80г', quantity: 5, unit: 'pack', category: 'paper' },
        { itemQuery: 'синие ручки', quantity: 20, unit: 'pcs', category: 'writing' },
      ],
      deadline: '2026-10-12T00:00:00Z',
      budgetUsd: null,
      assumptions: ['бумага обычная 80 г/м², не фото'],
    })]);

    const res = await post(app, 'нужна бумага и ручки к понедельнику');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { request: unknown; assumptions: string[] };
    const req = Req.parse(body.request);
    expect(req.categories).toEqual(['paper', 'writing']);
    expect(req.deadline).toBe('2026-10-12T00:00:00.000Z');
    expect(req.budget).toEqual({ max: 0, source: 'estimated' }); // бюджет не назван
    expect(req.deliveryAddress).toContain('Praha');
    expect(body.assumptions).toHaveLength(1);
    expect(platform.events).toEqual([expect.objectContaining({
      type: 'ASSUMPTION',
      payload: { step: 'parse_task', assumption: 'бумага обычная 80 г/м², не фото' },
    })]);
  });

  it('бюджет назван -> source: user, центы на границе (R5)', async () => {
    const platform = new FakeBuyerPlatform(taskView(), [], []);
    const { app } = makeBuyer(platform, [parseRule({
      items: [{ itemQuery: 'вода 19л', quantity: 2, unit: 'bottle', category: 'water' }],
      deadline: '2026-10-10T00:00:00Z',
      budgetUsd: 42.5,
      assumptions: [],
    })]);
    const res = await post(app, 'закажи воду, бюджет 42.50');
    const req = Req.parse((res.json() as { request: unknown }).request);
    expect(req.budget).toEqual({ max: 4250, source: 'user' });
  });

  it('LLM вернул мусор -> 422, не упали', async () => {
    const platform = new FakeBuyerPlatform(taskView(), [], []);
    const { app } = makeBuyer(platform, [parseRule({ items: [] })]);
    const res = await post(app, 'что-то невнятное');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'llm_bad_parse' });
  });

  it('без JWT -> 401', async () => {
    const platform = new FakeBuyerPlatform(taskView(), [], []);
    const { app } = makeBuyer(platform);
    const res = await app.inject({ method: 'POST', url: '/parse', payload: { text: 'x', deliveryAddress: 'y' } });
    expect(res.statusCode).toBe(401);
  });
});
