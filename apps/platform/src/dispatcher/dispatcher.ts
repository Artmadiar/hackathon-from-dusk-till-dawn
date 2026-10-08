import { Quote, Req } from '@fdtd/contracts';
import { signJwt, type Clock, type EventWriter } from '@fdtd/shared';
import type { AgentGateway } from '../deals/deal-service.js';

export interface QuoteOutcome {
  providerId: string;
  ok: boolean;
  quote?: Quote;
  refusal?: string;      // исполнитель отказался (нет позиции, ниже минимума)
  error?: string;        // таймаут / сеть / 5xx — не ломает остальных (U7)
}

interface Deps {
  clock: Clock;
  events: EventWriter;
  jwtSecret: string;
  buyerAgentUrl: string;
  quoteTimeoutMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * B1: платформа -> агенты, только HTTP, без очередей.
 * /quote — синхронно, параллельно, allSettled + таймаут (U7).
 * /fulfil, /cancel (K4), /run — 202, результат придёт через API платформы.
 */
export class AgentDispatcher implements AgentGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly quoteTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly inflightRuns = new Map<string, Promise<void>>();

  constructor(private readonly deps: Deps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.quoteTimeoutMs = deps.quoteTimeoutMs ?? 30000;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? 10000;
  }

  /** Параллельный сбор оферт: один мёртвый исполнитель не ломает остальных (U7). */
  async requestQuotes(input: {
    taskId: string;
    request: Req;
    providers: Array<{ id: string; agentUrl: string }>;
    correlationId?: string;
  }): Promise<QuoteOutcome[]> {
    const results = await Promise.allSettled(
      input.providers.map(async (p): Promise<QuoteOutcome> => {
        const res = await this.post(`${p.agentUrl}/quote`, {
          taskId: input.taskId, request: input.request,
        }, { aud: 'provider-agent', timeoutMs: this.quoteTimeoutMs, correlationId: input.correlationId });
        const body = await res.json() as { quote?: unknown; refusal?: string };
        if (!res.ok) return { providerId: p.id, ok: false, error: `http_${res.status}` };
        if (body.refusal || !body.quote) {
          return { providerId: p.id, ok: false, refusal: body.refusal ?? 'no_quote' };
        }
        return { providerId: p.id, ok: true, quote: Quote.parse(body.quote) };
      }),
    );
    return results.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { providerId: input.providers[i]!.id, ok: false, error: String((r.reason as Error).message ?? r.reason) });
  }

  async sendFulfil(input: {
    dealId: string; taskId: string; providerId: string; agentUrl: string; quote: Quote; request: Req;
  }): Promise<void> {
    await this.expect202(
      await this.post(`${input.agentUrl}/fulfil`, {
        dealId: input.dealId, taskId: input.taskId, quote: input.quote, request: input.request,
      }, { aud: 'provider-agent' }),
      `fulfil ${input.dealId} -> ${input.providerId}`,
    );
  }

  /** K4: отмена сделки исполнителю — тот отменит заказ в магазине. */
  async sendCancel(input: { dealId: string; providerId: string; agentUrl: string; reason: string }): Promise<void> {
    await this.expect202(
      await this.post(`${input.agentUrl}/cancel`, { dealId: input.dealId, reason: input.reason },
        { aud: 'provider-agent' }),
      `cancel ${input.dealId} -> ${input.providerId}`,
    );
  }

  /** N1: «заполнить из текста» (S9) и MCP create_task — разбор текста агентом-заказчиком. */
  async parseTask(input: { text: string; deliveryAddress: string; correlationId?: string }):
    Promise<{ request: Req; assumptions: string[] } | { error: string }> {
    const res = await this.post(`${this.deps.buyerAgentUrl}/parse`, {
      text: input.text, deliveryAddress: input.deliveryAddress,
    }, { aud: 'buyer-agent', correlationId: input.correlationId });
    const body = await res.json() as { request?: unknown; assumptions?: string[]; error?: string };
    if (!res.ok || body.error || !body.request) return { error: body.error ?? `http_${res.status}` };
    return { request: Req.parse(body.request), assumptions: body.assumptions ?? [] };
  }

  /** R7: на задачу — один запрос за раз; параллельный вызов приклеивается к летящему. */
  async runBuyer(input: { taskId: string; reason: string }): Promise<void> {
    const existing = this.inflightRuns.get(input.taskId);
    if (existing) return existing;
    const p = (async () => {
      await this.expect202(
        await this.post(`${this.deps.buyerAgentUrl}/run`, input, { aud: 'buyer-agent' }),
        `run ${input.taskId}`,
      );
    })().finally(() => this.inflightRuns.delete(input.taskId));
    this.inflightRuns.set(input.taskId, p);
    return p;
  }

  private async post(
    url: string,
    body: unknown,
    opts: { aud: 'provider-agent' | 'buyer-agent'; timeoutMs?: number; correlationId?: string },
  ): Promise<Response> {
    const token = signJwt({}, this.deps.jwtSecret, {
      iss: 'platform', aud: opts.aud, expiresInSec: 60, clock: this.deps.clock,
    });
    return this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(opts.correlationId ? { 'x-request-id': opts.correlationId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? this.requestTimeoutMs),
    });
  }

  private async expect202(res: Response, what: string): Promise<void> {
    if (res.status !== 202 && !res.ok) throw new Error(`${what}: http ${res.status}`);
  }
}
