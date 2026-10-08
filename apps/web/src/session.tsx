import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type IdentityView, type SessionView } from './api';

interface SessionState {
  session: SessionView | null;
  loading: boolean;
  active: IdentityView | null;
  reload: () => Promise<void>;
  switchTo: (userId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState>({
  session: null, loading: true, active: null,
  reload: async () => {}, switchTo: async () => {}, logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { session } = await api<{ session: SessionView }>('GET', '/auth/session');
      setSession(session);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const switchTo = useCallback(async (userId: string) => {
    const { session } = await api<{ session: SessionView }>('POST', '/auth/switch', { userId });
    setSession(session);
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout');
    setSession(null);
  }, []);

  const active = session?.identities.find((i) => i.id === session.activeIdentity) ?? null;
  return <Ctx.Provider value={{ session, loading, active, reload, switchTo, logout }}>{children}</Ctx.Provider>;
}

export const useSession = (): SessionState => useContext(Ctx);
