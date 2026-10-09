import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, fmtTs, usd, type AdminOverview, type EventView, type TaskView } from '../api';
import { EventRow, actorLabel, summary } from '../components/EventFeed';
import { TASK_BADGE } from '../components/EventFeed';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function Filter({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border bg-card px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Журнал, сгруппированный по задачам: заголовок — что покупали и статус, внутри — события. */
function GroupedJournal({ events, tasks }: { events: EventView[]; tasks: Map<string, TaskView> }) {
  const groups = useMemo(() => {
    const m = new Map<string, EventView[]>();
    for (const e of events) {
      const k = e.taskId ?? '';
      const list = m.get(k);
      if (list) list.push(e); else m.set(k, [e]);
    }
    return [...m.entries()]
      .map(([id, evs]) => ({ taskId: id, events: evs, last: evs[evs.length - 1].id }))
      .sort((a, b) => b.last - a.last);
  }, [events]);

  return (
    <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
      {groups.map((g) => {
        const t = tasks.get(g.taskId);
        return (
          <div key={g.taskId || 'platform'} className="rounded-xl border bg-muted/20 p-2">
            <div className="flex flex-wrap items-center gap-2 px-1 pb-2 pt-1">
              {g.taskId ? (
                <>
                  <span className="text-sm font-semibold">
                    {t ? t.request.items.map((i) => i.itemQuery).join(', ') : 'Task'}
                  </span>
                  {t && <Badge variant={TASK_BADGE[t.status]}>{t.status}</Badge>}
                  <a className="text-xs text-primary hover:underline" href={`#/task/${g.taskId}`}>open →</a>
                </>
              ) : (
                <span className="text-sm font-semibold">Platform events</span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">{g.events.length} events</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {[...g.events].reverse().map((e) => <EventRow key={e.id} e={e} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BuyersTable({ rows }: { rows: AdminOverview['buyers'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead className="text-right">Wallet</TableHead>
          <TableHead>Tasks</TableHead>
          <TableHead>Spending policy</TableHead>
          <TableHead>Last activity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={b.id}>
            <TableCell>
              <div className="font-medium">{b.name}</div>
              <div className="text-xs text-muted-foreground">{b.email}</div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <div className="font-semibold">{usd(b.balance)}</div>
              {b.held > 0 && <div className="text-xs text-warning">on hold {usd(b.held)}</div>}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {b.tasks.done > 0 && <Badge variant="success">{b.tasks.done} done</Badge>}
                {b.tasks.active > 0 && <Badge>{b.tasks.active} active</Badge>}
                {b.tasks.failed > 0 && <Badge variant="destructive">{b.tasks.failed} failed</Badge>}
                {b.tasks.total === 0 && <span className="text-xs text-muted-foreground">no tasks yet</span>}
              </div>
            </TableCell>
            <TableCell className="text-xs">
              {b.policy ? (
                <>
                  <div>{usd(b.policy.maxPerDeal)} per deal · {usd(b.policy.maxPerDay)} per day</div>
                  <div className="text-muted-foreground">{b.policy.allowedCategories.join(', ')}</div>
                </>
              ) : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {b.lastTaskAt ? fmtTs(b.lastTaskAt) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProvidersTable({ rows }: { rows: AdminOverview['providers'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Store</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead>Categories</TableHead>
          <TableHead className="text-right">Earned</TableHead>
          <TableHead>Deals</TableHead>
          <TableHead>Last deal</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {!p.active && <Badge variant="outline">inactive</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">agent · {p.agentUrl}</div>
            </TableCell>
            <TableCell><Badge variant={p.rating >= 4 ? 'success' : 'warning'}>{p.rating.toFixed(2)}</Badge></TableCell>
            <TableCell className="text-xs">{p.categories.join(', ')}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{usd(p.earned)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {p.deals.settled > 0 && <Badge variant="success">{p.deals.settled} settled</Badge>}
                {p.deals.cancelled > 0 && <Badge variant="destructive">{p.deals.cancelled} cancelled</Badge>}
                {p.deals.total - p.deals.settled - p.deals.cancelled > 0 &&
                  <Badge variant="outline">{p.deals.total - p.deals.settled - p.deals.cancelled} quoted</Badge>}
                {p.deals.total === 0 && <span className="text-xs text-muted-foreground">no deals yet</span>}
              </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {p.lastDealAt ? fmtTs(p.lastDealAt) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Admin: journal (grouped by task), customers, providers, demo reset. */
export function AdminPage({ events }: { events: EventView[] }) {
  const [kind, setKind] = useState('');
  const [actor, setActor] = useState('');
  const [type, setType] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [taskList, setTaskList] = useState<TaskView[]>([]);

  const domainCount = events.filter((e) => e.kind === 'domain').length;
  useEffect(() => {
    void api<AdminOverview>('GET', '/admin/overview').then(setOverview).catch(() => {});
    void api<{ tasks: TaskView[] }>('GET', '/tasks').then((r) => setTaskList(r.tasks)).catch(() => {});
  }, [domainCount]);
  const taskMap = useMemo(() => new Map(taskList.map((t) => [t.id, t])), [taskList]);

  const actors = useMemo(() => [...new Set(events.map((e) => e.actor))].sort(), [events]);
  const types = useMemo(() => [...new Set(events.map((e) => e.type))].sort(), [events]);

  const filtered = events.filter((e) =>
    (!kind || e.kind === kind) && (!actor || e.actor === actor) && (!type || e.type === type));

  /* the latest agent event per actor = "what is it doing right now" (concept 3.8) */
  const now = useMemo(() => {
    const byActor = new Map<string, EventView>();
    for (const e of events) if (e.kind === 'agent') byActor.set(e.actor, e);
    return [...byActor.values()];
  }, [events]);

  const reseed = async () => {
    if (!window.confirm('Reset demo data? Tasks, deals and the journal will be wiped.')) return;
    setBusy(true);
    try { await api('POST', '/dev/seed'); window.location.reload(); } finally { setBusy(false); }
  };

  return (
    <Tabs defaultValue="journal" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="customers">Customers{overview ? ` (${overview.buyers.length})` : ''}</TabsTrigger>
          <TabsTrigger value="providers">Providers{overview ? ` (${overview.providers.length})` : ''}</TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void reseed()}>
          <RotateCcw /> Reset demo
        </Button>
      </div>

      <TabsContent value="journal" className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>Green = working on a task right now; grey = idle, showing its last action.</CardDescription>
          </CardHeader>
          <CardContent>
            {!now.length && <div className="py-4 text-center text-sm text-muted-foreground">Agents are quiet — the journal is empty.</div>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {now.map((e) => {
                /* агент «в работе», пока его задача не терминальна и событие свежее */
                const t = e.taskId ? taskMap.get(e.taskId) : undefined;
                const working = (!t || (t.status !== 'DONE' && t.status !== 'FAILED'))
                  && Date.now() - new Date(e.ts).getTime() < 30_000;
                return (
                  <div key={e.actor} className={`rounded-lg border p-3 ${working ? '' : 'opacity-70'}`}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <span className={`size-2 rounded-full ${working ? 'animate-pulse bg-success' : 'bg-muted-foreground/40'}`} />
                      {actorLabel(e.actor)}
                      {!working && <span className="font-normal text-muted-foreground">idle</span>}
                    </div>
                    <div className="mt-0.5 truncate text-sm" title={summary(e)}>
                      {working ? summary(e) : `last: ${summary(e)}`}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {fmtTs(e.ts)}
                      {e.taskId && <a className="text-primary hover:underline" href={`#/task/${e.taskId}`}> · view task →</a>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-2">
            <Filter value={kind} onChange={setKind} label="kind" options={['domain', 'agent']} />
            <Filter value={actor} onChange={setActor} label="actor" options={actors} />
            <Filter value={type} onChange={setType} label="type" options={types} />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input type="checkbox" className="accent-primary" checked={grouped}
                onChange={(e) => setGrouped(e.target.checked)} />
              group by task
            </label>
            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {events.length}</span>
          </CardHeader>
          <CardContent>
            {grouped
              ? <GroupedJournal events={filtered} tasks={taskMap} />
              : <div className="flex max-h-[65vh] flex-col gap-1.5 overflow-y-auto pr-1">
                  {[...filtered].reverse().map((e) => <EventRow key={e.id} e={e} showTask />)}
                </div>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="customers">
        <Card>
          <CardHeader><CardTitle>Customers</CardTitle></CardHeader>
          <CardContent>
            {overview?.buyers.length
              ? <BuyersTable rows={overview.buyers} />
              : <div className="py-8 text-center text-sm text-muted-foreground">No customers yet.</div>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="providers">
        <Card>
          <CardHeader><CardTitle>Providers</CardTitle></CardHeader>
          <CardContent>
            {overview?.providers.length
              ? <ProvidersTable rows={overview.providers} />
              : <div className="py-8 text-center text-sm text-muted-foreground">No providers yet.</div>}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
