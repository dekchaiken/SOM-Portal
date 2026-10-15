// som-portal-v2/app/api/auth/[...nextauth]/route.ts
// Auth.js endpoints for Keycloak sign-in. Static routes under /api/auth (login, logout,
// bridge, …) take precedence over this catch-all.
//
// Route handlers in this Next.js setup receive the URL without the /v2 basePath, but
// Auth.js is configured with it (so redirect URIs are correct). Put the prefix back
// before handing the request over.
import { handlers, SSO_BASE_PATH } from '@/auth/nextauth';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

function withBasePath(req: NextRequest): NextRequest {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(SSO_BASE_PATH)) {
    url.pathname = `/v2${url.pathname}`;
  }
  return new NextRequest(url, req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handlers.GET(withBasePath(req));
}

export async function POST(req: NextRequest): Promise<Response> {
  return handlers.POST(withBasePath(req));
}
