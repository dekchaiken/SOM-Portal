// som-portal-v2/src/learn/progress.ts
// Pure progress updates. A passed phase is never downgraded (v1 defect 2).
import { randomBytes } from 'node:crypto';
import type { ProgressRow } from './schema';

function newId(): string {
  return `prog_${randomBytes(6).toString('hex')}`;
}

function blank(userId: string, phaseId: string, nowIso: string): ProgressRow {
  return {
    id: newId(),
    user_id: userId,
    phase_id: phaseId,
    status: 'in_progress',
    score: 0,
    last_score: 0,
    attempts: 0,
    completed_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  } as ProgressRow;
}

function upsert(rows: ProgressRow[], userId: string, phaseId: string, nowIso: string, change: (r: ProgressRow) => ProgressRow): ProgressRow[] {
  const idx = rows.findIndex((r) => r.user_id === userId && r.phase_id === phaseId);
  if (idx === -1) return [...rows, change(blank(userId, phaseId, nowIso))];
  return rows.map((r, i) => (i === idx ? change(r) : r));
}

/** The learner opened an unlocked phase. Starts it if it has not been started. */
export function markOpened(rows: ProgressRow[], userId: string, phaseId: string, nowIso: string): ProgressRow[] {
  return upsert(rows, userId, phaseId, nowIso, (r) =>
    r.status === 'passed' ? r : { ...r, status: 'in_progress', updated_at: nowIso },
  );
}

/** A quiz was submitted. Best score is kept; attempts count every submit. */
export function recordQuizAttempt(
  rows: ProgressRow[],
  userId: string,
  phaseId: string,
  percent: number,
  passScore: number,
  nowIso: string,
): ProgressRow[] {
  const passed = percent >= passScore;
  return upsert(rows, userId, phaseId, nowIso, (r) => {
    const alreadyPassed = r.status === 'passed';
    const nowPassed = alreadyPassed || passed;
    return {
      ...r,
      score: Math.max(r.score, percent),
      last_score: percent,
      attempts: r.attempts + 1,
      status: nowPassed ? 'passed' : 'in_progress',
      completed_at: nowPassed ? (r.completed_at ?? nowIso) : null,
      updated_at: nowIso,
    };
  });
}

/** Phase with no quiz is completed by the learner's button (v1 complete-phase). */
export function recordCompletion(rows: ProgressRow[], userId: string, phaseId: string, nowIso: string): ProgressRow[] {
  return upsert(rows, userId, phaseId, nowIso, (r) => ({
    ...r,
    status: 'passed',
    score: 100,
    last_score: 100,
    attempts: r.attempts + 1,
    completed_at: r.completed_at ?? nowIso,
    updated_at: nowIso,
  }));
}
