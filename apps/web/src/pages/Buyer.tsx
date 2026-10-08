import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, usd, type EventView, type ReqView, type TaskView, type WalletView } from '../api';
import { EventFeed } from '../components/EventFeed';
import { navigate } from '../router';
import { WalletSummary } from './Wallet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
export const TASK_BADGE: Record<TaskView['status'], BadgeVariant> = {
  OPEN: 'outline', SOURCING: 'default', DECIDING: 'default', ORDERED: 'warning', DONE: 'success', FAILED: 'destructive',
};

/** Buyer home: wallet at a glance, a task born from plain text (N1), live activity. */
export function BuyerPage({ events }: { events: EventView[] }) {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [text, setText] = useState('Order 5 packs of A4 paper and 10 blue pens within 3 days, budget 100 dollars');
  const [preview, setPreview] = useState<{ request: ReqView; assumptions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const domainCount = events.filter((e) => e.kind === 'domain').length;
  useEffect(() => {
    void api<WalletView>('GET', '/wallets/me').then(setWallet).catch(() => {});
    void api<{ tasks: TaskView[] }>('GET', '/tasks').then((r) => setTasks(r.tasks)).catch(() => {});
  }, [domainCount]);

  const parse = async () => {
    setBusy(true); setErr(''); setPreview(null);
    try {
      setPreview(await api<{ request: ReqView; assumptions: string[] }>('POST', '/tasks/parse', { text }));
    } catch (e) { setErr(`Could not parse: ${String(e)}`); } finally { setBusy(false); }
  };

  const create = async () => {
    if (!preview) return;
    setBusy(true); setErr('');
    try {
      const { task } = await api<{ task: TaskView }>('POST', '/tasks', { request: preview.request });
      setPreview(null);
      navigate(`/task/${task.id}`);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[400px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Wallet</CardTitle>
            <a href="#/wallet" className="text-xs text-primary hover:underline">top up →</a>
          </CardHeader>
          <CardContent><WalletSummary wallet={wallet} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New task</CardTitle>
            <CardDescription>Tell your agent what to buy — it fills in the structure.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button disabled={busy || !text.trim()} onClick={() => void parse()}>
                <Sparkles /> Fill from text
              </Button>
              {preview && <Button variant="secondary" disabled={busy} onClick={() => void create()}>Create task</Button>}
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            {preview && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.request.items.map((it, i) => (
                      <TableRow key={i}>
                        <TableCell>{it.itemQuery}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity} {it.unit}</TableCell>
                        <TableCell><Badge variant="secondary">{it.category}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs">
                  Budget <b>{usd(preview.request.budget.max)}</b>{' '}
                  {preview.request.budget.source === 'estimated' && <Badge variant="warning">agent estimate</Badge>}
                  {' · '}Deadline <b>{new Date(preview.request.deadline).toLocaleString('en-GB')}</b>
                </p>
                {preview.assumptions.map((a, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    <Badge variant="warning">ASSUMPTION</Badge> {a}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {!tasks.length && <div className="py-4 text-center text-sm text-muted-foreground">No tasks yet.</div>}
            {tasks.map((t) => (
              <a key={t.id} href={`#/task/${t.id}`}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/50">
                <Badge variant={TASK_BADGE[t.status]}>{t.status}</Badge>
                <span className="min-w-0 flex-1 truncate">
                  {t.request.items.map((i) => i.itemQuery).join(', ') || t.id}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{usd(t.request.budget.max)}</span>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live activity</CardTitle>
          <CardDescription>Your tasks and money. Other agents’ internals stay hidden — filtered on the server.</CardDescription>
        </CardHeader>
        <CardContent><EventFeed events={events} showTask /></CardContent>
      </Card>
    </div>
  );
}
