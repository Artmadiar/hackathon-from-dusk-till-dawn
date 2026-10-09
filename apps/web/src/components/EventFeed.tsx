import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { EventView, TaskView } from '../api';
import { fmtTs, usd } from '../api';
import { Badge } from '@/components/ui/badge';

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'simulated';

/* Статусы задач — в одном месте: ими красятся списки, степпер и группы ленты */
export const TASK_BADGE: Record<TaskView['status'], BadgeVariant> = {
  OPEN: 'outline', SOURCING: 'default', DECIDING: 'default', ORDERED: 'warning', DONE: 'success', FAILED: 'destructive',
};

const EVENT_BADGE: Record<string, BadgeVariant> = {
  DEPOSIT: 'success', HOLD_PLACED: 'default', HOLD_RELEASE: 'secondary', CAPTURE: 'success',
  DEAL_SETTLED: 'success', TASK_DONE: 'success', PROVIDER_ONBOARDED: 'success',
  REJECTED_BY_POLICY: 'destructive', TASK_FAILED: 'destructive', DEAL_CANCELLED: 'destructive',
  WEBHOOK_REJECTED: 'destructive', STEP_FAILED: 'destructive',
  OFFER_WITHDRAWN: 'warning', IDEMPOTENT_REPLAY: 'warning', RATING_CHANGED: 'warning', ASSUMPTION: 'warning',
  WAITING: 'default', DECISION: 'default',
};

/** One-line human summary; the raw payload lives in the expandable row. */
export function summary(e: EventView): string {
  const p = e.payload ?? {};
  const amount = typeof p.amount === 'number' ? usd(p.amount) : '';
  switch (e.type) {
    case 'DEPOSIT': return `deposit ${amount}${p.simulated ? '' : ' via Stripe'}`;
    case 'HOLD_PLACED': return `hold ${amount}`;
    case 'HOLD_RELEASE': return `hold released ${amount}`;
    case 'CAPTURE': return `captured ${amount} to provider`;
    case 'TASK_CREATED': return 'task created';
    case 'TASK_DONE': return 'task completed';
    case 'TASK_FAILED': return `task failed: ${String(p.reason ?? '')}`;
    case 'DEAL_QUOTED': return `quote ${typeof p.total === 'number' ? usd(p.total) : ''}`;
    case 'DEAL_ACCEPTED': return 'quote accepted';
    case 'DEAL_SETTLED': return 'deal settled';
    case 'DEAL_CANCELLED': return `deal cancelled: ${String(p.reason ?? '')}`;
    case 'OFFER_WITHDRAWN': return `offer withdrawn: ${String(p.reason ?? '')}`;
    case 'REJECTED_BY_POLICY': return `rejected by policy: ${String(p.reason ?? '')}`;
    case 'ORDER_PLACED': return `store order ${String(p.storeOrderId ?? '')}`;
    case 'PROOF_RECEIVED': return 'proof received';
    case 'RATING_CHANGED': return `rating ${String(p.before ?? '')} → ${String(p.after ?? '')} (${String(p.reason ?? '')})`;
    case 'IDEMPOTENT_REPLAY': return `duplicate ignored: ${String(p.idempotencyKey ?? '')}`;
    case 'PROVIDER_ONBOARDED': return `provider onboarded: ${String(p.name ?? '')}`;
    case 'WEBHOOK_REJECTED': return `webhook rejected: ${String(p.reason ?? '')}`;
    case 'STEP_STARTED': return `step: ${String(p.step ?? '')}`;
    case 'STEP_FAILED': return `step failed: ${String(p.step ?? p.error ?? '')}`;
    case 'TOOL_CALL': return `→ ${String(p.tool ?? '')}`;
    case 'TOOL_RESULT': return `← ${String(p.tool ?? '')}: ${String(p.summary ?? 'ok')}`;
    case 'WAITING': return `waiting: ${String(p.waitingFor ?? '')}`;
    case 'DECISION': {
      const what = p.decision ?? p.reasoning
        ?? (p.scoreTable ? 'quotes evaluated' : p.refusal ? `refused: ${String(p.refusal)}` : String(p.step ?? ''));
      const why = p.reason ? `: ${String(p.reason)}` : p.providerId ? ` (${String(p.providerId)})` : '';
      return `decision: ${String(what)}${why}`;
    }
    default: return e.type;
  }
}

