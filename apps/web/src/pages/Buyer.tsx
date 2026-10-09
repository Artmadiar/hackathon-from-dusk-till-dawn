import { Activity, ListTodo, Loader2, Plug, Sparkles, Wallet as WalletIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, usd, type EventView, type ReqView, type TaskView, type WalletView } from '../api';
import { GroupedEventFeed, TASK_BADGE } from '../components/EventFeed';
import { navigate } from '../router';
import { WalletSummary } from './Wallet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export { TASK_BADGE };

/** Buyer home: главный фокус — новая задача и список задач; кошелёк и лента — вторым планом. */
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
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

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
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
      {/* Главная колонка: взаимодействие с агентом */}
      <div className="flex flex-col gap-4">
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> New task
            </CardTitle>
            <CardDescription>Describe what you need. The agent drafts a structured request; nothing starts until you confirm.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button variant={preview ? 'secondary' : 'default'} disabled={busy || !text.trim()} onClick={() => void parse()}>
                {busy && !preview ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {busy && !preview ? 'Agent is reading…' : preview ? 'Re-draft' : 'Draft the task'}
              </Button>
              {preview && (
                <>
                  <Button disabled={busy} onClick={() => void create()}>
                    {busy ? <Loader2 className="animate-spin" /> : null} Looks right — start the agent
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>Discard</Button>
                </>
              )}
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            {preview && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <p className="text-xs font-medium">
                  <Badge variant="warning">DRAFT</Badge> This is what the agent understood — it has not
                  started yet. Confirm below or edit the text and re-draft.
                </p>
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
            <p className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
              <Plug className="size-3.5 shrink-0" />
              Not just the UI: any MCP client talks to the same agent — POST /mcp with your API key.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ListTodo className="size-4 text-primary" /> Tasks</CardTitle>
          </CardHeader>
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

      {/* Второй план: кошелёк компактно, лента по задачам */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><WalletIcon className="size-4 text-primary" /> Wallet</CardTitle>
            <a href="#/wallet" className="text-xs text-primary hover:underline">top up →</a>
          </CardHeader>
          <CardContent><WalletSummary wallet={wallet} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-primary" /> Activity
              <span className="ml-1 size-2 animate-pulse rounded-full bg-success" title="live" />
            </CardTitle>
            <CardDescription>Grouped by task — click a group to expand. Only your events reach this feed.</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupedEventFeed events={events} tasks={taskMap} startCollapsed />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
