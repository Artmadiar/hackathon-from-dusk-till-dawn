import { Bot, ChevronDown, Coins, Handshake, ListTodo, Loader2, RotateCcw, ScrollText, Store, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, fmtTs, usd, type AdminOverview, type CatalogItem, type EventView, type TaskView } from '../api';
import { EventRow, actorLabel, summary } from '../components/EventFeed';
import { TASK_BADGE } from '../components/EventFeed';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
              {[...g.events].reverse().map((e) => <EventRow key={e.id} e={e} raw />)}
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

/** Каталог провайдера живьём — платформа спрашивает его агента при раскрытии. */
function ProviderCatalog({ providerId }: { providerId: string }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void api<{ items: CatalogItem[] }>('GET', `/providers/${providerId}/catalog`)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(String(e)));
  }, [providerId]);
  if (err) return <p className="px-3 py-2 text-xs text-destructive">Agent unreachable: {err}</p>;
  if (!items) return <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Asking the store’s agent…</p>;
  return (
    <div className="grid gap-1 px-3 pb-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.sku} className="flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{it.title}</span>
            {it.description && <span className="text-muted-foreground"> — {it.description}</span>}
          </span>
          {it.category && <Badge variant="secondary">{it.category}</Badge>}
          <span className="shrink-0 font-semibold tabular-nums">{usd(it.price)}<span className="font-normal text-muted-foreground"> / {it.unit}</span></span>
        </div>
      ))}
    </div>
  );
}

/** Строка провайдера: статистика + раскрываемый живой каталог. */
function ProviderBlock({ p }: { p: AdminOverview['providers'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent/40">
        <Store className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-col">
          <span className="font-medium">{p.name}</span>
          <span className="block text-[11px] text-muted-foreground">agent · {p.agentUrl} · {p.categories.join(', ')}</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Badge variant={p.rating >= 4 ? 'success' : 'warning'}>★ {p.rating.toFixed(2)}</Badge>
          {p.deals.settled > 0 && <Badge variant="success">{p.deals.settled} settled</Badge>}
          {p.deals.cancelled > 0 && <Badge variant="destructive">{p.deals.cancelled} cancelled</Badge>}
          {p.deals.total - p.deals.settled - p.deals.cancelled > 0 &&
            <Badge variant="outline">{p.deals.total - p.deals.settled - p.deals.cancelled} quoted</Badge>}
          <span className="font-semibold tabular-nums">{usd(p.earned)}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <ProviderCatalog providerId={p.id} />}
    </div>
  );
}

/** Категории журнала — вместо технических kind/type: смысловые фильтры одним кликом. */
const JOURNAL_CATS: Array<{ key: string; label: string; icon: typeof Coins; types?: string[] }> = [
  { key: 'all', label: 'All', icon: ScrollText },
  { key: 'money', label: 'Money', icon: Coins, types: ['DEPOSIT', 'HOLD_PLACED', 'HOLD_RELEASE', 'CAPTURE'] },
  { key: 'deals', label: 'Deals', icon: Handshake, types: ['DEAL_QUOTED', 'DEAL_ACCEPTED', 'DEAL_SETTLED', 'DEAL_CANCELLED', 'OFFER_WITHDRAWN', 'REJECTED_BY_POLICY'] },
  { key: 'tasks', label: 'Tasks', icon: ListTodo, types: ['TASK_CREATED', 'TASK_DONE', 'TASK_FAILED'] },
  { key: 'stores', label: 'Stores', icon: Store, types: ['ORDER_PLACED', 'PROOF_RECEIVED', 'WEBHOOK_REJECTED', 'PROVIDER_ONBOARDED', 'RATING_CHANGED', 'IDEMPOTENT_REPLAY'] },
  { key: 'agents', label: 'Agent internals', icon: Bot },
];

const chipCls = (active: boolean) =>
  `inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors ${
    active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`;

