import type { EventView } from '../api';
import { fmtTs, usd } from '../api';

const BADGE: Record<string, string> = {
  DEPOSIT: 'ok', HOLD_PLACED: 'info', HOLD_RELEASE: 'plain', CAPTURE: 'ok',
  DEAL_SETTLED: 'ok', TASK_DONE: 'ok', PROVIDER_ONBOARDED: 'ok',
  REJECTED_BY_POLICY: 'bad', TASK_FAILED: 'bad', DEAL_CANCELLED: 'bad', WEBHOOK_REJECTED: 'bad',
  OFFER_WITHDRAWN: 'warn', IDEMPOTENT_REPLAY: 'warn', RATING_CHANGED: 'warn',
  WAITING: 'info', DECISION: 'info', ASSUMPTION: 'warn', STEP_FAILED: 'bad',
};

/** Человеческая строка события; остальное — в раскрывашке payload. */
export function summary(e: EventView): string {
  const p = e.payload ?? {};
  const amount = typeof p.amount === 'number' ? usd(p.amount) : '';
  switch (e.type) {
    case 'DEPOSIT': return `пополнение ${amount}${p.simulated ? '' : ' (Stripe)'}`;
    case 'HOLD_PLACED': return `холд ${amount}`;
    case 'HOLD_RELEASE': return `холд снят ${amount}`;
    case 'CAPTURE': return `списание ${amount} исполнителю`;
    case 'TASK_CREATED': return 'задача создана';
    case 'TASK_DONE': return 'задача выполнена';
    case 'TASK_FAILED': return `задача провалена: ${String(p.reason ?? '')}`;
    case 'DEAL_QUOTED': return `оферта ${typeof p.total === 'number' ? usd(p.total) : ''}`;
    case 'DEAL_ACCEPTED': return 'оферта принята';
    case 'DEAL_SETTLED': return 'сделка рассчитана';
    case 'DEAL_CANCELLED': return `сделка отменена: ${String(p.reason ?? '')}`;
    case 'OFFER_WITHDRAWN': return `оферта отозвана: ${String(p.reason ?? '')}`;
    case 'REJECTED_BY_POLICY': return `отказ политики: ${String(p.reason ?? '')}`;
    case 'ORDER_PLACED': return `заказ в магазине ${String(p.storeOrderId ?? '')}`;
    case 'PROOF_RECEIVED': return 'подтверждение получено';
    case 'RATING_CHANGED': return `рейтинг: ${String(p.from ?? '')} → ${String(p.to ?? '')}`;
    case 'IDEMPOTENT_REPLAY': return `повтор отклонён: ${String(p.idempotencyKey ?? '')}`;
    case 'PROVIDER_ONBOARDED': return `исполнитель подключён: ${String(p.name ?? '')}`;
    case 'WEBHOOK_REJECTED': return `webhook отвергнут: ${String(p.reason ?? '')}`;
    case 'STEP_STARTED': return `шаг: ${String(p.step ?? '')}`;
    case 'STEP_FAILED': return `шаг упал: ${String(p.step ?? p.error ?? '')}`;
    case 'TOOL_CALL': return `→ ${String(p.tool ?? '')}`;
    case 'TOOL_RESULT': return `← ${String(p.tool ?? '')}: ${String(p.summary ?? 'ok')}`;
    case 'WAITING': return `ждёт: ${String(p.waitingFor ?? '')}`;
    case 'DECISION': {
      const what = p.decision ?? p.reasoning
        ?? (p.scoreTable ? 'оферты оценены' : p.refusal ? `отказ: ${String(p.refusal)}` : String(p.step ?? ''));
      const why = p.reason ? `: ${String(p.reason)}` : p.providerId ? ` (${String(p.providerId)})` : '';
      return `решение: ${String(what)}${why}`;
    }
    case 'ASSUMPTION': return `допущение: ${String(p.assumption ?? '')}`;
    default: return e.type;
  }
}

function Until({ until }: { until: string }) {
  const left = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
  return <span className="badge info">⏳ {left}s</span>;
}

export function EventRow({ e, showTask }: { e: EventView; showTask?: boolean }) {
  const p = e.payload ?? {};
  return (
    <div className={`event ${e.kind}`}>
      <span className="muted small">{fmtTs(e.ts)}</span>
      <span className="actor" title={e.actor}>{e.actor}</span>
      <span>
        <span className={`badge ${BADGE[e.type] ?? 'plain'}`}>{e.type}</span>{' '}
        {summary(e)}{' '}
        {e.type === 'WAITING' && typeof p.until === 'string' && <Until until={p.until} />}
        {showTask && e.taskId && <a href={`#/task/${e.taskId}`} className="small"> · {e.taskId}</a>}
      </span>
      {Object.keys(p).length > 0 && (
        <details>
          <summary className="muted small">payload</summary>
          <pre>{JSON.stringify(p, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function EventFeed({ events, showTask }: { events: EventView[]; showTask?: boolean }) {
  if (!events.length) return <div className="muted">Пока пусто — события появятся здесь вживую.</div>;
  return (
    <div className="feed">
      {[...events].reverse().map((e) => <EventRow key={e.id} e={e} showTask={showTask} />)}
    </div>
  );
}
