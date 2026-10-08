import { useMemo, useState } from 'react';
import { api, fmtTs, type EventView } from '../api';
import { EventRow, summary } from '../components/EventFeed';

/** Админка: «что сейчас делает каждый агент», фильтры, полный журнал, сброс демо. */
export function AdminPage({ events }: { events: EventView[] }) {
  const [kind, setKind] = useState('');
  const [actor, setActor] = useState('');
  const [type, setType] = useState('');
  const [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState(false);

  const actors = useMemo(() => [...new Set(events.map((e) => e.actor))].sort(), [events]);
  const types = useMemo(() => [...new Set(events.map((e) => e.type))].sort(), [events]);
  const taskIds = useMemo(() => [...new Set(events.map((e) => e.taskId).filter(Boolean))] as string[], [events]);

  const filtered = events.filter((e) =>
    (!kind || e.kind === kind) && (!actor || e.actor === actor)
    && (!type || e.type === type) && (!taskId || e.taskId === taskId));

  /* последнее agent-событие на агента = «что он делает сейчас» (3.8) */
  const now = useMemo(() => {
    const byActor = new Map<string, EventView>();
    for (const e of events) if (e.kind === 'agent') byActor.set(e.actor, e);
    return [...byActor.values()];
  }, [events]);

  const reseed = async () => {
    if (!window.confirm('Сбросить demo-данные? Задачи, сделки и журнал будут очищены.')) return;
    setBusy(true);
    try { await api('POST', '/dev/seed'); window.location.reload(); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Админка · журнал платформы</h1>
        <button disabled={busy} onClick={() => void reseed()}>⟲ Сбросить демо</button>
      </div>

      <div className="card">
        <h2>Агенты сейчас</h2>
        {!now.length && <div className="muted">Агенты молчат — журнал пуст.</div>}
        <div className="agents-now">
          {now.map((e) => (
            <div key={e.actor} className="agent-card">
              <div className="who">{e.actor}</div>
              <div className="small">{summary(e)}</div>
              <div className="muted small">{fmtTs(e.ts)}{e.taskId && <a href={`#/task/${e.taskId}`}> · {e.taskId}</a>}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">kind: все</option>
            <option value="domain">domain</option>
            <option value="agent">agent</option>
          </select>
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">actor: все</option>
            {actors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">type: все</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">задача: все</option>
            {taskIds.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="muted small" style={{ alignSelf: 'center' }}>{filtered.length} из {events.length}</span>
        </div>
        <div className="feed">
          {[...filtered].reverse().map((e) => <EventRow key={e.id} e={e} showTask />)}
        </div>
      </div>
    </>
  );
}
