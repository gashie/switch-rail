import { useEffect, useState } from 'react';
import { Card } from './Card.jsx';
import { Input } from './Input.jsx';
import { Button } from './Button.jsx';

export const AuthGate = ({ appName = 'Sika', children }) => {
  const [state, setState] = useState({ status: 'checking', user: null, error: null });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const checkSession = async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (r.ok) {
        const body = await r.json();
        setState({ status: 'authed', user: body?.data?.user || null, error: null });
      } else {
        setState({ status: 'guest', user: null, error: null });
      }
    } catch (e) {
      setState({ status: 'guest', user: null, error: e?.message || 'Network error' });
    }
  };

  useEffect(() => { checkSession(); }, []);

  const onLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const body = await r.json();
      if (r.ok) {
        setState({ status: 'authed', user: body?.data?.user, error: null });
      } else {
        setState({ status: 'guest', user: null, error: body?.error?.message || 'Login failed' });
      }
    } catch (err) {
      setState({ status: 'guest', user: null, error: err?.message || 'Network error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (state.status === 'checking') {
    return (
      <div className="min-h-screen grid place-items-center bg-graphite-50">
        <p className="text-sm text-graphite-500">Loading…</p>
      </div>
    );
  }

  if (state.status === 'authed') return children;

  return (
    <div className="min-h-screen grid place-items-center bg-graphite-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-4 justify-center">
          <div className="w-8 h-8 rounded bg-emerald-500 grid place-items-center font-bold text-graphite-900">S</div>
          <span className="font-semibold text-graphite-900">{appName}</span>
        </div>
        <Card title="Sign in">
          <form className="space-y-3" onSubmit={onLogin}>
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {state.error && <p className="text-sm text-red-700">{state.error}</p>}
            <div className="flex justify-end">
              <Button type="submit" loading={submitting}>Sign in</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default AuthGate;
