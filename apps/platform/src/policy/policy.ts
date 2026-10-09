import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { spendingPolicies, type SpendingPolicy } from '../db/schema.js';

export type PolicyRejectionCode =
  | 'no_policy'
  | 'category_not_allowed'
  | 'over_max_per_deal'
  | 'over_total_budget'
  | 'over_max_per_day'
  | 'insufficient_funds';

export type PolicyDecision =
  | { ok: true }
  | { ok: false; code: PolicyRejectionCode; message: string };

/** Дефолт для самозарегистрированных покупателей — тот же, что у демо-пользователя в seed. */
export const DEFAULT_BUYER_POLICY = {
  maxPerDeal: 7500,   // 75 $
  maxPerDay: 10000,   // 100 $
  totalBudget: 10000, // 100 $
  allowedCategories: ['paper', 'writing', 'water', 'office'],
} as const;

export class PolicyService {
  constructor(private readonly db: Db) {}

  /** Регистрация нового buyer: политика по умолчанию, существующую не трогаем. */
  async ensureDefaultPolicy(userId: string): Promise<void> {
    await this.db.insert(spendingPolicies)
      .values({ userId, ...DEFAULT_BUYER_POLICY, allowedCategories: [...DEFAULT_BUYER_POLICY.allowedCategories] })
      .onConflictDoNothing();
  }

  async setPolicy(policy: SpendingPolicy): Promise<void> {
    await this.db.insert(spendingPolicies).values(policy)
      .onConflictDoUpdate({ target: spendingPolicies.userId, set: policy });
  }

  async getPolicy(userId: string): Promise<SpendingPolicy | undefined> {
    const [p] = await this.db.select().from(spendingPolicies).where(eq(spendingPolicies.userId, userId));
    return p;
  }

  /**
   * Проверка в момент холда, в той же транзакции (концепт 3.1).
   * Дневной расход (B6): HOLD + CAPTURE_OUT - HOLD_RELEASE за календарный день UTC.
   * totalBudget: та же формула за всё время.
   */
  async check(
    tx: Tx | Db,
    input: { userId: string; walletId: string; amount: number; categories: string[]; now: Date },
  ): Promise<PolicyDecision> {
    const [policy] = await tx.select().from(spendingPolicies).where(eq(spendingPolicies.userId, input.userId));
    if (!policy) return { ok: false, code: 'no_policy', message: `no spending policy for user ${input.userId}` };

    const outside = input.categories.filter((c) => !policy.allowedCategories.includes(c));
    if (outside.length > 0) {
      return { ok: false, code: 'category_not_allowed',
        message: `categories [${outside.join(', ')}] not in allowed [${policy.allowedCategories.join(', ')}]` };
    }

    if (input.amount > policy.maxPerDeal) {
      return { ok: false, code: 'over_max_per_deal',
        message: `amount ${input.amount} > maxPerDeal ${policy.maxPerDeal}` };
    }

    const spentExpr = sql<string>`coalesce(sum(
      CASE type WHEN 'HOLD' THEN amount WHEN 'CAPTURE_OUT' THEN amount WHEN 'HOLD_RELEASE' THEN -amount ELSE 0 END
    ), 0)`;

    const totalRes = await tx.execute(sql`
      SELECT ${spentExpr} AS spent FROM ledger_entries WHERE wallet_id = ${input.walletId}
    `);
    const totalSpent = Number((totalRes.rows[0] as { spent: string }).spent);
    if (totalSpent + input.amount > policy.totalBudget) {
      return { ok: false, code: 'over_total_budget',
        message: `spent ${totalSpent} + ${input.amount} > totalBudget ${policy.totalBudget}` };
    }

    const dayStart = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayRes = await tx.execute(sql`
      SELECT ${spentExpr} AS spent FROM ledger_entries
      WHERE wallet_id = ${input.walletId} AND created_at >= ${dayStart} AND created_at < ${dayEnd}
    `);
    const daySpent = Number((dayRes.rows[0] as { spent: string }).spent);
    if (daySpent + input.amount > policy.maxPerDay) {
      return { ok: false, code: 'over_max_per_day',
        message: `today ${daySpent} + ${input.amount} > maxPerDay ${policy.maxPerDay}` };
    }

    return { ok: true };
  }
}
