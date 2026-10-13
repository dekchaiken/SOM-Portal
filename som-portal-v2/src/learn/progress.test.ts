import { describe, expect, it } from 'vitest';
import { markOpened, recordCompletion, recordQuizAttempt } from './progress';
import type { ProgressRow } from './schema';

const NOW = '2026-10-13T00:00:00.000Z';
const U = 'usr_1';
const P = 'phase_1';

describe('recordQuizAttempt', () => {
  it('a pass sets status passed and completed_at', () => {
    const r = (recordQuizAttempt([], U, P, 80, 70, NOW))[0]!;
    expect(r.status).toBe('passed');
    expect(r.completed_at).toBe(NOW);
    expect(r.score).toBe(80);
    expect(r.attempts).toBe(1);
  });

  it('a failed retry after a pass does not un-pass the phase (v1 defect 2)', () => {
    const passed = (recordQuizAttempt([], U, P, 90, 70, NOW))[0]!;
    const after = (recordQuizAttempt([passed], U, P, 10, 70, '2026-10-14T00:00:00.000Z'))[0]!;
    expect(after.status).toBe('passed');
    expect(after.completed_at).toBe(NOW);
    expect(after.score).toBe(90);
    expect(after.last_score).toBe(10);
    expect(after.attempts).toBe(2);
  });

  it('keeps the best score across failed attempts', () => {
    const a = (recordQuizAttempt([], U, P, 60, 70, NOW))[0]!;
    const b = (recordQuizAttempt([a], U, P, 40, 70, NOW))[0]!;
    expect(b.score).toBe(60);
    expect(b.last_score).toBe(40);
    expect(b.status).toBe('in_progress');
  });

  it('does not touch other learners or phases', () => {
    const other: ProgressRow = { id: 'x', user_id: 'usr_2', phase_id: P, status: 'in_progress', score: 0, last_score: 0, attempts: 0, completed_at: null } as ProgressRow;
    const rows = recordQuizAttempt([other], U, P, 100, 70, NOW);
    expect(rows.find((r) => r.user_id === 'usr_2')).toEqual(other);
    expect(rows.find((r) => r.user_id === U)?.status).toBe('passed');
  });
});

describe('markOpened and recordCompletion', () => {
  it('opening a phase starts it, and opening a passed phase changes nothing', () => {
    const started = (markOpened([], U, P, NOW))[0]!;
    expect(started.status).toBe('in_progress');
    const passed = recordCompletion([], U, P, NOW);
    expect(markOpened(passed, U, P, NOW)[0]!.status).toBe('passed');
  });

  it('completion marks a quiz-less phase passed with score 100', () => {
    const r = (recordCompletion([], U, P, NOW))[0]!;
    expect(r.status).toBe('passed');
    expect(r.score).toBe(100);
    expect(r.attempts).toBe(1);
  });
});
