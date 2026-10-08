import type { Clock, EventWriter, NewEvent, StoredEvent } from '@fdtd/shared';
import type { Db } from '../db/client.js';
import { events } from '../db/schema.js';

/** Все сервисы и оба агента пишут сюда; id монотонный — курсор SSE (3.8, B14). */
export class PgEventWriter implements EventWriter {
  constructor(private readonly db: Db, private readonly clock: Clock) {}

  async emit(e: NewEvent): Promise<StoredEvent> {
    const [row] = await this.db.insert(events).values({
      ts: this.clock.now(),
      kind: e.kind,
      actor: e.actor,
      type: e.type,
      runId: e.runId,
      taskId: e.taskId,
      dealId: e.dealId,
      providerId: e.providerId,
      userId: e.userId,
      payload: e.payload ?? {},
      correlationId: e.correlationId,
    }).returning();
    return rowToStored(row!);
  }
}

export function rowToStored(row: typeof events.$inferSelect): StoredEvent {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    kind: row.kind,
    actor: row.actor,
    type: row.type,
    runId: row.runId ?? undefined,
    taskId: row.taskId ?? undefined,
    dealId: row.dealId ?? undefined,
    providerId: row.providerId ?? undefined,
    userId: row.userId ?? undefined,
    payload: row.payload,
    correlationId: row.correlationId ?? undefined,
  };
}
