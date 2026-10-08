import { Check, LogOut, UserPlus } from 'lucide-react';
import type { IdentityView, SessionView } from '../api';
import { navigate } from '../router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const ROLE_LABEL: Record<string, string> = { buyer: 'Buyer', provider: 'Provider', admin: 'Admin' };

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function Avatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ${className}`}>
      {initials(name)}
    </span>
  );
}

/** Account switcher: one session, several identities (buyer / admin / provider). */
export function IdentityMenu({ session, active, onSwitch, onLogout }: {
  session: SessionView;
  active: IdentityView;
  onSwitch: (userId: string) => void;
  onLogout: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2">
          <Avatar name={active.name} />
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-xs font-medium">{active.name}</span>
            <span className="text-[10px] text-muted-foreground">{ROLE_LABEL[active.role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Accounts in this session</DropdownMenuLabel>
        {session.identities.map((i) => (
          <DropdownMenuItem key={i.id} onSelect={() => { if (i.id !== active.id) onSwitch(i.id); }}>
            <Avatar name={i.name} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm">{i.name}</span>
              <span className="text-[11px] text-muted-foreground">{ROLE_LABEL[i.role]} · {i.email}</span>
            </span>
            {i.id === active.id && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/login?add=1')}>
          <UserPlus /> Add account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
