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
    case 'TASK_FAILED': return `task failed: ${slug(String(p.reason ?? ''))}`;
    case 'DEAL_QUOTED': return `quote ${typeof p.total === 'number' ? usd(p.total) : ''}`;
    case 'DEAL_ACCEPTED': return 'quote accepted';
    case 'DEAL_SETTLED': return 'deal settled';
    case 'DEAL_CANCELLED': return `deal cancelled: ${slug(String(p.reason ?? ''))}`;
    case 'OFFER_WITHDRAWN': return `offer withdrawn: ${slug(String(p.reason ?? ''))}`;
    case 'REJECTED_BY_POLICY': return `rejected by policy: ${slug(String(p.reason ?? p.code ?? ''))}`;
    case 'ORDER_PLACED': return `store order ${shortId(String(p.storeOrderRef ?? p.storeOrderId ?? ''))}`;
    case 'PROOF_RECEIVED': return 'proof received';
    case 'ASSUMPTION': return String(p.assumption ?? 'assumption');
    case 'RATING_CHANGED': return `rating ${String(p.before ?? '')} → ${String(p.after ?? '')}`;
    case 'IDEMPOTENT_REPLAY': return `duplicate ignored: ${String(p.idempotencyKey ?? '')}`;
    case 'PROVIDER_ONBOARDED': return `provider onboarded: ${String(p.name ?? '')}`;
    case 'WEBHOOK_REJECTED': return `webhook rejected: ${slug(String(p.reason ?? ''))}`;
    case 'STEP_STARTED': return `step: ${slug(String(p.step ?? ''))}`;
    case 'STEP_FAILED': return `step failed: ${slug(String(p.step ?? p.error ?? ''))}`;
    case 'TOOL_CALL': return `calling ${slug(String(p.tool ?? ''))}…`;
    case 'TOOL_RESULT': return `${slug(String(p.tool ?? ''))}: ${slug(String(p.summary ?? 'done'))}`;
    case 'WAITING': return `waiting for ${slug(String(p.for ?? p.waitingFor ?? ''))}`;
    case 'DECISION': {
      const what = p.decision ?? p.reasoning
        ?? (p.scoreTable ? 'quotes evaluated' : p.refusal ? `refused: ${String(p.refusal)}` : String(p.step ?? ''));
      const why = p.reason ? `: ${slug(String(p.reason))}` : p.providerId ? ` (${String(p.providerId)})` : '';
      return `decision: ${slug(String(what))}${why}`;
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

/* Технические slug'и -> читаемый текст: out_of_stock -> "out of stock" */
export function slug(v: string): string {
  return v.replace(/[_:]/g, ' ').trim();
}

const MONEY_KEYS = new Set(['amount', 'total', 'max', 'unitPrice', 'lineTotal', 'budget']);
const NOISE_KEYS = new Set(['entryId', 'walletId', 'idempotencyKey', 'correlationId', 'step', 'tool', 'dealId', 'providerId', 'runId', 'taskId']);
const looksLikeIso = (v: string) => /^\d{4}-\d{2}-\d{2}T/.test(v);

/** Куратор деталей: payload -> человеческое дополнение карточки. null = нечего добавить. */
function EventDetail({ e }: { e: EventView }) {
  const p = e.payload ?? {};
  const line = (text: string, key?: string) => (
    <div key={key ?? text} className="text-xs text-muted-foreground">{text}</div>
  );
  switch (e.type) {
    case 'DECISION': {
      const rows = Array.isArray(p.scoreTable) ? p.scoreTable as Array<Record<string, unknown>> : null;
      if (rows) {
        const excluded = Array.isArray(p.excluded) ? p.excluded as Array<Record<string, unknown>> : [];
        return (
          <div className="mt-1 flex flex-col gap-1">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-0.5 pr-2 font-medium">store</th>
                <th className="py-0.5 pr-2 text-right font-medium">total</th>
                <th className="py-0.5 pr-2 text-right font-medium">rating</th>
                <th className="py-0.5 text-right font-medium">score</th>
              </tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} className={i === 0 ? 'font-semibold' : 'text-muted-foreground'}>
                  <td className="py-0.5 pr-2">{String(r.providerId)}{i === 0 ? ' ←' : ''}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{typeof r.total === 'number' ? usd(r.total) : '—'}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{typeof r.rating === 'number' ? r.rating.toFixed(2) : '—'}</td>
                  <td className="py-0.5 text-right tabular-nums">{typeof r.score === 'number' ? r.score.toFixed(2) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            {excluded.map((x, i) => {
              const base = `excluded ${String(x.providerId)}: ${slug(String(x.reason ?? ''))}`;
              const why = x.reason === 'price_anomaly' && typeof x.total === 'number' && typeof x.limit === 'number'
                ? ` — quote ${usd(x.total)} is over the sanity cap ${usd(x.limit)} (2× the estimated budget)`
                : typeof x.total === 'number' ? ` (quote ${usd(x.total)})` : '';
              return line(base + why, `x${i}`);
            })}
          </div>
        );
      }
      const bits: string[] = [];
      if (typeof p.reasoning === 'string') bits.push(p.reasoning);
      const budget = p.budget as { max?: number } | undefined;
      if (budget && typeof budget.max === 'number') bits.push(`budget cap ${usd(budget.max)}`);
      if (typeof p.reason === 'string') bits.push(slug(p.reason));
      return bits.length ? <div className="mt-0.5">{bits.map((b) => line(b))}</div> : null;
    }
    case 'REJECTED_BY_POLICY':
      return typeof p.message === 'string' ? line(p.message) : null;
    case 'DEAL_QUOTED':
      return typeof p.deliveryEta === 'string'
        ? line(`delivery by ${new Date(p.deliveryEta).toLocaleDateString('en-GB')}`) : null;
    case 'WAITING':
      return typeof p.storeOrderId === 'string' ? line(`store order ${p.storeOrderId.slice(0, 12)}…`) : null;
    case 'RATING_CHANGED':
      return typeof p.reason === 'string' ? line(`why: ${slug(p.reason)}`) : null;
    case 'TASK_CREATED': {
      const cats = Array.isArray(p.categories) ? (p.categories as string[]).join(', ') : '';
      return line(`categories: ${cats || '—'} · created via ${String(p.createdVia ?? 'ui').toUpperCase()}`);
    }
    case 'PROVIDER_ONBOARDED': {
      const cats = Array.isArray(p.categories) ? (p.categories as string[]).join(', ') : '';
      return line(`starting rating ${String(p.rating ?? '—')} · categories: ${cats}`);
    }
    case 'TOOL_RESULT':
      if (typeof p.lowUsd === 'number' && typeof p.highUsd === 'number') {
        return line(`market estimate $${p.lowUsd}–$${p.highUsd}`);
      }
      break;
    case 'TOOL_CALL':
      if (Array.isArray(p.items)) return line(`items: ${(p.items as string[]).join(', ')}`);
      break;
    case 'OFFER_WITHDRAWN':
    case 'DEAL_CANCELLED':
    case 'TASK_FAILED':
    case 'REJECTED_BY_POLICY':
    case 'WEBHOOK_REJECTED':
    case 'STEP_FAILED':
      return null; /* причина уже в summary */
    case 'DEPOSIT': case 'HOLD_PLACED': case 'HOLD_RELEASE': case 'CAPTURE':
    case 'DEAL_SETTLED': case 'DEAL_ACCEPTED': case 'TASK_DONE': case 'PROOF_RECEIVED':
    case 'ORDER_PLACED': case 'ASSUMPTION': case 'STEP_STARTED': case 'IDEMPOTENT_REPLAY':
      return null; /* summary уже говорит всё */
    default:
      break;
  }
  /* Фоллбэк для незнакомых типов: примитивные поля без технического шума */
  const rest = Object.entries(p)
    .filter(([k, v]) => !NOISE_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => {
      const label = slug(k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
      if (typeof v === 'number' && MONEY_KEYS.has(k)) return `${label} ${usd(v)}`;
      if (typeof v === 'string' && looksLikeIso(v)) return `${label} ${new Date(v).toLocaleString('en-GB')}`;
      if (typeof v === 'string' && v.length > 24) return `${label}: ${shortId(v)}`;
      return `${label}: ${String(v)}`;
    });
  return rest.length ? <div className="mt-0.5">{rest.map((r) => line(r))}</div> : null;
}

function Until({ until }: { until: string }) {
  const left = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
  return <Badge variant="default">⏳ {left}s</Badge>;
}

export function EventRow({ e, showTask, raw }: { e: EventView; showTask?: boolean; raw?: boolean }) {
  const p = e.payload ?? {};
  return (
    <div className={`feed-in rounded-lg border px-3 py-2 text-sm ${e.kind === 'agent' ? 'bg-muted/30' : 'bg-card'}`}>
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
      <EventDetail e={e} />
      {raw && Object.keys(p).length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">raw payload</summary>
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

/** Лента, сгруппированная по задачам. startCollapsed — компактный режим (buyer home). */
export function GroupedEventFeed({ events, tasks, empty, startCollapsed, linkTasks = true }: {
  events: EventView[]; tasks?: Map<string, TaskView>; empty?: string;
  startCollapsed?: boolean; linkTasks?: boolean;
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
        const t = tasks?.get(g.taskId);
        const title = g.taskId ? (
          <>
            <span className="min-w-0 truncate text-sm font-semibold">
              {t ? t.request.items.map((x) => x.itemQuery).join(', ') : `Task ${shortId(g.taskId)}`}
            </span>
            {t && <Badge variant={TASK_BADGE[t.status]}>{t.status}</Badge>}
            {linkTasks && (
              <a className="text-xs text-primary hover:underline" href={`#/task/${g.taskId}`}
                onClick={(e) => e.stopPropagation()}>open →</a>
            )}
            <span className="text-[11px] text-muted-foreground">{g.events.length}</span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold">Wallet & platform</span>
            <span className="text-[11px] text-muted-foreground">{g.events.length}</span>
          </>
        );
        return (
          <FeedGroup key={g.taskId || 'platform'} title={title} defaultOpen={!startCollapsed && i === 0}>
            {[...g.events].reverse().map((e) => <EventRow key={e.id} e={e} />)}
          </FeedGroup>
        );
      })}
    </div>
  );
}