/* Акторы наружу — по-человечески: provider-agent:papirna -> "papirna agent" */
export function actorLabel(actor: string): string {
  if (actor === 'buyer-agent') return 'buyer agent';
  if (actor.startsWith('provider-agent:')) return `${actor.slice('provider-agent:'.length)} agent`;
  return actor;
}

function Until({ until }: { until: string }) {
  const left = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
  return <Badge variant="default">⏳ {left}s</Badge>;
}

export function EventRow({ e, showTask }: { e: EventView; showTask?: boolean }) {
  const p = e.payload ?? {};
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${e.kind === 'agent' ? 'bg-muted/30' : 'bg-card'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11px] tabular-nums text-muted-foreground">{fmtTs(e.ts)}</span>
        <span className="max-w-[160px] truncate text-xs text-muted-foreground" title={e.actor}>{actorLabel(e.actor)}</span>
        <Badge variant={EVENT_BADGE[e.type] ?? 'outline'}>{e.type}</Badge>
        <span className="min-w-0 flex-1 truncate" title={summary(e)}>{summary(e)}</span>
        {e.type === 'WAITING' && typeof p.until === 'string' && <Until until={p.until} />}
        {showTask && e.taskId && (
          <a className="text-xs text-primary hover:underline" href={`#/task/${e.taskId}`}>view task →</a>
        )}
      </div>
      {Object.keys(p).length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">payload</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-[11px] leading-snug">{JSON.stringify(p, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 13)}…` : id;
}

export function EventFeed({ events, showTask, empty }: { events: EventView[]; showTask?: boolean; empty?: string }) {
  if (!events.length) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{empty ?? 'Nothing yet — events stream in live.'}</div>;
  }
  return (
    <div className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto pr-1">
      {[...events].reverse().map((e) => <EventRow key={e.id} e={e} showTask={showTask} />)}
    </div>
  );
}

/** Сворачиваемая группа; состояние живёт в компоненте — SSE-ререндеры его не сбрасывают. */
function FeedGroup({ title, defaultOpen, children }: {
  title: ReactNode; defaultOpen: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-muted/20">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-accent/40">
        {title}
        <ChevronDown className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="flex flex-col gap-1.5 p-2 pt-0">{children}</div>}
    </div>
  );
}

/** Лента, сгруппированная по задачам: свежая группа раскрыта, остальные — по клику. */
export function GroupedEventFeed({ events, tasks, empty }: {
  events: EventView[]; tasks: Map<string, TaskView>; empty?: string;
}) {
  if (!events.length) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{empty ?? 'Nothing yet — events stream in live.'}</div>;
  }
  const map = new Map<string, EventView[]>();
  for (const e of events) {
    const k = e.taskId ?? '';
    const list = map.get(k);
    if (list) list.push(e); else map.set(k, [e]);
  }
  const groups = [...map.entries()]
    .map(([taskId, evs]) => ({ taskId, events: evs, last: evs[evs.length - 1].id }))
    .sort((a, b) => b.last - a.last);
  return (
    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
      {groups.map((g, i) => {
        const t = tasks.get(g.taskId);
        const title = g.taskId ? (
          <>
            <span className="min-w-0 truncate text-sm font-semibold">
              {t ? t.request.items.map((x) => x.itemQuery).join(', ') : 'Task'}
            </span>
            {t && <Badge variant={TASK_BADGE[t.status]}>{t.status}</Badge>}
            <a className="text-xs text-primary hover:underline" href={`#/task/${g.taskId}`}
              onClick={(e) => e.stopPropagation()}>open →</a>
            <span className="text-[11px] text-muted-foreground">{g.events.length}</span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold">Wallet & platform</span>
            <span className="text-[11px] text-muted-foreground">{g.events.length}</span>
          </>
        );
        return (
          <FeedGroup key={g.taskId || 'platform'} title={title} defaultOpen={i === 0}>
            {[...g.events].reverse().map((e) => <EventRow key={e.id} e={e} />)}
          </FeedGroup>
        );
      })}
    </div>
  );
}
