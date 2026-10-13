import { describe, expect, it } from 'vitest';
import { courseStatus, isCourseCompleted, percentPassed, phaseStatuses } from './rules';
import type { Phase, ProgressRow } from './schema';

const phase = (id: string, order: number): Phase =>
  ({ id, course_id: 'c', order, title: id, subtitle: '', description: '', icon: '', pass_score: 70, estimated_minutes: 20 }) as Phase;
const row = (phase_id: string, status: 'passed' | 'in_progress'): ProgressRow =>
  ({ id: '', user_id: 'u', phase_id, status, score: 0, last_score: 0, attempts: 0, completed_at: null }) as ProgressRow;

const phases = [phase('p1', 1), phase('p2', 2), phase('p3', 3)];

describe('phaseStatuses', () => {
  it('opens only the first phase for a new learner', () => {
    const s = phaseStatuses(phases, []);
    expect(s.get('p1')).toBe('unlocked');
    expect(s.get('p2')).toBe('locked');
    expect(s.get('p3')).toBe('locked');
  });

  it('opens the next phase after a pass', () => {
    const s = phaseStatuses(phases, [row('p1', 'passed')]);
    expect(s.get('p1')).toBe('passed');
    expect(s.get('p2')).toBe('unlocked');
    expect(s.get('p3')).toBe('locked');
  });

  it('never un-passes a phase, even with an in_progress row for it', () => {
    const s = phaseStatuses(phases, [row('p1', 'passed'), row('p1', 'in_progress')]);
    expect(s.get('p1')).toBe('passed');
  });

  it('treats a gap in ordering as open', () => {
    const gapped = [phase('a', 1), phase('b', 3)];
    expect(phaseStatuses(gapped, []).get('b')).toBe('unlocked');
  });
});

describe('course completion', () => {
  it('a course with no phases is never completed', () => {
    expect(isCourseCompleted([], [])).toBe(false);
  });

  it('a course is completed when every phase is passed', () => {
    expect(isCourseCompleted(phases, [row('p1', 'passed'), row('p2', 'passed'), row('p3', 'passed')])).toBe(true);
    expect(isCourseCompleted(phases, [row('p1', 'passed')])).toBe(false);
  });

  it('reports course status and percent', () => {
    expect(courseStatus(phases, [], 1)).toBe('locked');
    expect(courseStatus(phases, [], 0)).toBe('not_started');
    expect(courseStatus(phases, [row('p1', 'passed')], 0)).toBe('in_progress');
    expect(percentPassed(phases, [row('p1', 'passed')])).toBe(33);
  });
});
