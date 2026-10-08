import { useEffect, useMemo, useState } from 'react';
import { api, usd, type EventView, type WalletView } from '../api';
import { useSession } from '../session';

/** Кошелёк: Stripe Checkout (реальная sandbox-транзакция) + SIMULATED-фоллбэк. */
export function WalletPage({ events, query }: { events: EventView[]; query: URLSearchParams }) {
  const { active } = useSession();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
      setErr(`Stripe недоступен (${String(e)}). Кнопка ниже — SIMULATED-пополнение.`);
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
    <div className="cols">
      <div>
        <div className="card">
          <h2>Кошелёк</h2>
          {pendingTopup && !landed && (
            <p><span className="badge info">Stripe</span> платёж принят, ждём webhook о зачислении…</p>
          )}
          {landed && <p><span className="badge ok">зачислено</span> депозит пришёл, баланс обновлён.</p>}
          <div className="wallet-grid">
            <div><div className="balance">{wallet ? usd(wallet.balance) : '—'}</div><div className="muted small">баланс</div></div>
            <div><div className="balance">{wallet ? usd(wallet.held) : '—'}</div><div className="muted small">в холдах</div></div>
            <div><div className="balance">{wallet ? usd(wallet.available) : '—'}</div><div className="muted small">доступно</div></div>
          </div>
        </div>

        <div className="card">
          <h2>Пополнить</h2>
          <label>Сумма, USD</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy || !(cents >= 50)} onClick={() => void stripe()}>
              Пополнить через Stripe
            </button>
            <button disabled={busy || !(cents > 0)} onClick={() => void simulated()}>
              SIMULATED deposit
            </button>
          </div>
          <p className="muted small">
            Stripe — test mode, карта 4242 4242 4242 4242. Зачисление придёт webhook'ом;
            страница обновится сама по SSE.
          </p>
          {err && <p className="error small">{err}</p>}
        </div>
      </div>

      <div className="card">
        <h2>Движения по кошельку</h2>
        {!deposits.length && <div className="muted">Депозитов в этой сессии ещё нет.</div>}
        <div className="feed">
          {[...deposits].reverse().map((e) => (
            <div key={e.id} className="event">
              <span className="muted small">{new Date(e.ts).toLocaleTimeString('ru-RU')}</span>
              <span className="actor">{e.actor}</span>
              <span>
                +{usd((e.payload as { amount: number }).amount)}{' '}
                {(e.payload as { simulated?: boolean }).simulated
                  ? <span className="badge sim">SIMULATED</span>
                  : <span className="badge ok">Stripe</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
