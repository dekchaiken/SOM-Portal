// som-portal-v2/src/learn/rules.ts
// Pure unlock rules (spec section 2.3). No I/O, so they are unit tested directly.
import type { Phase, ProgressRow } from './schema';

export type PhaseStatus = 'passed' | 'in_progress' | 'unlocked' | 'locked';
export type CourseStatus = 'locked' | 'completed' | 'in_progress' | 'not_started';

/** Phase status for one learner. Order N opens after order N-1 is passed. */
export function phaseStatuses(phases: Phase[], progress: ProgressRow[]): Map<string, PhaseStatus> {
  const passed = new Set(progress.filter((r) => r.status === 'passed').map((r) => r.phase_id));
  const started = new Set(progress.filter((r) => r.status === 'in_progress').map((r) => r.phase_id));
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  const out = new Map<string, PhaseStatus>();
  for (const phase of sorted) {
    if (passed.has(phase.id)) {
      out.set(phase.id, 'passed');
      continue;
    }
    const prev = sorted.find((p) => p.order === phase.order - 1);
    const open = phase.order <= 1 || !prev || out.get(prev.id) === 'passed';
    if (!open) out.set(phase.id, 'locked');
    else out.set(phase.id, started.has(phase.id) ? 'in_progress' : 'unlocked');
  }
  return out;
}

/** A course is completed only when it has phases and every phase is passed (v1 rule). */
export function isCourseCompleted(phases: Phase[], progress: ProgressRow[]): boolean {
  if (phases.length === 0) return false;
  const statuses = phaseStatuses(phases, progress);
  return phases.every((p) => statuses.get(p.id) === 'passed');
}

export function courseStatus(
  phases: Phase[],
  progress: ProgressRow[],
  unmetPrereqs: number,
): CourseStatus {
  if (unmetPrereqs > 0) return 'locked';
  if (isCourseCompleted(phases, progress)) return 'completed';
  const statuses = phaseStatuses(phases, progress);
  const touched = [...statuses.values()].some((s) => s === 'passed' || s === 'in_progress');
  return touched ? 'in_progress' : 'not_started';
}

export function percentPassed(phases: Phase[], progress: ProgressRow[]): number {
  if (phases.length === 0) return 0;
  const statuses = phaseStatuses(phases, progress);
  const passed = phases.filter((p) => statuses.get(p.id) === 'passed').length;
  return Math.round((passed / phases.length) * 100);
}
