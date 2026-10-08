import { useEffect } from 'react';
import { useRoute, navigate } from './router';
import { useSession } from './session';
import { useEvents } from './useEvents';
import { Bell } from './components/Bell';
import { AdminPage } from './pages/Admin';
import { BuyerPage } from './pages/Buyer';
import { LoginPage } from './pages/Login';
import { ProviderPage } from './pages/Provider';
import { TaskPage } from './pages/Task';
import { WalletPage } from './pages/Wallet';

export function App() {
  const route = useRoute();
  const { session, loading, active, switchTo, logout } = useSession();
  /* одна SSE-подписка на всё приложение; сервер фильтрует по активной учётке (R8) */
  const events = useEvents({ enabled: Boolean(active), identityKey: active?.id });

  const isLogin = route.parts[0] === 'login';
  useEffect(() => {
    if (!loading && !session && !isLogin) navigate('/login');
  }, [loading, session, isLogin]);

  if (loading) return <div className="page muted">Загрузка…</div>;
  if (!session || !active || isLogin) return <LoginPage addToSession={route.query.get('add') === '1'} />;

  const page = () => {
    switch (route.parts[0]) {
      case 'wallet': return <WalletPage events={events} query={route.query} />;
      case 'task': return <TaskPage taskId={route.parts[1] ?? ''} />;
      case 'admin': return <AdminPage events={events} />;
      case 'provider': return <ProviderPage events={events} />;
      default:
        if (active.role === 'admin') return <AdminPage events={events} />;
        if (active.role === 'provider') return <ProviderPage events={events} />;
        return <BuyerPage events={events} />;
    }
  };

  return (
    <>
      <header className="topbar">
        <span className="brand">⚙ Agentic Procurement</span>
        <nav>
          {active.role === 'buyer' && <>
            <a href="#/" className={!route.parts[0] ? 'active' : ''}>Задачи</a>
            <a href="#/wallet" className={route.parts[0] === 'wallet' ? 'active' : ''}>Кошелёк</a>
          </>}
          {active.role === 'admin' && <a href="#/admin" className="active">Админка</a>}
          {active.role === 'provider' && <a href="#/provider" className="active">Портал исполнителя</a>}
        </nav>
        <span className="spacer" />
        {active.role === 'buyer' && <Bell events={events} />}
        <select
          value={active.id}
          onChange={(e) => {
            if (e.target.value === '+') { navigate('/login?add=1'); return; }
            void switchTo(e.target.value).then(() => navigate('/'));
          }}
        >
          {session.identities.map((i) => (
            <option key={i.id} value={i.id}>{i.name} · {roleName(i.role)}</option>
          ))}
          <option value="+">+ добавить учётку…</option>
        </select>
        <button onClick={() => { void logout().then(() => navigate('/login')); }}>Выйти</button>
      </header>
      <main className="page">{page()}</main>
    </>
  );
}

function roleName(role: string): string {
  return role === 'buyer' ? 'заказчик' : role === 'provider' ? 'исполнитель' : 'админ';
}
