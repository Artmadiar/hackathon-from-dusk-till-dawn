import { useEffect, useMemo, useState } from 'react';
import { api, fmtTs, usd, type EventView, type WalletView } from '../api';
import { useSession } from '../session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

/** Акцент на доступной сумме; холд и общий баланс — вторым планом. */
export function WalletSummary({ wallet }: { wallet: WalletView | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-primary">{wallet ? usd(wallet.available) : '—'}</span>
        <span className="text-xs text-muted-foreground">available</span>
      </div>
      <div className="text-xs tabular-nums text-muted-foreground">
        {(wallet?.held ?? 0) > 0 && <span className="font-medium text-warning">on hold {usd(wallet!.held)} · </span>}
        total balance {wallet ? usd(wallet.balance) : '—'}
      </div>
    </div>
  );
}

/** Wallet: real Stripe Checkout (test mode) plus a clearly marked SIMULATED fallback. */
export function WalletPage({ events, query }: { events: EventView[]; query: URLSearchParams }) {
  const { active } = useSession();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const MONEY_TYPES = ['DEPOSIT', 'HOLD_PLACED', 'HOLD_RELEASE', 'CAPTURE'];
  const money = useMemo(() => events.filter((e) => MONEY_TYPES.includes(e.type)), [events]);
  const deposits = useMemo(() => events.filter((e) => e.type === 'DEPOSIT'), [events]);
  const pendingTopup = query.get('topup') === 'pending';
  const [returnedAt] = useState(Date.now());
  const landed = pendingTopup && deposits.some((e) => new Date(e.ts).getTime() > returnedAt - 60_000);

  useEffect(() => {
    void api<WalletView>('GET', '/wallets/me').then(setWallet).catch(() => setWallet(null));
  }, [deposits.length]);

  const cents = Math.round(Number(amount.replace(',', '.')) * 100);

  const stripe = async () => {
    setBusy(true); setErr('');
    try {
      const res = await api<{ url: string }>('POST', '/wallet/checkout', { amount: cents });
      window.location.href = res.url; // Stripe Checkout, test card 4242…
    } catch (e) {
      setErr(`Stripe unavailable (${String(e)}). Use the SIMULATED deposit below.`);
      setBusy(false);
    }
  };

  const simulated = async () => {
    setBusy(true); setErr('');
    try {
      await api('POST', '/dev/deposit', { userId: active!.id, amount: cents, idempotencyKey: `ui-${Date.now()}` });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle>Wallet</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pendingTopup && !landed && (
              <div className="rounded-md bg-accent px-3 py-2 text-sm">
                <Badge>Stripe</Badge> payment accepted — waiting for the deposit webhook…
              </div>
            )}
            {landed && (
              <div className="rounded-md bg-success/10 px-3 py-2 text-sm">
                <Badge variant="success">credited</Badge> deposit arrived, balance updated.
              </div>
            )}
            <WalletSummary wallet={wallet} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top up</CardTitle>
            <CardDescription>
              Stripe runs in test mode — card 4242 4242 4242 4242. The deposit arrives via webhook;
              this page updates itself over SSE.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amount">Amount, USD</Label>
              <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button disabled={busy || !(cents >= 50)} onClick={() => void stripe()}>Top up with Stripe</Button>
              <Button variant="outline" disabled={busy || !(cents > 0)} onClick={() => void simulated()}>
                SIMULATED deposit
              </Button>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Money history</CardTitle>
          <CardDescription>Every movement: top-ups, holds your agent places, payouts to stores.</CardDescription>
        </CardHeader>
        <CardContent>
          {!money.length && <div className="py-8 text-center text-sm text-muted-foreground">No money movements in this session yet.</div>}
          <div className="flex flex-col gap-1.5">
            {[...money].reverse().map((e) => {
              const amount = (e.payload as { amount?: number }).amount ?? 0;
              const row: Record<string, { sign: string; label: string; cls: string }> = {
                DEPOSIT: { sign: '+', label: 'Top-up', cls: 'text-success' },
                HOLD_PLACED: { sign: '−', label: 'Reserved for a deal (hold)', cls: 'text-warning' },
                HOLD_RELEASE: { sign: '+', label: 'Hold released back', cls: 'text-muted-foreground' },
                CAPTURE: { sign: '−', label: 'Paid to the store', cls: '' },
              };
              const r = row[e.type]!;
              return (
                <div key={e.id} className="flex items-baseline gap-3 rounded-lg border px-3 py-2 text-sm">
                  <span className="text-[11px] tabular-nums text-muted-foreground">{fmtTs(e.ts)}</span>
                  <span className={`w-20 text-right font-semibold tabular-nums ${r.cls}`}>{r.sign}{usd(amount)}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {e.type === 'DEPOSIT' && ((e.payload as { simulated?: boolean }).simulated
                    ? <Badge variant="simulated">SIMULATED</Badge>
                    : <Badge variant="success">Stripe</Badge>)}
                  {e.taskId && <a className="text-xs text-primary hover:underline" href={`#/task/${e.taskId}`}>view task →</a>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
