// som-portal-v2/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifyRequestSession } from '@/auth/middleware';

// Public prefixes within /v2 (basePath already stripped by Next).
// Note: `_bridge` would be a private folder in App Router; routed as `/bridge`.
const PUBLIC_PATHS = [
  '/login',
  '/bridge',
  '/preview',
  '/forgot-password',
  '/reset-password',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/bridge',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  // Keycloak SSO: Auth.js endpoints and the completion route. The completion route checks
  // the Auth.js session itself and issues the portal cookie. The methods route reveals no config.
  '/api/auth/methods',
  '/api/auth/sso/complete',
  '/api/auth/csrf',
  '/api/auth/providers',
  '/api/auth/signin',
  '/api/auth/callback',
  '/api/auth/error',
  '/api/auth/session',
  '/api/auth/signout',
  '/api/health',
  '/api/internal/scheduler/tick',
];

// Keep in sync with ADMIN_ROLES in src/auth/policy.ts. Duplicated here because
// the middleware runs on the Edge runtime and can't pull in server-only env.
const ADMIN_ROLES = new Set(['super_admin', 'sm_admin', 'dev_sm']);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isPasswordChangeAllowed(pathname: string): boolean {
  return (
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/api/v1/auth/change-password' ||
    pathname === '/api/auth/logout' ||
    pathname.startsWith('/_next/')
  );
}

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const session = await verifyRequestSession(req);
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', code: 'unauthorized' },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Forced password change (first login, admin reset, or expired): only the
  // settings page, the change-password API and logout are reachable until the
  // session is re-issued without the flag.
  if (session.pw_change_required && !isPasswordChangeAllowed(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: 'Password change required', code: 'password_change_required' },
        { status: 403 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/settings';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Admin gate: /admin/* pages (and /api/v1/* admin APIs still enforce their
  // own requireRole). Non-admin roles get a hard 403 instead of a 200 shell
  // that says "forbidden" in the body.
  if (isAdminPath(pathname) && !ADMIN_ROLES.has(session.role)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden', code: 'forbidden' },
        { status: 403 },
      );
    }
    return new NextResponse('Forbidden', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const res = NextResponse.next();
  res.headers.set('X-User-Id', session.sub);
  res.headers.set('X-Team', session.team);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
