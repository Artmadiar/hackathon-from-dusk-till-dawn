import { Check, LogOut, Shield, ShoppingCart, Store, UserPlus } from 'lucide-react';
import type { IdentityView, SessionView } from '../api';
import { navigate } from '../router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const ROLE_LABEL: Record<string, string> = { buyer: 'Buyer', provider: 'Provider', admin: 'Admin' };

/* Роль читается цветом и иконкой, не только текстом */
const ROLE_AVATAR: Record<string, string> = {
  buyer: 'bg-primary/10 text-primary',
  provider: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  admin: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};
const ROLE_CHIP: Record<string, string> = {
  buyer: 'bg-primary/10 text-primary',
  provider: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  admin: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};
const ROLE_ICON: Record<string, typeof Store> = { buyer: ShoppingCart, provider: Store, admin: Shield };

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function Avatar({ name, role, className = '' }: { name: string; role: string; className?: string }) {
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${ROLE_AVATAR[role] ?? 'bg-muted'} ${className}`}>
      {initials(name)}
    </span>
  );
}

function RoleChip({ role }: { role: string }) {
  const Icon = ROLE_ICON[role] ?? Store;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ROLE_CHIP[role] ?? 'bg-muted'}`}>
      <Icon className="size-3" /> {ROLE_LABEL[role] ?? role}
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
          <Avatar name={active.name} role={active.role} />
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-xs font-medium">{active.name}</span>
            <RoleChip role={active.role} />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Accounts in this session</DropdownMenuLabel>
        {session.identities.map((i) => (
          <DropdownMenuItem key={i.id} onSelect={() => { if (i.id !== active.id) onSwitch(i.id); }}>
            <Avatar name={i.name} role={i.role} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm">{i.name}</span>
                <RoleChip role={i.role} />
              </span>
              <span className="text-[11px] text-muted-foreground">{i.email}</span>
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
