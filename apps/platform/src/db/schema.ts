import { bigint, bigserial, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const LEDGER_ENTRY_TYPES = ['DEPOSIT', 'HOLD', 'HOLD_RELEASE', 'CAPTURE_OUT', 'CAPTURE_IN', 'REFUND'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerType: text('owner_type').$type<'user' | 'provider' | 'platform'>().notNull(),
  ownerId: text('owner_id').notNull(),
  currency: text('currency').notNull().default('USD'),
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  held: bigint('held', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('wallets_owner_idx').on(t.ownerType, t.ownerId)]);
export type Wallet = typeof wallets.$inferSelect;

export const ledgerEntries = pgTable('ledger_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id),
  type: text('type').$type<LedgerEntryType>().notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  dealId: text('deal_id'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [index('ledger_entries_wallet_created_idx').on(t.walletId, t.createdAt)]);
export type LedgerEntry = typeof ledgerEntries.$inferSelect;

export const spendingPolicies = pgTable('spending_policies', {
  userId: text('user_id').primaryKey(),
  maxPerDeal: bigint('max_per_deal', { mode: 'number' }).notNull(),
  maxPerDay: bigint('max_per_day', { mode: 'number' }).notNull(),
  totalBudget: bigint('total_budget', { mode: 'number' }).notNull(),
  allowedCategories: text('allowed_categories').array().notNull(),
});
export type SpendingPolicy = typeof spendingPolicies.$inferSelect;
