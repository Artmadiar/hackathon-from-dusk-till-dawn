import { and, asc, eq, gt, inArray, like, not, or, sql, type SQL } from 'drizzle-orm';
import type { StoredEvent } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { events, tasks } from '../db/schema.js';
import { rowToStored } from './writer.js';

/** Идентичность читателя журнала. До S8 приходит из заголовков, потом — из сессии. */
export type Identity =
  | { role: 'admin' }
  | { role: 'buyer'; userId: string }
  | { role: 'provider'; providerId: string };

/**
 * Фильтр по роли — на сервере (R8).
 * Заказчик: события своих задач/кошелька, но не внутренности исполнителей и магазинов.
 * Исполнитель: только свой агент и свои сделки.
 */
export function identityConditions(identity: Identity): SQL[] {
  if (identity.role === 'admin') return [];
  if (identity.role === 'buyer') {
    const ownTask = inArray(events.taskId, sql`(SELECT id FROM tasks WHERE user_id = ${identity.userId})`);
    return [
      or(eq(events.userId, identity.userId), ownTask)!,
      not(and(
        eq(events.kind, 'agent'),
        or(like(events.actor, 'provider-agent:%'), like(events.actor, 'store:%'))!,
      )!),
    ];
  }
  return [
    or(
      eq(events.providerId, identity.providerId),
      eq(events.actor, `provider-agent:${identity.providerId}`),
      eq(events.actor, `store:${identity.providerId}`),
    )!,
  ];
}

export class EventsQuery {
  constructor(private readonly db: Db) {}

  /** Курсор since: строго больше, по возрастанию id — без дублей и пропусков (C29). */
  async list(input: {
    identity: Identity;
    since?: number;
    limit?: number;
    taskId?: string;
  }): Promise<StoredEvent[]> {
    const conds: SQL[] = [gt(events.id, input.since ?? 0), ...identityConditions(input.identity)];
    if (input.taskId) conds.push(eq(events.taskId, input.taskId));
    const rows = await this.db.select().from(events)
      .where(and(...conds))
      .orderBy(asc(events.id))
      .limit(input.limit ?? 200);
    return rows.map(rowToStored);
  }
}
// tasks импортирован, чтобы подзапрос в identityConditions не разошёлся со схемой
void tasks;
