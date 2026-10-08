import { useMemo, useRef, useState } from 'react';
import type { EventView } from '../api';
import { fmtTs } from '../api';
import { summary } from './EventFeed';

const NOTIFY = new Set(['REJECTED_BY_POLICY', 'DEAL_CANCELLED', 'TASK_DONE', 'TASK_FAILED']);

/** Колокольчик: фильтр важных событий из той же SSE-ленты (концепт 3.9). */
export function Bell({ events }: { events: EventView[] }) {
  const [open, setOpen] = useState(false);
  const seenUpTo = useRef(0);
  const notifications = useMemo(() => events.filter((e) => NOTIFY.has(e.type)), [events]);
  const unseen = notifications.filter((e) => e.id > seenUpTo.current);

  return (
    <span className="bell">
      <button
        title="Уведомления"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && notifications.length) seenUpTo.current = notifications[notifications.length - 1]!.id;
        }}
      >🔔{unseen.length > 0 && <span className="dot">{unseen.length}</span>}</button>
      {open && (
        <div className="notif-pop">
          {!notifications.length && <div className="muted">Уведомлений нет.</div>}
          {[...notifications].reverse().slice(0, 10).map((e) => (
            <div key={e.id} className="row small" style={{ padding: '4px 0' }}>
              <span className="muted">{fmtTs(e.ts)}</span>
              <span>{summary(e)}</span>
              {e.taskId && <a href={`#/task/${e.taskId}`}>открыть</a>}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
