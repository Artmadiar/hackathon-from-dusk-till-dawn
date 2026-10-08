import { Bell as BellIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { EventView } from '../api';
import { fmtTs } from '../api';
import { summary } from './EventFeed';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NOTIFY = new Set(['REJECTED_BY_POLICY', 'DEAL_CANCELLED', 'TASK_DONE', 'TASK_FAILED']);

/** Notification bell: important events filtered from the same SSE stream. */
export function Bell({ events }: { events: EventView[] }) {
  const seenUpTo = useRef(0);
  const [, bump] = useState(0);
  const notifications = useMemo(() => events.filter((e) => NOTIFY.has(e.type)), [events]);
  const unseen = notifications.filter((e) => e.id > seenUpTo.current);

  return (
    <DropdownMenu onOpenChange={(open) => {
      if (open && notifications.length) {
        seenUpTo.current = notifications[notifications.length - 1]!.id;
        bump((v) => v + 1);
      }
    }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" title="Notifications">
          <BellIcon />
          {unseen.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unseen.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        {!notifications.length && <div className="px-2 pb-2 text-sm text-muted-foreground">All quiet so far.</div>}
        {[...notifications].reverse().slice(0, 10).map((e) => (
          <div key={e.id} className="flex items-baseline gap-2 px-2 py-1 text-sm">
            <span className="text-[11px] tabular-nums text-muted-foreground">{fmtTs(e.ts)}</span>
            <span className="min-w-0 flex-1 truncate">{summary(e)}</span>
            {e.taskId && <a className="text-xs text-primary hover:underline" href={`#/task/${e.taskId}`}>open</a>}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
