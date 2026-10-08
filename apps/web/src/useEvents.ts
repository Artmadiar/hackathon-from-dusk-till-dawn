import { useEffect, useRef, useState } from 'react';
import type { EventView } from './api';

/**
 * SSE-лента с курсором since: reconnect продолжает с последнего id (C29).
 * Сервер фильтрует по роли активной учётки (R8) — cookie уходит same-origin.
 */
export function useEvents(opts: { taskId?: string; enabled?: boolean; max?: number; identityKey?: string } = {}): EventView[] {
  const [events, setEvents] = useState<EventView[]>([]);
  const sinceRef = useRef(0);
  const max = opts.max ?? 500;

  useEffect(() => {
    if (opts.enabled === false) return;
    setEvents([]);
    sinceRef.current = 0;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      if (closed) return;
      const params = new URLSearchParams({ since: String(sinceRef.current) });
      if (opts.taskId) params.set('taskId', opts.taskId);
      es = new EventSource(`/api/events/stream?${params}`);
      const onMsg = (e: MessageEvent): void => {
        const ev = JSON.parse(e.data as string) as EventView;
        sinceRef.current = Math.max(sinceRef.current, ev.id);
        setEvents((prev) => [...prev, ev].slice(-max));
      };
      es.addEventListener('domain', onMsg);
      es.addEventListener('agent', onMsg);
      es.onerror = () => {
        es?.close();
        timer = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  /* identityKey: смена активной учётки переоткрывает стрим — фильтр R8 живёт на сервере */
  }, [opts.taskId, opts.enabled, max, opts.identityKey]);

  return events;
}
