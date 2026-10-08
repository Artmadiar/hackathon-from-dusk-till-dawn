import { sql } from 'drizzle-orm';
import type { Clock, EventWriter } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { LedgerService } from '../ledger/ledger.js';
import { PolicyService } from '../policy/policy.js';
import { RegistryService } from './registry.js';

export const DEMO_USER_ID = 'buyer-1';

/** TODO(S8): профиль из таблицы users; до auth агент получает демо-профиль. */
export const DEMO_USER_PROFILE = {
  deliveryAddress: 'Praha 7, Dukelských hrdinů 21',
  preferences: { preferredProviderIds: [] as string[] },
};

/** Четыре магазина из концепта 3.3; URL агентов — compose-сеть по умолчанию. */
export const DEMO_PROVIDERS = [
  { id: 'aqua', name: 'AquaDoručení', categories: ['water', 'office'], ratingX100: 470, port: 3382 },
  { id: 'papirna', name: 'Papírna Holešovice', categories: ['paper', 'writing', 'office'], ratingX100: 490, port: 3383 },
  { id: 'kancelar', name: 'Kancelář Plus', categories: ['paper', 'writing', 'office'], ratingX100: 420, port: 3384 },
  { id: 'levny', name: 'Levný Papír', categories: ['paper', 'office'], ratingX100: 380, port: 3385 },
] as const;

/**
 * U2/R3: сброс demo-данных — рейтинги, кошельки, политика, пустой журнал.
 * Запускается перед каждой записью видео и с кнопки в админке.
 */
export async function seedDemo(
  deps: { db: Db; events: EventWriter; clock: Clock },
  opts: { agentUrlFor?: (p: (typeof DEMO_PROVIDERS)[number]) => string } = {},
): Promise<void> {
  const { db, events, clock } = deps;
  const agentUrlFor = opts.agentUrlFor
    ?? ((p: (typeof DEMO_PROVIDERS)[number]) => `http://provider-agent-${DEMO_PROVIDERS.indexOf(p) + 1}:${p.port}`);

  await db.execute(sql`
    TRUNCATE events, deals, tasks, providers, ledger_entries, wallets, spending_policies
    RESTART IDENTITY CASCADE
  `);

  const ledger = new LedgerService(db, events, clock);
  const policy = new PolicyService(db);
  const registry = new RegistryService(db, events, clock);

  await ledger.createWallet({ ownerType: 'user', ownerId: DEMO_USER_ID });
  await policy.setPolicy({
    userId: DEMO_USER_ID,
    maxPerDeal: 5000,   // 50 $ (концепт 4.1)
    maxPerDay: 10000,   // 100 $
    totalBudget: 10000, // 100 $
    allowedCategories: ['paper', 'writing', 'water', 'office'],
  });

  for (const p of DEMO_PROVIDERS) {
    await registry.upsert({
      id: p.id, name: p.name, categories: [...p.categories],
      ratingX100: p.ratingX100, agentUrl: agentUrlFor(p),
    });
    await ledger.createWallet({ ownerType: 'provider', ownerId: p.id });
  }
}
