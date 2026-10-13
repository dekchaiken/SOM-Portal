// som-portal-v2/app/api/opensearch/saved-searches/route.ts
// GET/POST/PUT/DELETE for team-shared saved searches
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/auth/session';
import { ForbiddenError } from '@/lib/errors';
import { ok, err } from '@/lib/result';
import { CreateSavedSearchSchema, UpdateSavedSearchSchema } from '@/opensearch/schema';
import {
  listSavedSearches,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
} from '@/opensearch/saved-searches';

function assertSmTeam(session: { team: string; role: string }): void {
  if (session.team !== 'sm') throw new ForbiddenError('SM team only');
  if (session.role === 'super_viewer') throw new ForbiddenError('super_viewer denied');
}

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);
    const searches = await listSavedSearches();
    return NextResponse.json(ok({ searches }));
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json(err(e.message, e.code), { status: 403 });
    return NextResponse.json(err('Server error'), { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const body = await req.json().catch(() => null);
    const parsed = CreateSavedSearchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Invalid body'), { status: 400 });
    }

    const result = await createSavedSearch(session, parsed.data.name, parsed.data.params, parsed.data.folder_id);
    return NextResponse.json(ok(result));
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json(err(e.message, e.code), { status: 403 });
    return NextResponse.json(err(String((e as Error).message)), { status: 400 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') ?? '';
    if (!id) return NextResponse.json(err('id is required'), { status: 400 });

    const body = await req.json().catch(() => null);
    const parsed = UpdateSavedSearchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Invalid body'), { status: 400 });
    }

    const result = await updateSavedSearch(session, id, parsed.data);
    return NextResponse.json(ok(result));
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json(err(e.message, e.code), { status: 403 });
    return NextResponse.json(err(String((e as Error).message)), { status: 400 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') ?? '';
    if (!id) return NextResponse.json(err('id is required'), { status: 400 });

    await deleteSavedSearch(session, id);
    return NextResponse.json(ok(null));
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json(err(e.message, e.code), { status: 403 });
    return NextResponse.json(err(String((e as Error).message)), { status: 400 });
  }
}
