import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { providers, tasks } from '../src/db/schema.js';
import { idempotencyKeys } from '../src/ledger/ledger.js';
import { RATING_DELTA, RegistryService } from '../src/registry/registry.js';
import { DEMO_PROVIDERS, DEMO_USER_ID, seedDemo } from '../src/registry/seed.js';
import { createTestContext, truncateAll } from './helpers.js';

const ctx = createTestContext();
const registry = new RegistryService(ctx.db, ctx.events, ctx.clock);
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  ctx.events.events.length = 0;
  ctx.clock.set('2026-10-08T12:00:00Z');
});

describe('Registry: discovery (C12, C31)', () => {
  beforeEach(() => seedDemo({ db: ctx.db, events: ctx.events, clock: ctx.clock }));

  it('C31 paper+writing: только papirna и kancelar, по рейтингу', async () => {
    const found = await registry.discover({ contractTypeId: 'office-supplies.v1', categories: ['paper', 'writing'] });
    expect(found.map((p) => p.id)).toEqual(['papirna', 'kancelar']);
  });

  it('вода — только aqua; дешёвый levny без writing не попадает в C31', async () => {
    const water = await registry.discover({ contractTypeId: 'office-supplies.v1', categories: ['water'] });
    expect(water.map((p) => p.id)).toEqual(['aqua']);
  });

  it('C12 комбинация категорий, которую никто не покрывает -> пусто', async () => {
    const found = await registry.discover({ contractTypeId: 'office-supplies.v1', categories: ['water', 'paper'] });
    expect(found).toEqual([]);
  });

  it('исключённые исполнители не возвращаются (B9)', async () => {
    const found = await registry.discover({
      contractTypeId: 'office-supplies.v1', categories: ['paper'], excludeIds: ['papirna'],
    });
    expect(found.map((p) => p.id)).toEqual(['kancelar', 'levny']);
  });

  it('неактивный исполнитель вне discovery', async () => {
    await registry.upsert({
      id: 'papirna', name: 'Papírna Holešovice', agentUrl: 'http://x',
      categories: ['paper', 'writing', 'office'], active: false,
    });
    const found = await registry.discover({ contractTypeId: 'office-supplies.v1', categories: ['paper', 'writing'] });
    expect(found.map((p) => p.id)).toEqual(['kancelar']);
  });
});

describe('Registry: рейтинг 3.3.1 (C18)', () => {
  beforeEach(() => seedDemo({ db: ctx.db, events: ctx.events, clock: ctx.clock }));

  it('SETTLED +0.05, OFFER_WITHDRAWN -0.3, событие RATING_CHANGED', async () => {
    const up = await registry.changeRating('papirna', RATING_DELTA.settled, 'deal_settled', { dealId: 'd1' });
    expect(up).toEqual({ before: 490, after: 495 });
    const down = await registry.changeRating('papirna', RATING_DELTA.offerWithdrawn, 'offer_withdrawn:out_of_stock');
    expect(down).toEqual({ before: 495, after: 465 });
    expect(ctx.events.events).toMatchSequence([
      { type: 'RATING_CHANGED', providerId: 'papirna', payload: { before: 4.9, after: 4.95, reason: 'deal_settled' } },
      { type: 'RATING_CHANGED', providerId: 'papirna', payload: { before: 4.95, after: 4.65 } },
    ]);
  });

  it('клэмп: не выше 5.0 и не ниже 0', async () => {
    await registry.upsert({ id: 'top', name: 'Top', agentUrl: 'http://x', categories: ['paper'], ratingX100: 498 });
    expect(await registry.changeRating('top', RATING_DELTA.settled, 'x')).toEqual({ before: 498, after: 500 });
    await registry.upsert({ id: 'bottom', name: 'Bottom', agentUrl: 'http://x', categories: ['paper'], ratingX100: 20 });
    expect(await registry.changeRating('bottom', RATING_DELTA.offerWithdrawn, 'x')).toEqual({ before: 20, after: 0 });
  });
});

describe('Registry: сброс demo-данных (U2, R3)', () => {
  it('повторный seed возвращает рейтинги и чистит журнал/леджер/задачи', async () => {
    const deps = { db: ctx.db, events: ctx.events, clock: ctx.clock };
    await seedDemo(deps);

    // портим состояние: рейтинг, события, деньги, задача
    await registry.changeRating('papirna', -30, 'rehearsal');
    const w = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: DEMO_USER_ID });
    await ctx.ledger.deposit({ walletId: w.id, amount: 7777, idempotencyKey: idempotencyKeys.depositStripe('x') });
    await ctx.db.insert(tasks).values({
      id: 'task-garbage', userId: DEMO_USER_ID, contractTypeId: 'office-supplies.v1',
      request: { items: [], categories: [], budget: { max: 1, source: 'user' }, deadline: '', deliveryAddress: '' },
      status: 'OPEN', createdAt: ctx.clock.now(), updatedAt: ctx.clock.now(),
    });

    await seedDemo(deps);

    const rows = await ctx.db.select().from(providers);
    const byId = Object.fromEntries(rows.map((p) => [p.id, p.ratingX100]));
    expect(byId).toEqual(Object.fromEntries(DEMO_PROVIDERS.map((p) => [p.id, p.ratingX100])));
    expect(await ctx.db.select().from(tasks)).toEqual([]);
    const wallet = await ctx.ledger.createWallet({ ownerType: 'user', ownerId: DEMO_USER_ID });
    expect(wallet).toMatchObject({ balance: 0, held: 0 });
  });
});
