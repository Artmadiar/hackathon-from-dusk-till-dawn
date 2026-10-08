import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, fmtTs, type EventView } from '../api';
import { EventRow, shortId, summary } from '../components/EventFeed';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function Filter({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border bg-card px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Admin journal: what each agent is doing now, filters, the full platform log, demo reset. */
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

  /* the latest agent event per actor = "what is it doing right now" (concept 3.8) */
  const now = useMemo(() => {
    const byActor = new Map<string, EventView>();
    for (const e of events) if (e.kind === 'agent') byActor.set(e.actor, e);
    return [...byActor.values()];
  }, [events]);

  const reseed = async () => {
    if (!window.confirm('Reset demo data? Tasks, deals and the journal will be wiped.')) return;
    setBusy(true);
    try { await api('POST', '/dev/seed'); window.location.reload(); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Platform journal</h1>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void reseed()}>
          <RotateCcw /> Reset demo
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Agents right now</CardTitle></CardHeader>
        <CardContent>
          {!now.length && <div className="py-4 text-center text-sm text-muted-foreground">Agents are quiet — the journal is empty.</div>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {now.map((e) => (
              <div key={e.actor} className="rounded-lg border p-3">
                <div className="text-xs font-semibold">{e.actor}</div>
                <div className="mt-0.5 truncate text-sm" title={summary(e)}>{summary(e)}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {fmtTs(e.ts)}
                  {e.taskId && <a className="text-primary hover:underline" href={`#/task/${e.taskId}`}> · {shortId(e.taskId)}</a>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <Filter value={kind} onChange={setKind} label="kind" options={['domain', 'agent']} />
          <Filter value={actor} onChange={setActor} label="actor" options={actors} />
          <Filter value={type} onChange={setType} label="type" options={types} />
          <Filter value={taskId} onChange={setTaskId} label="task" options={taskIds} />
          <span className="text-xs text-muted-foreground">{filtered.length} of {events.length}</span>
        </CardHeader>
        <CardContent>
          <div className="flex max-h-[65vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {[...filtered].reverse().map((e) => <EventRow key={e.id} e={e} showTask />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
