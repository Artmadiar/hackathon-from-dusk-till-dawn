import { CheckCircle2, Loader2, Radio, Store, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type EventView, type ProviderView, type WalletView } from '../api';
import { EventFeed } from '../components/EventFeed';
import { useSession } from '../session';
import { WalletSummary } from './Wallet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

const CATEGORIES = ['paper', 'writing', 'water', 'office'];

/** Provider dashboard: мой магазин, заработок, реестр и живая лента агента. Онбординг — отдельная страница. */
export function ProviderPage({ events }: { events: EventView[] }) {
  const { active } = useSession();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);

  const domainCount = events.filter((e) => e.kind === 'domain').length;
  useEffect(() => {
    void api<WalletView>('GET', '/wallets/me').then(setWallet).catch(() => {});
    void api<ProviderView[]>('GET', '/providers').then(setProviders).catch(() => {});
  }, [domainCount]);

  const me = providers.find((p) => p.id === active?.providerId);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
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
          <CardContent><WalletSummary wallet={wallet} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="size-4 text-primary" /> Provider registry</CardTitle>
            <CardDescription>Everyone discoverable by buyer agents right now.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <Badge variant={p.active ? 'success' : 'outline'}>{p.rating.toFixed(2)}</Badge>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">{p.categories.join(', ')}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="size-4 text-primary" /> Your agent, live
            <span className="ml-1 size-2 animate-pulse rounded-full bg-success" title="live" />
          </CardTitle>
          <CardDescription>Quotes, store calls, webhooks, withdrawals — your events only.</CardDescription>
        </CardHeader>
        <CardContent><EventFeed events={events} showTask /></CardContent>
      </Card>
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
