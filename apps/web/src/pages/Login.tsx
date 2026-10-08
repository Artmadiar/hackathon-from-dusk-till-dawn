import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';

/** Вход по OTP: код не уходит на почту — показывается здесь с пометкой SIMULATED (B8). */
export function LoginPage({ addToSession }: { addToSession?: boolean }) {
  const { reload } = useSession();
  const [email, setEmail] = useState('buyer@demo.local');
  const [issued, setIssued] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true); setErr('');
    try {
      const res = await api<{ code: string }>('POST', '/auth/otp', { email });
      setIssued(res.code);
      setCode('');
    } catch (e) {
      setErr(String(e));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setErr('');
    try {
      await api('POST', '/auth/verify', { email, code });
      await reload();
      navigate('/');
    } catch {
      setErr('Код не подошёл (одноразовый, TTL 10 минут) — запросите новый.');
    } finally { setBusy(false); }
  };

  return (
    <div className="login-box">
      <div className="card">
        <h1>{addToSession ? 'Добавить учётку' : 'Вход'}</h1>
        <p className="muted small">
          Демо-учётки: buyer@demo.local · admin@demo.local · papirna@demo.local (и другие магазины).
          Новый email станет заказчиком.
        </p>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
          onKeyDown={(e) => e.key === 'Enter' && void request()} />
        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy || !email} onClick={() => void request()}>
            Получить код
          </button>
        </div>

        {issued && (
          <>
            <p style={{ marginBottom: 0 }}>
              <span className="badge sim">SIMULATED email</span>{' '}
              <span className="muted small">код пришёл бы письмом; в демо показываем его тут:</span>
            </p>
            <div className="code-box">{issued}</div>
            <label>Код из «письма»</label>
            <div className="row">
              <input style={{ flex: 1, width: 'auto' }} value={code} onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void verify()} />
              <button onClick={() => setCode(issued)}>вставить</button>
              <button className="primary" disabled={busy || !code} onClick={() => void verify()}>Войти</button>
            </div>
          </>
        )}
        {err && <p className="error small">{err}</p>}
      </div>
    </div>
  );
}
