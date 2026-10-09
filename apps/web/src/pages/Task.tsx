import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, usd, type DealView, type ProviderView, type TaskView } from '../api';
import { EventFeed } from '../components/EventFeed';
import { useEvents } from '../useEvents';
import { TASK_BADGE } from './Buyer';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
const DEAL_BADGE: Record<string, BadgeVariant> = {
  QUOTED: 'outline', HELD: 'default', ORDER_PLACED: 'warning', PROOF_RECEIVED: 'default',
  SETTLED: 'success', REJECTED_BY_POLICY: 'destructive', CANCELLED: 'destructive',
};
/* Человеческая подпись к статусу сделки — бейдж остаётся, подпись объясняет */
const DEAL_LABEL: Record<string, string> = {
  QUOTED: 'quote received', HELD: 'funds held', ORDER_PLACED: 'order sent to store',
  PROOF_RECEIVED: 'delivery proof received', SETTLED: 'paid & settled',
  REJECTED_BY_POLICY: 'blocked by policy', CANCELLED: 'cancelled',
};
/* Сделка «в игре» (деньги захолдированы или дальше) — подсвечиваем карточку */
const ACTIVE_DEAL = new Set(['HELD', 'ORDER_PLACED', 'PROOF_RECEIVED', 'SETTLED']);

const STEPS: Array<{ label: string; at: Array<TaskView['status']> }> = [
  { label: 'Task created', at: ['OPEN'] },
  { label: 'Collecting quotes', at: ['SOURCING'] },
  { label: 'Choosing offer', at: ['DECIDING'] },
  { label: 'Ordered & funds held', at: ['ORDERED'] },
  { label: 'Delivered & settled', at: ['DONE'] },
];

/** Горизонтальный степпер: за 2 секунды видно, где находится задача (видео 90s). */
function TaskStepper({ status }: { status: TaskView['status'] }) {
  const current = status === 'DONE' ? STEPS.length
    : Math.max(0, STEPS.findIndex((s) => s.at.includes(status)));
  const failed = status === 'FAILED';
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {STEPS.map((s, i) => {
        const done = i < current || status === 'DONE';
        const now = i === current && !done && !failed;
        return (
          <div key={s.label} className="flex min-w-0 flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-col items-center gap-1 text-center">
              <div className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold
                ${done ? 'border-success bg-success text-white'
                  : now ? 'border-primary bg-primary text-primary-foreground animate-pulse'
                  : failed && i === current ? 'border-destructive bg-destructive text-white'
                  : 'bg-muted text-muted-foreground'}`}>
                {done ? <Check className="size-3.5" /> : failed && i === current ? <X className="size-3.5" /> : i + 1}
              </div>
              <span className={`text-[11px] leading-tight ${now ? 'font-semibold' : 'text-muted-foreground'}`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`mb-4 h-px flex-1 ${done ? 'bg-success' : 'bg-border'}`} />}
          </div>
        );
      })}
    </div>
  );
}

/** Task view: progress stepper, quotes per store (by name), a live event timeline. */
export function TaskPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [deals, setDeals] = useState<DealView[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderView>>({});
  const events = useEvents({ taskId });

  useEffect(() => {
    void api<ProviderView[]>('GET', '/providers')
      .then((ps) => setProviders(Object.fromEntries(ps.map((p) => [p.id, p]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!taskId) return;
    void api<{ task: TaskView; deals: DealView[] }>('GET', `/tasks/${taskId}`)
      .then((r) => { setTask(r.task); setDeals(r.deals); })
      .catch(() => {});
  }, [taskId, events.length]);

  if (!task) return <div className="py-10 text-center text-sm text-muted-foreground">Loading task…</div>;

  const storeName = (id: string) => providers[id]?.name ?? id;
  /* Победившая сделка первой — глазу не нужно искать */
  const sorted = [...deals].sort((a, b) => Number(ACTIVE_DEAL.has(b.status)) - Number(ACTIVE_DEAL.has(a.status)));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{task.request.items.map((i) => i.itemQuery).join(', ')}</CardTitle>
            <Badge variant={TASK_BADGE[task.status]}>{task.status}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Budget {usd(task.request.budget.max)}{task.request.budget.source === 'estimated' && ' (agent estimate)'}
            {' · '}deadline {new Date(task.request.deadline).toLocaleString('en-GB')}
            {' · '}deliver to {task.request.deliveryAddress}
            {task.failReason && <span className="text-destructive"> · reason: {task.failReason}</span>}
          </div>
        </CardHeader>
        <CardContent className="pt-0"><TaskStepper status={task.status} /></CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-4">
          {sorted.map((d) => (
            <Card key={d.id} className={ACTIVE_DEAL.has(d.status) ? 'border-primary/60 shadow-md' : undefined}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>{storeName(d.providerId)}</CardTitle>
                  <Badge variant={DEAL_BADGE[d.status] ?? 'outline'}>{d.status}</Badge>
                  <span className="ml-auto font-semibold tabular-nums">{usd(d.quote.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {DEAL_LABEL[d.status] ?? d.status}
                  {' · '}delivery by {new Date(d.quote.deliveryEta).toLocaleDateString('en-GB')}
                  {providers[d.providerId] && <> · rating {providers[d.providerId].rating.toFixed(1)}</>}
                  {d.cancelReason && <span className="text-destructive"> · {d.cancelReason}</span>}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {d.quote.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.title}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.quantity} × {usd(l.unitPrice)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{usd(l.lineTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {!deals.length && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              No quotes yet — the agent is asking stores.
            </CardContent></Card>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>Task timeline</CardTitle></CardHeader>
          <CardContent><EventFeed events={events} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
