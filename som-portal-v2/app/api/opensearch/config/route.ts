// som-portal-v2/app/api/opensearch/config/route.ts
// Admin endpoint registry — GET (list) / POST (add/update)
// Requires admin role + SM team
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/auth/session';
import { ForbiddenError } from '@/lib/errors';
import { ok, err } from '@/lib/result';
import { loadConfig } from '@/opensearch/endpoints';

const ADMIN_ROLES = ['super_admin', 'sm_admin', 'dev_sm'];

function assertSmAdmin(session: { team: string; role: string }): void {
  if (session.team !== 'sm') throw new ForbiddenError('SM team only');
  if (!ADMIN_ROLES.includes(session.role)) throw new ForbiddenError('Admin role required');
}

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmAdmin(session);

    const cfg = await loadConfig();
    // Redact passwords for API response
    const endpoints = cfg.endpoints.map((e) => {
      const { password, ...rest } = e;
      return { ...rest, password_set: !!password };
    });
    return NextResponse.json(ok({ endpoints: endpoints.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)), defaults: cfg.defaults }));
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json(err(e.message, e.code), { status: 403 });
    return NextResponse.json(err('Server error'), { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmAdmin(session);

    // Config writes are admin-only; full implementation deferred to admin module
    return NextResponse.json(err('Config write not yet implemented'), { status: 501 });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json(err(e.message, e.code), { status: 403 });
    return NextResponse.json(err('Server error'), { status: 500 });
  }
}
