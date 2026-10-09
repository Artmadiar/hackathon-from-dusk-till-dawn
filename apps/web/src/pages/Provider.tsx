import { BookOpen, CheckCircle2, ChevronDown, Loader2, Package, Radio, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, fmtTs, usd, type CatalogItem, type EventView, type ProviderDealRow, type ProviderView, type WalletView } from '../api';
import { EventRow, GroupedEventFeed, slug } from '../components/EventFeed';
import { useSession } from '../session';
import { DEAL_BADGE, DEAL_LABEL } from './Task';
import { WalletSummary } from './Wallet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

const CATEGORIES = ['paper', 'writing', 'water', 'office'];

const WON = new Set(['SETTLED']);
const LOST = new Set(['CANCELLED', 'REJECTED_BY_POLICY']);

/** Один заказ провайдера: шапка со статусом, по клику — строки, причина и лог сделки. */
function DealRow({ d, events }: { d: ProviderDealRow; events: EventView[] }) {
  const [open, setOpen] = useState(false);
  const dealEvents = events.filter((e) => e.dealId === d.id);
  const firstLine = d.quote.lines[0];
  const title = firstLine
    ? `${firstLine.title}${d.quote.lines.length > 1 ? ` +${d.quote.lines.length - 1} more` : ''}`
    : d.id;
  return (
    <div className="rounded-xl border">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent/40">
        <span className="text-[11px] tabular-nums text-muted-foreground">{fmtTs(d.createdAt)}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <span className="font-semibold tabular-nums">{usd(d.quote.total)}</span>
        <Badge variant={DEAL_BADGE[d.status] ?? 'outline'}>{d.status}</Badge>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t px-3 py-2.5">
          <div className="text-xs text-muted-foreground">
            {DEAL_LABEL[d.status] ?? d.status}
            {' · '}delivery by {new Date(d.quote.deliveryEta).toLocaleDateString('en-GB')}
            {d.cancelReason && <span className="text-destructive"> · {slug(d.cancelReason)}</span>}
          </div>
          <div className="flex flex-col gap-0.5 text-xs">
            {d.quote.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-2 tabular-nums">
                <span className="min-w-0 truncate">{l.title}</span>
                <span className="shrink-0 text-muted-foreground">{l.quantity} × {usd(l.unitPrice)} = {usd(l.lineTotal)}</span>
              </div>
            ))}
          </div>
          {dealEvents.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t pt-2">
              {[...dealEvents].reverse().map((e) => <EventRow key={e.id} e={e} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Provider dashboard: мой магазин + статистика, заказы с проваливанием в лог, общий лог свёрнут. */
export function ProviderPage({ events }: { events: EventView[] }) {
  const { active } = useSession();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [deals, setDeals] = useState<ProviderDealRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);

  const domainCount = events.filter((e) => e.kind === 'domain').length;
  useEffect(() => {
    void api<WalletView>('GET', '/wallets/me').then(setWallet).catch(() => {});
    void api<ProviderView[]>('GET', '/providers').then(setProviders).catch(() => {});
    void api<{ deals: ProviderDealRow[] }>('GET', '/provider/deals').then((r) => setDeals(r.deals)).catch(() => {});
  }, [domainCount]);

  const me = providers.find((p) => p.id === active?.providerId);
  useEffect(() => {
    if (!active?.providerId) return;
    void api<{ items: CatalogItem[] }>('GET', `/providers/${active.providerId}/catalog`)
      .then((r) => setCatalog(r.items)).catch(() => setCatalog([]));
  }, [active?.providerId]);
  const won = deals.filter((d) => WON.has(d.status)).length;
  const lost = deals.filter((d) => LOST.has(d.status)).length;
  const pending = deals.length - won - lost;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-4">
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="size-4 text-primary" />
              {me ? me.name : active?.providerId ?? 'Provider'}
            </CardTitle>
            {me && (
              <CardDescription>
                rating <Badge variant={me.rating >= 4 ? 'success' : 'warning'}>{me.rating.toFixed(2)}</Badge>
                {' · '}{me.categories.join(', ')}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <WalletSummary wallet={wallet} />
            <div className="flex flex-wrap gap-1.5 border-t pt-3">
              {won > 0 && <Badge variant="success">{won} settled</Badge>}
              {pending > 0 && <Badge>{pending} in play</Badge>}
              {lost > 0 && <Badge variant="destructive">{lost} lost</Badge>}
              {!deals.length && <span className="text-xs text-muted-foreground">no deals yet</span>}
            </div>
          </CardContent>
        </Card>

        {!me && (
          <Card>
            <CardHeader>
              <CardTitle>Not onboarded yet</CardTitle>
              <CardDescription>Your store is not in the registry — onboard it to start receiving requests.</CardDescription>
            </CardHeader>
            <CardContent>
              <a href="#/provider/onboard"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Onboard your store
              </a>
            </CardContent>
          </Card>
        )}

        {me && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BookOpen className="size-4 text-primary" /> Your catalog</CardTitle>
              <CardDescription>What your agent serves to the platform right now, straight from the store.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {!catalog && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Asking your agent…</p>}
              {catalog?.map((it) => (
                <div key={it.sku} className="flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium" title={it.description}>{it.title}</span>
                  {it.category && <Badge variant="secondary">{it.category}</Badge>}
                  <span className="shrink-0 font-semibold tabular-nums">{usd(it.price)}<span className="font-normal text-muted-foreground"> / {it.unit}</span></span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Package className="size-4 text-primary" /> Orders & offers</CardTitle>
            <CardDescription>Every deal your agent took part in — click one for its lines, reason and log.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!deals.length && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No deals yet — they appear as buyer agents request quotes.
              </div>
            )}
            {deals.map((d) => <DealRow key={d.id} d={d} events={events} />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="size-4 text-primary" /> Full activity log
              <span className="ml-1 size-2 animate-pulse rounded-full bg-success" title="live" />
            </CardTitle>
            <CardDescription>Everything your agent did, grouped by task — collapsed until you need it.</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupedEventFeed events={events} startCollapsed linkTasks={false} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Онбординг магазина — своя страница с одной смысловой нагрузкой (C27). */
export function OnboardStorePage() {
  const [form, setForm] = useState({ id: '', name: '', agentUrl: 'http://host.docker.internal:', categories: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');

  const onboard = async () => {
    setErr(''); setDone(''); setBusy(true);
    try {
      await api('POST', '/providers/onboard', form);
      setDone(form.name);
      setForm({ id: '', name: '', agentUrl: 'http://host.docker.internal:', categories: [] });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Store className="size-4 text-primary" /> Onboard a new store</CardTitle>
          <CardDescription>
            Onboarding is one registry row: the catalog maps onto contract categories and the agent
            gets a URL. Discovery picks the store up immediately — no platform restart.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sid">ID (lowercase)</Label>
            <Input id="sid" placeholder="new-store" value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sname">Name</Label>
            <Input id="sname" placeholder="New Store" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="surl">Agent URL</Label>
            <Input id="surl" value={form.agentUrl}
              onChange={(e) => setForm({ ...form, agentUrl: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Contract categories</Label>
            <div className="flex flex-wrap gap-3">
              {CATEGORIES.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="checkbox" className="accent-primary"
                    checked={form.categories.includes(c)}
                    onChange={(e) => setForm({
                      ...form,
                      categories: e.target.checked ? [...form.categories, c] : form.categories.filter((x) => x !== c),
                    })} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <Button disabled={busy || !form.id || !form.name || !form.categories.length} onClick={() => void onboard()}>
            {busy ? <Loader2 className="animate-spin" /> : null} Onboard store
          </Button>
          {done && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" />
              “{done}” is now discoverable — <a className="underline" href="#/provider">back to dashboard</a>
            </p>
          )}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
