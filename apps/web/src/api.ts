/** Типы и fetch-хелперы; всё через /api (Vite-прокси в платформу). */

export interface IdentityView {
  id: string;
  email: string;
  role: 'buyer' | 'provider' | 'admin';
  name: string;
  providerId: string | null;
  apiKey: string;
}

export interface SessionView {
  id: string;
  activeIdentity: string;
  identities: IdentityView[];
}

export interface WalletView {
  ownerType: string;
  ownerId: string;
  balance: number;
  held: number;
  available: number;
}

export interface TaskView {
  id: string;
  userId: string;
  status: 'OPEN' | 'SOURCING' | 'DECIDING' | 'ORDERED' | 'DONE' | 'FAILED';
  request: ReqView;
  failReason: string | null;
  createdAt: string;
}

export interface ReqView {
  items: Array<{ itemQuery: string; quantity: number; unit: string; category: string }>;
  categories: string[];
  budget: { max: number; source: 'user' | 'estimated' };
  deadline: string;
  deliveryAddress: string;
}

export interface DealView {
  id: string;
  taskId: string;
  providerId: string;
  status: string;
  quote: { total: number; deliveryEta: string; lines: Array<{ sku: string; title: string; unitPrice: number; quantity: number; lineTotal: number }> };
  cancelReason: string | null;
}

export interface EventView {
  id: number;
  ts: string;
  kind: 'domain' | 'agent';
  actor: string;
  type: string;
  runId?: string;
  taskId?: string;
  dealId?: string;
  providerId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
}

export interface ProviderView {
  id: string;
  name: string;
  categories: string[];
  rating: number;
  active: boolean;
}

export interface ProviderDealRow {
  id: string;
  taskId: string;
  providerId: string;
  status: string;
  quote: { total: number; deliveryEta: string; lines: Array<{ sku: string; title: string; unitPrice: number; quantity: number; lineTotal: number }> };
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBuyerRow {
  id: string; name: string; email: string;
  balance: number; held: number;
  tasks: { total: number; done: number; failed: number; active: number };
  lastTaskAt: string | null;
  policy: { maxPerDeal: number; maxPerDay: number; totalBudget: number; allowedCategories: string[] } | null;
}

export interface AdminProviderRow {
  id: string; name: string; categories: string[]; rating: number; active: boolean; agentUrl: string;
  earned: number;
  deals: { total: number; settled: number; cancelled: number };
  lastDealAt: string | null;
}

export interface AdminOverview { buyers: AdminBuyerRow[]; providers: AdminProviderRow[] }

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(`${status}: ${String(body.error ?? 'error')}`);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export const fmtTs = (ts: string): string =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
