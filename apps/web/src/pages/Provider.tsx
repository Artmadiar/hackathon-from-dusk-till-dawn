import { useEffect, useState } from 'react';
import { api, usd, type EventView, type ProviderView, type WalletView } from '../api';
import { EventFeed } from '../components/EventFeed';
import { useSession } from '../session';

const CATEGORIES = ['paper', 'writing', 'water', 'office'];

/** Портал исполнителя: свой агент вживую, кошелёк, онбординг нового магазина (C27). */
export function ProviderPage({ events }: { events: EventView[] }) {
  const { active } = useSession();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [form, setForm] = useState({ id: '', name: '', agentUrl: 'http://host.docker.internal:', categories: [] as string[] });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const domainCount = events.filter((e) => e.kind === 'domain').length;
  useEffect(() => {
    void api<WalletView>('GET', '/wallets/me').then(setWallet).catch(() => {});
    void api<ProviderView[]>('GET', '/providers').then(setProviders).catch(() => {});
  }, [domainCount]);

  const me = providers.find((p) => p.id === active?.providerId);

  const onboard = async () => {
    setErr(''); setMsg('');
    try {
      await api('POST', '/providers/onboard', form);
      setMsg(`Магазин «${form.name}» появился в discovery — без перезапуска платформы.`);
      setForm({ id: '', name: '', agentUrl: 'http://host.docker.internal:', categories: [] });
    } catch (e) { setErr(String(e)); }
  };

  return (
    <div className="cols">
      <div>
        <div className="card">
          <h2>{me ? me.name : active?.providerId ?? 'Исполнитель'}</h2>
          {me && <p className="small muted">рейтинг {me.rating.toFixed(2)} · категории: {me.categories.join(', ')}</p>}
          <div className="wallet-grid">
            <div><div className="balance">{wallet ? usd(wallet.balance) : '—'}</div><div className="muted small">заработано</div></div>
            <div><div className="balance">{wallet ? usd(wallet.held) : '—'}</div><div className="muted small">в холдах</div></div>
            <div><div className="balance">{wallet ? usd(wallet.available) : '—'}</div><div className="muted small">доступно</div></div>
          </div>
        </div>

        <div className="card">
          <h2>Реестр исполнителей</h2>
          <div className="task-list">
            {providers.map((p) => (
              <div key={p.id} className="task-item">
                <span className={`badge ${p.active ? 'ok' : 'plain'}`}>{p.rating.toFixed(2)}</span>
                <span className="title">{p.name}</span>
                <span className="muted small">{p.categories.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Подключить новый магазин</h2>
          <p className="muted small">
            Онбординг = строка в реестре: каталог раскладывается по категориям контракта,
            агент получает URL. Discovery увидит магазин сразу (C27).
          </p>
          <label>ID (латиницей)</label>
          <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="novy-obchod" />
          <label>Название</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nový Obchod" />
          <label>URL агента</label>
          <input value={form.agentUrl} onChange={(e) => setForm({ ...form, agentUrl: e.target.value })} />
          <label>Категории контракта</label>
          <div className="row">
            {CATEGORIES.map((c) => (
              <label key={c} className="row small" style={{ margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={form.categories.includes(c)}
                  onChange={(e) => setForm({
                    ...form,
                    categories: e.target.checked ? [...form.categories, c] : form.categories.filter((x) => x !== c),
                  })} /> {c}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="primary" disabled={!form.id || !form.name || !form.categories.length}
              onClick={() => void onboard()}>Подключить</button>
          </div>
          {msg && <p className="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
          {err && <p className="error small">{err}</p>}
        </div>
      </div>

      <div className="card">
        <h2>Мой агент вживую</h2>
        <p className="muted small">Оферты, походы в магазин, webhook'и, отзывы — только ваши события.</p>
        <EventFeed events={events} showTask />
      </div>
    </div>
  );
}
