import { describe, expect, it } from 'vitest';
import { Quote } from '@fdtd/contracts';
import { matchSequence } from '@fdtd/shared';
import { authHeader, baseReq, makeAgent, pickBoth, FakeStore, CATALOG } from './helpers.js';

const postQuote = (app: ReturnType<typeof makeAgent>['app'], request = baseReq()) =>
  app.inject({ method: 'POST', url: '/quote', headers: authHeader(), payload: { taskId: 'task-1', request } });

describe('make_quote (C32, C33, правила)', () => {
  it('все позиции есть -> Quote по живой цене с наценкой, события C30', async () => {
    const { app, platform } = makeAgent(); // A4: снимок 500, живая 510; markup 15%
    const res = await postQuote(app);
    expect(res.statusCode).toBe(200);
    const { quote } = res.json() as { quote: unknown };
    const parsed = Quote.parse(quote);
    // живая цена 510, не снимок 500: ceil(510 * 1.15) = 587
    expect(parsed.lines[0]).toMatchObject({ sku: 'A4', unitPrice: 587, quantity: 2, lineTotal: 1174 });
    expect(parsed.lines[1]).toMatchObject({ sku: 'PEN', unitPrice: 115, quantity: 5, lineTotal: 575 });
    expect(parsed.total).toBe(1749);
    expect(parsed.validUntil).toBe('2026-10-08T13:00:00.000Z'); // NOW + 60 мин
    const seq = matchSequence(
      platform.events as unknown as Array<Record<string, unknown>>,
      ['STEP_STARTED', 'TOOL_CALL', 'TOOL_RESULT', { type: 'DECISION', payload: { total: 1749 } }],
    );
    expect(seq.pass, seq.message).toBe(true);
  });

  it('C32: нет подходящего товара на одну позицию -> отказ целиком', async () => {
    const { app } = makeAgent({
      llmRules: [{
        when: 'бумага a4',
        toolUses: [{
          name: 'select_products',
          input: { selections: [{ itemIndex: 0, sku: 'A4' }, { itemIndex: 1, sku: null, reason: 'нет ручек' }] },
        }],
      }],
    });
    const res = await postQuote(app);
    expect(res.json()).toEqual({ refusal: 'no_match:синие ручки' });
  });

  it('LLM выдумал sku -> отказ, не оферта по фантому', async () => {
    const { app } = makeAgent({
      llmRules: [{
        when: 'бумага a4',
        toolUses: [{
          name: 'select_products',
          input: { selections: [{ itemIndex: 0, sku: 'GHOST-1' }, { itemIndex: 1, sku: 'PEN' }] },
        }],
      }],
    });
    const res = await postQuote(app);
    expect(res.json()).toEqual({ refusal: 'no_match:бумага A4 80г' });
  });

  it('C33: живой остаток меньше запрошенного -> отказ до оферты', async () => {
    const store = new FakeStore(structuredClone(CATALOG));
    store.products[0].stock = 1; // просят 2
    const { app, platform } = makeAgent({ store });
    const res = await postQuote(app);
    expect(res.json()).toEqual({ refusal: 'out_of_stock:A4' });
    expect(platform.withdrawals).toEqual([]); // отказ, а не отзыв потом
  });

  it('minOrderTotal: сумма ниже минимума -> отказ с причиной', async () => {
    const { app } = makeAgent({
      llmRules: [{
        when: 'ручки',
        toolUses: [{ name: 'select_products', input: { selections: [{ itemIndex: 0, sku: 'PEN' }] } }],
      }],
    });
    const res = await postQuote(app, baseReq({
      items: [{ itemQuery: 'синие ручки', quantity: 3, unit: 'pcs', category: 'writing' }],
      categories: ['writing'],
    }));
    expect(res.json()).toEqual({ refusal: 'below_min_order:1000' }); // 3×115 = 345
  });

  it('B7/C15: расписание вт/чт + буфер -> абсолютная дата; четверг -> вт 13-е + 1 день', async () => {
    const { app } = makeAgent({ rules: { schedule: { type: 'weekdays', days: [2, 4] }, etaBufferDays: 1 } });
    const res = await postQuote(app);
    const { quote } = res.json() as { quote: { deliveryEta: string } };
    expect(quote.deliveryEta).toBe('2026-10-14T15:00:00.000Z');
  });

  it('leadDays + буфер', async () => {
    const { app } = makeAgent({ rules: { schedule: { type: 'leadDays', days: 2 }, etaBufferDays: 1 } });
    const res = await postQuote(app);
    const { quote } = res.json() as { quote: { deliveryEta: string } };
    expect(quote.deliveryEta).toBe('2026-10-11T15:00:00.000Z');
  });

  it('без JWT платформы -> 401', async () => {
    const { app } = makeAgent();
    const res = await app.inject({ method: 'POST', url: '/quote', payload: { taskId: 't', request: baseReq() } });
    expect(res.statusCode).toBe(401);
  });
});
