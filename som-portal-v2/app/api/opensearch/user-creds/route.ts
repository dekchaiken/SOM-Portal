// som-portal-v2/app/api/opensearch/user-creds/route.ts
// GET (list status) / POST (save) / DELETE (remove)
// SM team only, denyRoles: ["super_viewer"]
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/auth/session';
import { ForbiddenError } from '@/lib/errors';
import { ok, err } from '@/lib/result';
import { SaveCredsBodySchema } from '@/opensearch/schema';
import { saveUserCreds, deleteUserCreds, listEndpointStatus } from '@/opensearch/creds';
import { getValidEndpointIds } from '@/opensearch/endpoints';

function assertSmTeam(session: { team: string; role: string }): void {
  if (session.team !== 'sm') throw new ForbiddenError('SM team only');
  if (session.role === 'super_viewer') throw new ForbiddenError('super_viewer denied');
}

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const validIds = await getValidEndpointIds();
    const endpoints = await listEndpointStatus(session.sub, validIds);
    return NextResponse.json(ok({ endpoints }));
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json(err(e.message, e.code), { status: 403 });
    }
    return NextResponse.json(err('Server error'), { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const body = await req.json().catch(() => null);
    const parsed = SaveCredsBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        err(parsed.error.issues[0]?.message ?? 'Invalid body'),
        { status: 400 },
      );
    }

    const { endpoint_id, username, password } = parsed.data;
    const validIds = await getValidEndpointIds();
    if (!validIds.includes(endpoint_id)) {
      return NextResponse.json(err('Unknown endpoint_id'), { status: 404 });
    }

    await saveUserCreds(session, endpoint_id, username, password);
    return NextResponse.json(ok({ endpoint_id, username }));
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json(err(e.message, e.code), { status: 403 });
    }
    return NextResponse.json(err(String((e as Error).message ?? 'Server error')), { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const { searchParams } = new URL(req.url);
    const epId = searchParams.get('endpoint_id') ?? '';
    if (!epId) {
      return NextResponse.json(err('endpoint_id is required'), { status: 400 });
    }

    await deleteUserCreds(session, epId);
    return NextResponse.json(ok(null));
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json(err(e.message, e.code), { status: 403 });
    }
    return NextResponse.json(err(String((e as Error).message ?? 'Server error')), { status: 500 });
  }
}
