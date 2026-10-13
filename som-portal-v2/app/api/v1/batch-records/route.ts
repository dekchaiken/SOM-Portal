// som-portal-v2/app/api/v1/batch-records/route.ts
//
// Port of api/batch-records.php.
//
//   GET  ?action=months                      → ["2026-10","2026-09",…]
//   GET  ?action=list[&month=YYYY-MM]        → records for that month, newest first
//   GET  ?action=coverage[&month=YYYY-MM]    → per-day submission status (SM admin)
//   POST ?action=submit  { timestamp, reporter, server, jobs, backfill? }
//
// Everything is TEAM-SCOPED (data/<team>/batch-records-YYYY-MM.json) and gated
// on the `batch-monitor` feature, which SM/SS/TS/FAS/IM hold but e.g. SMART and
// Wealth do not.
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { requireTeamFeature, requireSmCoverageAdmin, isSmCoverageAdmin } from '@/team/features';
import { logActivity } from '@/logging/activity';
import {
  coverage,
  listMonths,
  listRecords,
  submitRecord,
  summarize,
} from '@/jenkins/batch';
import { BatchSubmitSchema } from '@/jenkins/types';
import { handle, jsonErr, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** v1: layout.js `{ id: 'batch-monitor', feature: 'batch-monitor' }`. */
const BATCH_FEATURE = 'batch-monitor';

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireAuth();
    await requireTeamFeature(sess, BATCH_FEATURE);

    const q = new URL(req.url).searchParams;
    const action = q.get('action') ?? 'list';
    const month = q.get('month');

    if (action === 'months') {
      return jsonOk(await listMonths(sess.team));
    }

    if (action === 'list') {
      const records = await listRecords(month);
      // `summary` is derived, not stored — the raw record keeps v1's shape.
      return jsonOk({
        month: month ?? null,
        records,
        summaries: records.map(summarize),
        can_backfill: isSmCoverageAdmin(sess),
      });
    }

    if (action === 'coverage') {
      // SM owns cross-team coverage/backfill — not exposed to other teams' admins.
      await requireSmCoverageAdmin(sess, 'batch coverage');
      return jsonOk(await coverage(month));
    }

    return jsonErr('Invalid action', 400);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireAuth();
    await requireTeamFeature(sess, BATCH_FEATURE);

    const action = new URL(req.url).searchParams.get('action') ?? 'submit';
    if (action !== 'submit') return jsonErr('Invalid action', 400);

    const body = BatchSubmitSchema.parse(await req.json());
    if (!body.reporter || Object.keys(body.jobs).length === 0) {
      return jsonErr('Invalid payload', 400);
    }
    if (body.backfill) await requireSmCoverageAdmin(sess, 'batch backfill');

    const res = await submitRecord(body, {
      actor: sess.username || sess.sub,
      backfillAllowed: isSmCoverageAdmin(sess),
    });

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'batch_report_submitted',
      meta: {
        record_id: res.id,
        reporter: body.reporter,
        server: body.server ?? '',
        month: res.month,
        timestamp: body.timestamp ?? '',
      },
    });
    return jsonOk(res, 201);
  });
}
