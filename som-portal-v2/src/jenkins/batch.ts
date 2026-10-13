// som-portal-v2/src/jenkins/batch.ts
//
// Batch Daily Report storage + coverage. Port of api/batch-records.php.
//
// Storage is one team-scoped file per month: data/<team>/batch-records-YYYY-MM.json
// holding an array of records whose `jobs` is a MAP jobName → {status, remark,
// folder}. Field names are kept 1:1 so PHP and v2 can both write the same file.
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { getDataAdapter } from '@/data/json-adapter';
import { readTeamFile, writeTeamFile, type Scope } from '@/team/scope';
import {
  BatchRecordsFileSchema,
  HolidaysFileSchema,
  type BatchRecord,
  type BatchSubmitInput,
  type CoverageDay,
  type CoverageResult,
  type CoverageStatus,
} from './types';

export const BATCH_PREFIX = 'batch-records';
const MONTH_RE = /^\d{4}-\d{2}$/;

/** Current month in Asia/Bangkok — the ops day boundary the team works to. */
export function currentMonth(now: Date = new Date()): string {
  return bkkDate(now).slice(0, 7);
}

export function todayBkk(now: Date = new Date()): string {
  return bkkDate(now);
}

function bkkDate(d: Date): string {
  // en-CA gives YYYY-MM-DD.
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** Port of `monthlyFilename()` — invalid/missing month falls back to now. */
export function monthlyFilename(prefix: string, month?: string | null): string {
  const m = month && MONTH_RE.test(month) ? month : currentMonth();
  return `${prefix}-${m}.json`;
}

export function isValidMonth(m: string | null | undefined): boolean {
  return !!m && MONTH_RE.test(m);
}

/** Port of `listMonths()` — newest first, from the team's own directory. */
export async function listMonths(team: string, prefix = BATCH_PREFIX): Promise<string[]> {
  const adapter = getDataAdapter();
  const dir = path.dirname(adapter.resolvePath({ team }, `${prefix}-0000-00.json`));
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${prefix}-(\\d{4}-\\d{2})\\.json$`);
  const months: string[] = [];
  for (const n of names) {
    const m = re.exec(n);
    if (m && m[1]) months.push(m[1]);
  }
  return months.sort().reverse();
}

/** Records for a month, newest timestamp first (v1 sorts desc on `timestamp`). */
export async function listRecords(month?: string | null, scope?: Scope): Promise<BatchRecord[]> {
  const rows = await readTeamFile(
    monthlyFilename(BATCH_PREFIX, month),
    BatchRecordsFileSchema,
    scope,
  );
  return [...((rows ?? []) as BatchRecord[])].sort((a, b) =>
    (b.timestamp ?? '').localeCompare(a.timestamp ?? ''),
  );
}

/** Port of `uniqid('br_', true)` — prefix + hex time + '.' + fractional part. */
export function genRecordId(): string {
  return `br_${Date.now().toString(16)}${randomBytes(2).toString('hex')}.${randomBytes(4)
    .readUInt32BE(0)
    .toString()
    .padStart(8, '0')}`;
}

export interface SubmitContext {
  /** Display name recorded on a backfill (`$user['name'] ?? $user['sub']`). */
  actor: string;
  /** Already-authorised flag. Callers MUST have run requireSmCoverageAdmin. */
  backfillAllowed: boolean;
}

/**
 * Append a Batch Daily Report. The month is derived from the record's own
 * timestamp (not "now"), which is what makes backfilling into a past month
 * work — hence the SM-admin gate on `backfill`.
 */
export async function submitRecord(
  input: BatchSubmitInput,
  ctx: SubmitContext,
  scope?: Scope,
): Promise<{ id: string; month: string }> {
  const ts = input.timestamp || new Date().toISOString();
  const record: BatchRecord = {
    id: genRecordId(),
    timestamp: ts,
    reporter: input.reporter.trim(),
    server: input.server ?? '',
    jobs: Object.fromEntries(
      Object.entries(input.jobs).map(([k, v]) => [
        k,
        { status: v.status ?? '', remark: v.remark ?? '', folder: v.folder ?? '' },
      ]),
    ),
  };
  if (input.backfill) {
    if (!ctx.backfillAllowed) throw new Error('backfill not authorised');
    record.backfilled = true;
    record.backfilled_at = new Date().toISOString();
    record.backfilled_by = ctx.actor;
  }

  let recMonth = ts.slice(0, 7);
  if (!MONTH_RE.test(recMonth)) recMonth = currentMonth();

  const file = monthlyFilename(BATCH_PREFIX, recMonth);
  const existing = ((await readTeamFile(file, BatchRecordsFileSchema, scope)) ?? []) as BatchRecord[];
  await writeTeamFile(file, [...existing, record], BatchRecordsFileSchema, scope);
  return { id: record.id, month: recMonth };
}

// ─── Coverage ────────────────────────────────────────────────────────────────

function prevMonth(ym: string, back: number): string {
  const [y = 0, m = 1] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Per-day submission status for a month, so the UI can highlight days where
 * nobody submitted. Port of the `?action=coverage` branch.
 *
 * The expected-server set is the union of servers seen in the target month and
 * the two before it — otherwise day 1 of a fresh month reports "nothing
 * expected" and every gap looks fine.
 */
export async function coverage(month: string | null | undefined, scope?: Scope): Promise<CoverageResult> {
  const ym = isValidMonth(month) ? (month as string) : currentMonth();
  const [yr = 0, mo = 1] = ym.split('-').map(Number);

  const records =
    (await readTeamFile(
      monthlyFilename(BATCH_PREFIX, ym),
      BatchRecordsFileSchema,
      scope,
    )) ?? [];

  const byDay = new Map<string, { servers: Set<string>; records: number; backfilled: number }>();
  for (const r of records) {
    const ts = r.timestamp ?? '';
    if (ts.length < 10) continue;
    const d = ts.slice(0, 10);
    if (d.slice(0, 7) !== ym) continue;
    let e = byDay.get(d);
    if (!e) {
      e = { servers: new Set(), records: 0, backfilled: 0 };
      byDay.set(d, e);
    }
    const srv = (r.server ?? '').trim();
    if (srv !== '') e.servers.add(srv);
    e.records += 1;
    if (r.backfilled) e.backfilled += 1;
  }

  const expectedSet = new Set<string>();
  for (const pm of [ym, prevMonth(ym, 1), prevMonth(ym, 2)]) {
    const recs =
      pm === ym
        ? records
        : (await readTeamFile(monthlyFilename(BATCH_PREFIX, pm), BatchRecordsFileSchema, scope)) ?? [];
    for (const r of recs) {
      const s = (r.server ?? '').trim();
      if (s !== '') expectedSet.add(s);
    }
  }
  const expected = [...expectedSet].sort();

  // holidays.json is team-scoped in v1 (readJson), so a team's own calendar wins.
  const holidays =
    (await readTeamFile('holidays.json', HolidaysFileSchema, scope).catch(() => [])) ?? [];
  const holMap = new Map<string, string>();
  for (const h of holidays) {
    if (h.date && h.date.slice(0, 7) === ym) holMap.set(h.date, h.name ?? '');
  }

  const today = todayBkk();
  const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
  const days: CoverageDay[] = [];
  const summary: Record<CoverageStatus, number> = { ok: 0, partial: 0, missing: 0, future: 0 };

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    const dow = new Date(Date.UTC(yr, mo - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const isFuture = ds > today;
    const entry = byDay.get(ds) ?? { servers: new Set<string>(), records: 0, backfilled: 0 };
    const submitted = [...entry.servers].sort();
    const missing = expected.filter((s) => !entry.servers.has(s));

    let status: CoverageStatus;
    if (isFuture) status = 'future';
    else if (expected.length === 0) status = submitted.length ? 'ok' : 'missing';
    else if (missing.length === 0) status = 'ok';
    else if (submitted.length === 0) status = 'missing';
    else status = 'partial';
    summary[status] += 1;

    days.push({
      date: ds,
      weekday: WEEKDAY[dow] ?? '',
      dow,
      is_weekend: isWeekend,
      holiday: holMap.get(ds) ?? null,
      future: isFuture,
      submitted_servers: submitted,
      missing_servers: missing,
      records: entry.records,
      backfilled: entry.backfilled,
      status,
    });
  }

  return { month: ym, today, expected_servers: expected, days, summary };
}

// ─── Derived stats for the Batch Monitor table ───────────────────────────────

export interface RecordSummary {
  id: string;
  timestamp: string;
  reporter: string;
  server: string;
  backfilled: boolean;
  total: number;
  success: number;
  failed: number;
  na: number;
  other: number;
  /** Jobs whose status is not Success/NA — what an on-call actually looks for. */
  attention: Array<{ job: string; status: string; remark: string; folder: string }>;
}

const SUCCESS_RE = /^success$/i;
const NA_RE = /^(na|n\/a|-|)$/i;

/** Roll a record's job map into counts + the not-OK list. */
export function summarize(r: BatchRecord): RecordSummary {
  let success = 0;
  let failed = 0;
  let na = 0;
  let other = 0;
  const attention: RecordSummary['attention'] = [];
  for (const [job, cell] of Object.entries(r.jobs ?? {})) {
    const st = (cell.status ?? '').trim();
    if (SUCCESS_RE.test(st)) success += 1;
    else if (NA_RE.test(st)) na += 1;
    else if (/^(fail|failure|failed|error|aborted|unstable)$/i.test(st)) {
      failed += 1;
      attention.push({ job, status: st, remark: cell.remark ?? '', folder: cell.folder ?? '' });
    } else {
      other += 1;
      attention.push({ job, status: st, remark: cell.remark ?? '', folder: cell.folder ?? '' });
    }
  }
  return {
    id: r.id,
    timestamp: r.timestamp ?? '',
    reporter: r.reporter ?? '',
    server: r.server ?? '',
    backfilled: !!r.backfilled,
    total: Object.keys(r.jobs ?? {}).length,
    success,
    failed,
    na,
    other,
    attention,
  };
}
