import type { Quote, Req } from '@fdtd/contracts';
import type { NewEvent } from '@fdtd/shared';

/** K3: что агент-заказчик умеет спросить/сказать площадке. HTTP-реализация — S7. */

export interface TaskView {
  id: string;
  userId: string;
  request: Req;
  excludedProviderIds: string[];
  status: string;
}

export interface UserView {
  deliveryAddress: string;
  preferences: { preferredProviderIds: string[]; notes?: string };
}

export interface PolicyView {
  maxPerDeal: number;   // центы
  available: number;    // центы
}

export interface ProviderView {
  id: string;
  name: string;
  rating: number; // 0–5
}

/** Результат request_quotes: платформа уже создала Deal на каждую оферту (K2). */
export type QuoteOutcomeView =
  | { providerId: string; ok: true; dealId: string; quote: Quote }
  | { providerId: string; ok: false; refusal?: string; error?: string };

export type AcceptResult = { ok: true } | { ok: false; reason: string };

export interface BuyerPlatformPort {
  getTask(taskId: string): Promise<{ task: TaskView; user: UserView; policy: PolicyView }>;
  updateBudget(taskId: string, budget: Req['budget']): Promise<void>;
  findProviders(categories: Req['categories'], excludeIds: string[]): Promise<ProviderView[]>;
  requestQuotes(taskId: string, providerIds: string[]): Promise<QuoteOutcomeView[]>;
  acceptQuote(dealId: string): Promise<AcceptResult>;
  failTask(taskId: string, reason: string, details?: Record<string, string>): Promise<void>;
  event(e: NewEvent): Promise<void>;
}
