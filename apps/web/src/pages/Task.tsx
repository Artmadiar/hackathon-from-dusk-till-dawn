import { useEffect, useState } from 'react';
import { api, usd, type DealView, type TaskView } from '../api';
import { EventFeed } from '../components/EventFeed';
import { useEvents } from '../useEvents';

const DEAL_BADGE: Record<string, string> = {
  QUOTED: 'plain', HELD: 'info', ORDER_PLACED: 'warn', PROOF_RECEIVED: 'info',
  SETTLED: 'ok', REJECTED_BY_POLICY: 'bad', CANCELLED: 'bad',
};

/** Задача: статус, сделки с офертами, живой таймлайн событий задачи. */
export function TaskPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [deals, setDeals] = useState<DealView[]>([]);
  const events = useEvents({ taskId });

  useEffect(() => {
    if (!taskId) return;
    void api<{ task: TaskView; deals: DealView[] }>('GET', `/tasks/${taskId}`)
      .then((r) => { setTask(r.task); setDeals(r.deals); })
      .catch(() => {});
  }, [taskId, events.length]);

  if (!task) return <div className="muted">Задача {taskId} загружается…</div>;

  return (
    <>
      <div className="card">
        <div className="row">
          <h1 style={{ margin: 0 }}>{task.request.items.map((i) => i.itemQuery).join(', ')}</h1>
          <span className={`badge ${task.status === 'DONE' ? 'ok' : task.status === 'FAILED' ? 'bad' : 'info'}`}>{task.status}</span>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Бюджет {usd(task.request.budget.max)}
          {task.request.budget.source === 'estimated' && ' (оценка)'} ·
          дедлайн {new Date(task.request.deadline).toLocaleString('ru-RU')} ·
          доставка: {task.request.deliveryAddress}
          {task.failReason && <span className="error"> · причина: {task.failReason}</span>}
        </p>
      </div>

      <div className="cols">
        <div>
          {deals.map((d) => (
            <div key={d.id} className="card">
              <div className="row">
                <h2 style={{ margin: 0 }}>{d.providerId}</h2>
                <span className={`badge ${DEAL_BADGE[d.status] ?? 'plain'}`}>{d.status}</span>
                <span className="spacer" />
                <b>{usd(d.quote.total)}</b>
              </div>
              <p className="muted small">доставка до {new Date(d.quote.deliveryEta).toLocaleDateString('ru-RU')}
                {d.cancelReason && <span className="error"> · {d.cancelReason}</span>}</p>
              <table className="lines">
                <tbody>
                  {d.quote.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.title} <span className="muted mono">{l.sku}</span></td>
                      <td className="num">{l.quantity} × {usd(l.unitPrice)}</td>
                      <td className="num">{usd(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {!deals.length && <div className="card muted">Сделок пока нет — агент собирает оферты.</div>}
        </div>

        <div className="card">
          <h2>Таймлайн задачи</h2>
          <EventFeed events={events} />
        </div>
      </div>
    </>
  );
}
