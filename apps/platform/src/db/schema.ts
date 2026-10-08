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

// ── S3: events, registry, tasks, deals ──────────────────────────────

import { boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import type { EventKind, EventType } from '@fdtd/shared';
import type { Proof, Quote, Req } from '@fdtd/contracts';

export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  kind: text('kind').$type<EventKind>().notNull(),
  actor: text('actor').notNull(),
  runId: text('run_id'),
  taskId: text('task_id'),
  dealId: text('deal_id'),
  providerId: text('provider_id'),
  userId: text('user_id'),
  type: text('type').$type<EventType>().notNull(),
  payload: jsonb('payload').notNull().default({}),
  correlationId: text('correlation_id'),
}, (t) => [
  index('events_task_idx').on(t.taskId, t.id),
  index('events_user_idx').on(t.userId, t.id),
]);
export type EventRow = typeof events.$inferSelect;

export const providers = pgTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  agentUrl: text('agent_url').notNull(),
  contractTypeId: text('contract_type_id').notNull().default('office-supplies.v1'),
  categories: text('categories').array().notNull(),
  ratingX100: integer('rating_x100').notNull().default(400),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export type Provider = typeof providers.$inferSelect;

export const TASK_STATUSES = ['OPEN', 'SOURCING', 'DECIDING', 'ORDERED', 'DONE', 'FAILED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  contractTypeId: text('contract_type_id').notNull(),
  request: jsonb('request').$type<Req>().notNull(),
  status: text('status').$type<TaskStatus>().notNull(),
  createdVia: text('created_via').$type<'ui' | 'mcp'>().notNull().default('ui'),
  excludedProviderIds: text('excluded_provider_ids').array().notNull().default([]),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export type Task = typeof tasks.$inferSelect;

export const DEAL_STATUSES = ['QUOTED', 'HELD', 'ORDER_PLACED', 'PROOF_RECEIVED', 'SETTLED', 'REJECTED_BY_POLICY', 'CANCELLED'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const deals = pgTable('deals', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  providerId: text('provider_id').notNull().references(() => providers.id),
  status: text('status').$type<DealStatus>().notNull(),
  quote: jsonb('quote').$type<Quote>().notNull(),
  proof: jsonb('proof').$type<Proof>(),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [index('deals_task_idx').on(t.taskId)]);
export type Deal = typeof deals.$inferSelect;
