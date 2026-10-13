// som-portal-v2/src/learn/service.ts
// Learner read path: course list, course, phases and lessons, with the v1 unlock
// rules applied. Admins (ADMIN_ROLES) bypass locks, as in v1.
import type { Session } from '@/auth/session';
import { ADMIN_ROLES } from '@/auth/policy';
import { requireTeamFeature } from '@/team/features';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { readCourses, readLessons, readPhases, readProgress } from './store';
import { courseStatus, percentPassed, phaseStatuses, type CourseStatus, type PhaseStatus } from './rules';
import type { Course, Lesson, Phase, ProgressRow } from './schema';
import { sanitizeLessonHtml } from './sanitize';

export const LEARN_FEATURE = 'learning';

export function isLearnAdmin(session: Session): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(session.role);
}

export async function requireLearnAccess(session: Session): Promise<void> {
  await requireTeamFeature(session, LEARN_FEATURE);
}

function mine(rows: ProgressRow[], userId: string): ProgressRow[] {
  return rows.filter((r) => r.user_id === userId);
}

export interface CourseListItem extends Course {
  phases_count: number;
  my_percent: number;
  my_status: CourseStatus;
  unmet_prereqs: { id: string; title: string }[];
  my_locked: boolean;
}

export async function listCourses(session: Session): Promise<CourseListItem[]> {
  await requireLearnAccess(session);
  const admin = isLearnAdmin(session);
  const team = session.team;
  const [courses, progress] = await Promise.all([readCourses(team), readProgress(team)]);
  const mineRows = mine(progress, session.sub);
  const phasesByCourse = new Map<string, Phase[]>();
  for (const c of courses) phasesByCourse.set(c.id, await readPhases(team, c.id));

  const completed = (courseId: string) =>
    courseCompleted(phasesByCourse.get(courseId) ?? [], mineRows);

  const items: CourseListItem[] = [];
  for (const c of courses.slice().sort((a, b) => a.order - b.order)) {
    if (!admin && !c.published) continue;
    const phases = phasesByCourse.get(c.id) ?? [];
    const unmet = c.prerequisites
      .map((id) => courses.find((x) => x.id === id))
      .filter((x): x is Course => !!x && !completed(x.id))
      .map((x) => ({ id: x.id, title: x.title }));
    const locked = !admin && unmet.length > 0;
    items.push({
      ...c,
      phases_count: phases.length,
      my_percent: percentPassed(phases, mineRows),
      my_status: courseStatus(phases, mineRows, locked ? unmet.length : 0),
      unmet_prereqs: unmet,
      my_locked: locked,
    });
  }
  return items;
}

function courseCompleted(phases: Phase[], rows: ProgressRow[]): boolean {
  return phases.length > 0 && phases.every((p) => rows.some((r) => r.phase_id === p.id && r.status === 'passed'));
}

export interface PhaseView extends Phase {
  my_status: PhaseStatus;
  my_score: number | null;
  my_attempts: number;
}

export async function getCourseDetail(session: Session, courseId: string) {
  await requireLearnAccess(session);
  const admin = isLearnAdmin(session);
  const team = session.team;
  const courses = await readCourses(team);
  const course = courses.find((c) => c.id === courseId);
  if (!course || (!admin && !course.published)) throw new NotFoundError('Course not found');

  const progress = mine(await readProgress(team), session.sub);
  const unmet: { id: string; title: string }[] = [];
  for (const id of course.prerequisites) {
    const pre = courses.find((c) => c.id === id);
    if (!pre) continue;
    const pp = await readPhases(team, pre.id);
    if (!courseCompleted(pp, progress)) unmet.push({ id: pre.id, title: pre.title });
  }
  if (!admin && unmet.length > 0) {
    throw new ForbiddenError(`Course locked, complete first: ${unmet.map((u) => u.title).join(', ')}`);
  }

  const phases = await readPhases(team, course.id);
  const statuses = phaseStatuses(phases, progress);
  const phaseViews: PhaseView[] = phases
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const row = progress.find((r) => r.phase_id === p.id);
      return {
        ...p,
        my_status: statuses.get(p.id) ?? 'locked',
        my_score: row ? row.score : null,
        my_attempts: row?.attempts ?? 0,
      };
    });

  return {
    course: { ...course, my_percent: percentPassed(phases, progress), unmet_prereqs: unmet },
    phases: phaseViews,
  };
}

async function findPhase(team: string, phaseId: string): Promise<{ phase: Phase; courseId: string } | null> {
  for (const c of await readCourses(team)) {
    const hit = (await readPhases(team, c.id)).find((p) => p.id === phaseId);
    if (hit) return { phase: hit, courseId: c.id };
  }
  return null;
}

export interface LessonView extends Lesson {
  content_html: string;
}

/**
 * Lessons of one phase. Locks apply to learners. The v1 endpoint without a
 * phase_id (returns every lesson to any user) is intentionally not provided.
 */
export async function getPhaseLessons(
  session: Session,
  phaseId: string,
): Promise<{ phase: Phase; lessons: LessonView[] }> {
  await requireLearnAccess(session);
  const admin = isLearnAdmin(session);
  const team = session.team;
  const found = await findPhase(team, phaseId);
  if (!found) throw new NotFoundError('Phase not found');

  if (!admin) {
    const detail = await getCourseDetail(session, found.courseId);
    const phase = detail.phases.find((p) => p.id === phaseId);
    if (!phase) throw new NotFoundError('Phase not found');
    if (phase.my_status === 'locked') throw new ForbiddenError('Phase is locked');
  }

  const lessons = (await readLessons(team, found.courseId))
    .filter((l) => l.phase_id === phaseId)
    .sort((a, b) => a.order - b.order)
    .map((l) => ({ ...l, content_html: sanitizeLessonHtml(l.content_html) }));
  return { phase: found.phase, lessons };
}
