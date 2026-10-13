// GET/POST /api/v1/ma-status/hidden — per-source hidden item management
// Port of api/ma-status/hidden.php
import { type NextRequest } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { readHidden, writeHidden } from '@/ma/status-poller';
import { logActivity } from '@/logging/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Known source keys — normalise output so every key is always present. */
const SOURCES = ['nano', 'tmn_jenkins', 'tmn_features', 'tmn_backoffice'] as const;

function emptyHidden(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of SOURCES) out[s] = [];
  return out;
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    await requireRole(...ADMIN_ROLES);

    const cur = await readHidden();
    const out = emptyHidden();
    for (const s of SOURCES) {
      out[s] = (cur[s] ?? []).filter((v) => v !== null && v !== '');
    }
    return jsonOk(out);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const session = await requireRole(...ADMIN_ROLES);

    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return jsonErr('body must be an object', 400);
    }

    const out = emptyHidden();
    for (const s of SOURCES) {
      if (!(s in body)) continue;
      const arr = body[s];
      if (!Array.isArray(arr)) {
        return jsonErr(`${s} must be an array`, 400);
      }
      // Backoffice ids stored as strings for schema consistency
      out[s] = [...new Set(arr.map((v: unknown) => String(v)))].filter(
        (v) => v !== '' && v !== 'null' && v !== 'undefined',
      );
    }

    await writeHidden(out);

    const totalHidden = Object.values(out).reduce((n, a) => n + a.length, 0);
    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'ma_status_hidden_saved',
      meta: { total: totalHidden },
    });

    return jsonOk(out);
  });
}