/** Admin: journal, agents, customers, providers — каждый раздел со своей смысловой нагрузкой. */
export function AdminPage({ events }: { events: EventView[] }) {
  const [cat, setCat] = useState('all');
  const [actor, setActor] = useState('');
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

  const activeCat = JOURNAL_CATS.find((c) => c.key === cat);
  const filtered = events.filter((e) =>
    (!actor || e.actor === actor)
    && (cat === 'all' || (cat === 'agents' ? e.kind === 'agent' : (activeCat?.types ?? []).includes(e.type))));

  /* последнее событие каждого агента (концепт 3.8) */
  const lastByActor = useMemo(() => {
    const m = new Map<string, EventView>();
    for (const e of events) if (e.kind === 'agent') m.set(e.actor, e);
    return m;
  }, [events]);

  /* Агентов ровно столько, сколько в реестре + buyer agent: молчавшие тоже видны */
  const agentRows = useMemo(() => [
    { actor: 'buyer-agent', title: 'Buyer agent', sub: 'acts for every customer on the platform', provider: null as AdminOverview['providers'][number] | null },
    ...(overview?.providers ?? []).map((p) => ({
      actor: `provider-agent:${p.id}`, title: `${p.id} agent`, sub: `serves ${p.name}`, provider: p,
    })),
  ], [overview]);

  const reseed = async () => {
    if (!window.confirm('Reset demo data? Tasks, deals and the journal will be wiped.')) return;
    setBusy(true);
    try { await api('POST', '/dev/seed'); window.location.reload(); } finally { setBusy(false); }
  };

  return (
    <Tabs defaultValue="journal" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="journal"><ScrollText className="size-3.5" /> Journal</TabsTrigger>
          <TabsTrigger value="agents"><Bot className="size-3.5" /> Agents ({agentRows.length})</TabsTrigger>
          <TabsTrigger value="customers"><Users className="size-3.5" /> Customers{overview ? ` (${overview.buyers.length})` : ''}</TabsTrigger>
          <TabsTrigger value="providers"><Store className="size-3.5" /> Providers{overview ? ` (${overview.providers.length})` : ''}</TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void reseed()}>
          <RotateCcw /> Reset demo
        </Button>
      </div>

      <TabsContent value="journal">
        <Card>
          <CardHeader className="flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {JOURNAL_CATS.map((c) => (
                <button key={c.key} type="button" onClick={() => setCat(c.key)} className={chipCls(cat === c.key)}>
                  <c.icon className="size-4" /> {c.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setActor('')} className={chipCls(actor === '')}>Everyone</button>
              {actors.map((a) => (
                <button key={a} type="button" onClick={() => setActor(actor === a ? '' : a)} className={chipCls(actor === a)}>
                  {actorLabel(a)}
                </button>
              ))}
              <div className="ml-auto flex items-center overflow-hidden rounded-full border">
                <button type="button" onClick={() => setGrouped(true)}
                  className={`h-9 px-4 text-[13px] font-medium ${grouped ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
                  By task
                </button>
                <button type="button" onClick={() => setGrouped(false)}
                  className={`h-9 px-4 text-[13px] font-medium ${!grouped ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
                  Flat
                </button>
              </div>
              <span className="text-xs text-muted-foreground">{filtered.length} of {events.length}</span>
            </div>
          </CardHeader>
          <CardContent>
            {grouped
              ? <GroupedJournal events={filtered} tasks={taskMap} />
              : <div className="flex max-h-[65vh] flex-col gap-1.5 overflow-y-auto pr-1">
                  {[...filtered].reverse().map((e) => <EventRow key={e.id} e={e} showTask raw />)}
                </div>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="agents">
        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>One per provider plus the buyer agent. Green = working right now; grey = idle with its last action.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 lg:grid-cols-2">
            {agentRows.map((a) => {
              const e = lastByActor.get(a.actor);
              const t = e?.taskId ? taskMap.get(e.taskId) : undefined;
              const working = Boolean(e) && (!t || (t.status !== 'DONE' && t.status !== 'FAILED'))
                && Date.now() - new Date(e!.ts).getTime() < 30_000;
              return (
                <div key={a.actor} className={`rounded-xl border p-3 ${working ? 'border-success/50' : ''}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`size-2 rounded-full ${working ? 'animate-pulse bg-success' : 'bg-muted-foreground/40'}`} />
                    <Bot className="size-4 text-primary" /> {actorLabel(a.actor)}
                    {!working && <span className="text-xs font-normal text-muted-foreground">idle</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {a.provider ? <Store className="size-3.5" /> : <Users className="size-3.5" />}
                    {a.sub}
                    {a.provider && <Badge variant={a.provider.rating >= 4 ? 'success' : 'warning'}>★ {a.provider.rating.toFixed(2)}</Badge>}
                  </div>
                  {a.provider && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {a.provider.categories.join(', ')} · {a.provider.agentUrl}
                    </div>
                  )}
                  <div className="mt-1.5 truncate text-sm" title={e ? summary(e) : undefined}>
                    {e ? (working ? summary(e) : `last: ${summary(e)}`) : <span className="text-muted-foreground">no activity yet</span>}
                  </div>
                  {e && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {fmtTs(e.ts)}
                      {e.taskId && <a className="text-primary hover:underline" href={`#/task/${e.taskId}`}> · view task →</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="customers">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4 text-primary" /> Customers</CardTitle></CardHeader>
          <CardContent>
            {overview?.buyers.length
              ? <BuyersTable rows={overview.buyers} />
              : <div className="py-8 text-center text-sm text-muted-foreground">No customers yet.</div>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="providers">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Store className="size-4 text-primary" /> Providers</CardTitle>
            <CardDescription>Stats per store; expand one to see the catalog its agent serves to the platform, live.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(overview?.providers ?? []).map((p) => <ProviderBlock key={p.id} p={p} />)}
            {!overview?.providers.length && <div className="py-8 text-center text-sm text-muted-foreground">No providers yet.</div>}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
