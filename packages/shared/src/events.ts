import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

/** Одна таблица событий на домен и агентов (концепт 3.8, U1). */
export type EventKind = 'domain' | 'agent';

export const DOMAIN_EVENT_TYPES = [
  'TASK_CREATED', 'TASK_DONE', 'TASK_FAILED',
  'DEAL_QUOTED', 'DEAL_ACCEPTED', 'REJECTED_BY_POLICY',
  'DEPOSIT', 'HOLD_PLACED', 'HOLD_RELEASE', 'CAPTURE', 'REFUND', 'IDEMPOTENT_REPLAY',
  'ORDER_PLACED', 'PROOF_RECEIVED', 'DEAL_SETTLED', 'DEAL_CANCELLED', 'OFFER_WITHDRAWN',
  'RATING_CHANGED', 'WEBHOOK_REJECTED', 'PROVIDER_ONBOARDED',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const AGENT_EVENT_TYPES = [
  'STEP_STARTED', 'STEP_FAILED', 'TOOL_CALL', 'TOOL_RESULT',
  'WAITING', 'DECISION', 'ASSUMPTION',
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type EventType = DomainEventType | AgentEventType;

/** actor: 'platform' | 'user:{id}' | 'buyer-agent' | 'provider-agent:{providerId}' | 'store:{providerId}' | 'stripe' */
export interface NewEvent {
  kind: EventKind;
  actor: string;
  type: EventType;
  runId?: string;
  taskId?: string;
  dealId?: string;
  providerId?: string;
  userId?: string;
  payload?: unknown;
  correlationId?: string;
}

export interface StoredEvent extends NewEvent {
  id: number; // монотонный, курсор для SSE (B14)
  ts: string;
}

export interface EventWriter {
  emit(e: NewEvent): Promise<StoredEvent>;
}

/** In-memory writer для unit-тестов всех пакетов. */
export class MemoryEventWriter implements EventWriter {
  readonly events: StoredEvent[] = [];
  private seq = 0;

  constructor(private readonly clock: Clock = systemClock) {}

  async emit(e: NewEvent): Promise<StoredEvent> {
    const stored: StoredEvent = { ...e, id: ++this.seq, ts: this.clock.now().toISOString() };
    this.events.push(stored);
    return stored;
  }

  get types(): EventType[] {
    return this.events.map((e) => e.type);
  }
}
