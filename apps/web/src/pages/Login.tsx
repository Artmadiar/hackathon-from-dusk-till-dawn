import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

/** OTP sign-in. No email is sent — the code shows up right here, marked SIMULATED. */
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
      setErr('Code rejected — codes are one-time with a 10-minute TTL. Request a fresh one.');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{addToSession ? 'Add account' : 'Sign in'}</CardTitle>
          <CardDescription>
            Demo accounts: buyer@demo.local · admin@demo.local · papirna@demo.local (and other stores).
            A new email registers as a buyer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void request()} />
          </div>
          <Button disabled={busy || !email} onClick={() => void request()}>Send code</Button>

          {issued && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <div className="text-xs text-muted-foreground">
                <Badge variant="simulated">SIMULATED email</Badge>{' '}
                the code would arrive by email — in this demo it shows here:
              </div>
              <div className="rounded-lg border border-dashed border-violet-300 bg-muted py-2 text-center font-mono text-2xl tracking-[0.4em]">
                {issued}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Code from the “email”</Label>
                <div className="flex gap-2">
                  <Input id="code" value={code} onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void verify()} />
                  <Button variant="outline" onClick={() => setCode(issued)}>paste</Button>
                </div>
              </div>
              <Button disabled={busy || !code} onClick={() => void verify()}>Verify &amp; sign in</Button>
            </div>
          )}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
