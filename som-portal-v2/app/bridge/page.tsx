// som-portal-v2/app/bridge/page.tsx
'use client';
import { useEffect, useState, type ReactElement } from 'react';

/**
 * One-time compat page: reads legacy `localStorage.som_token` set by PHP v1 and
 * POSTs it to /api/auth/bridge which flips it into the HttpOnly cookie v2 uses.
 */
export default function BridgePage(): ReactElement {
  const [status, setStatus] = useState<'running' | 'done' | 'nologin' | 'error'>('running');

  useEffect(() => {
    const token =
      typeof window !== 'undefined' ? window.localStorage.getItem('som_token') : null;
    if (!token) {
      setStatus('nologin');
      return;
    }
    fetch('/v2/api/auth/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'include',
    })
      .then(async (r) => {
        if (r.ok) {
          setStatus('done');
          const next = new URLSearchParams(window.location.search).get('next') ?? '/dashboard';
          window.location.replace(`/v2${next.startsWith('/') ? next : '/' + next}`);
        } else {
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>Signing you in…</h1>
      <p data-status={status}>{status}</p>
    </main>
  );
}
