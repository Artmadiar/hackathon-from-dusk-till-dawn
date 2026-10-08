import { useEffect, useState } from 'react';
import { api, usd, type EventView, type ReqView, type TaskView, type WalletView } from '../api';
import { EventFeed } from '../components/EventFeed';
import { navigate } from '../router';

const STATUS_BADGE: Record<TaskView['status'], string> = {
  OPEN: 'plain', SOURCING: 'info', DECIDING: 'info', ORDERED: 'warn', DONE: 'ok', FAILED: 'bad',
};

/** Дашборд заказчика: кошелёк, задача из текста (N1), список задач, живая лента. */
export function BuyerPage({ events }: { events: EventView[] }) {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [text, setText] = useState('Закажи 5 пачек бумаги A4 и 10 синих ручек до пятницы, бюджет 100 долларов');
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
    } catch (e) { setErr(`Не разобрал: ${String(e)}`); } finally { setBusy(false); }
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
    <div className="cols">
      <div>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Кошелёк</h2>
            <a href="#/wallet">пополнить →</a>
          </div>
          <div className="wallet-grid" style={{ marginTop: 10 }}>
            <div><div className="balance">{wallet ? usd(wallet.balance) : '—'}</div><div className="muted small">баланс</div></div>
            <div><div className="balance">{wallet ? usd(wallet.held) : '—'}</div><div className="muted small">в холдах</div></div>
            <div><div className="balance">{wallet ? usd(wallet.available) : '—'}</div><div className="muted small">доступно</div></div>
          </div>
        </div>

        <div className="card">
          <h2>Новая задача</h2>
          <label>Скажите агенту, что купить</label>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy || !text.trim()} onClick={() => void parse()}>
              Заполнить из текста
            </button>
            {preview && <button className="primary" disabled={busy} onClick={() => void create()}>Создать задачу</button>}
          </div>
          {err && <p className="error small">{err}</p>}
          {preview && (
            <div style={{ marginTop: 10 }}>
              <table className="lines">
                <thead><tr><th>Позиция</th><th className="num">Кол-во</th><th>Категория</th></tr></thead>
                <tbody>
                  {preview.request.items.map((it, i) => (
                    <tr key={i}><td>{it.itemQuery}</td><td className="num">{it.quantity} {it.unit}</td><td>{it.category}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="small" style={{ marginBottom: 0 }}>
                Бюджет: <b>{usd(preview.request.budget.max)}</b>{' '}
                {preview.request.budget.source === 'estimated' && <span className="badge warn">оценка агента</span>}
                {' · '}Дедлайн: <b>{new Date(preview.request.deadline).toLocaleString('ru-RU')}</b>
              </p>
              {preview.assumptions.map((a, i) => (
                <p key={i} className="small muted" style={{ margin: '4px 0 0' }}>
                  <span className="badge warn">ASSUMPTION</span> {a}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Задачи</h2>
          {!tasks.length && <div className="muted">Задач пока нет.</div>}
          <div className="task-list">
            {tasks.map((t) => (
              <div key={t.id} className="task-item">
                <span className={`badge ${STATUS_BADGE[t.status]}`}>{t.status}</span>
                <a className="title" href={`#/task/${t.id}`}>
                  {t.request.items.map((i) => i.itemQuery).join(', ') || t.id}
                </a>
                <span className="muted small">{usd(t.request.budget.max)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Лента</h2>
        <p className="muted small">Ваши задачи и деньги; внутренностей чужих агентов тут нет (фильтр на сервере).</p>
        <EventFeed events={events} showTask />
      </div>
    </div>
  );
}
