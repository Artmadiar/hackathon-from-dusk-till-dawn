import { Boxes } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ProviderView } from './api';
import { useRoute, navigate } from './router';
import { useSession } from './session';
import { useEvents } from './useEvents';
import { Bell } from './components/Bell';
import { IdentityMenu } from './components/IdentityMenu';
import { AdminPage } from './pages/Admin';
import { BuyerPage } from './pages/Buyer';
import { LoginPage } from './pages/Login';
import { OnboardStorePage, ProviderPage } from './pages/Provider';
import { TaskPage } from './pages/Task';
import { WalletPage } from './pages/Wallet';

export function App() {
  const route = useRoute();
  const { session, loading, active, switchTo, logout } = useSession();
  /* one SSE subscription for the whole app; the server filters by active identity (R8) */
  const events = useEvents({ enabled: Boolean(active), identityKey: active?.id });
  const [registry, setRegistry] = useState<ProviderView[]>([]);
  useEffect(() => {
    if (active?.role === 'provider') void api<ProviderView[]>('GET', '/providers').then(setRegistry).catch(() => {});
  }, [active?.id, active?.role]);
  const onboarded = active?.role === 'provider' && registry.some((p) => p.id === active.providerId);

  const isLogin = route.parts[0] === 'login';
  useEffect(() => {
    if (!loading && !session && !isLogin) navigate('/login');
  }, [loading, session, isLogin]);

  if (loading) return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!session || !active || isLogin) return <LoginPage addToSession={route.query.get('add') === '1'} />;

  const page = () => {
    switch (route.parts[0]) {
      case 'wallet': return <WalletPage events={events} query={route.query} />;
      case 'task': return <TaskPage taskId={route.parts[1] ?? ''} />;
      case 'admin': return <AdminPage events={events} />;
      case 'provider':
        return route.parts[1] === 'onboard' ? <OnboardStorePage /> : <ProviderPage events={events} />;
      default:
        if (active.role === 'admin') return <AdminPage events={events} />;
        if (active.role === 'provider') return <ProviderPage events={events} />;
        return <BuyerPage events={events} />;
    }
  };

  const nav = active.role === 'buyer'
    ? [{ href: '#/', label: 'Tasks', current: !route.parts[0] || route.parts[0] === 'task' },
       { href: '#/wallet', label: 'Wallet', current: route.parts[0] === 'wallet' }]
    : active.role === 'admin'
      ? [{ href: '#/admin', label: 'Admin', current: true }]
      : [{ href: '#/provider', label: 'Dashboard', current: route.parts[1] !== 'onboard' },
         ...(onboarded ? [] : [{ href: '#/provider/onboard', label: 'Onboard a store', current: route.parts[1] === 'onboard' }])];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Boxes className="size-5 text-primary" />
            Shop Elf
          </a>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <a key={n.href} href={n.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${n.current ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60'}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {active.role === 'buyer' && <Bell events={events} />}
            <IdentityMenu
              session={session}
              active={active}
              onSwitch={(id) => { void switchTo(id).then(() => navigate('/')); }}
              onLogout={() => { void logout().then(() => navigate('/login')); }}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{page()}</main>
    </div>
  );
}
