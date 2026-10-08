import { useEffect, useState } from 'react';
import { api, usd, type DealView, type TaskView } from '../api';
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

/** Task view: status, quotes per deal, a live event timeline. */
export function TaskPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [deals, setDeals] = useState<DealView[]>([]);
  const events = useEvents({ taskId });

  useEffect(() => {
    if (!taskId) return;
    void api<{ task: TaskView; deals: DealView[] }>('GET', `/tasks/${taskId}`)
      .then((r) => { setTask(r.task); setDeals(r.deals); })
      .catch(() => {});
  }, [taskId, events.length]);

  if (!task) return <div className="py-10 text-center text-sm text-muted-foreground">Loading task {taskId}…</div>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{task.request.items.map((i) => i.itemQuery).join(', ')}</CardTitle>
            <Badge variant={TASK_BADGE[task.status]}>{task.status}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Budget {usd(task.request.budget.max)}{task.request.budget.source === 'estimated' && ' (estimate)'}
            {' · '}deadline {new Date(task.request.deadline).toLocaleString('en-GB')}
            {' · '}deliver to {task.request.deliveryAddress}
            {task.failReason && <span className="text-destructive"> · reason: {task.failReason}</span>}
          </div>
        </CardHeader>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-4">
          {deals.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>{d.providerId}</CardTitle>
                  <Badge variant={DEAL_BADGE[d.status] ?? 'outline'}>{d.status}</Badge>
                  <span className="ml-auto font-semibold tabular-nums">{usd(d.quote.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  delivery by {new Date(d.quote.deliveryEta).toLocaleDateString('en-GB')}
                  {d.cancelReason && <span className="text-destructive"> · {d.cancelReason}</span>}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {d.quote.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {l.title} <span className="font-mono text-[11px] text-muted-foreground">{l.sku}</span>
                        </TableCell>
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
              No deals yet — the agent is collecting quotes.
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
