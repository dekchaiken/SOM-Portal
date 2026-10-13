// som-portal-v2/src/learn/store.ts
// Reads a team's learning files: data/<team>/courses/... (spec section 1.1).
import { getDataAdapter } from '@/data/json-adapter';
import {
  CoursesFileSchema,
  PhasesFileSchema,
  LessonsFileSchema,
  ProgressFileSchema,
  type Course,
  type Phase,
  type Lesson,
  type ProgressRow,
} from './schema';

async function read<T>(team: string, file: string, parse: (raw: unknown) => T, fallback: T): Promise<T> {
  const raw = await getDataAdapter().read<unknown>({ team }, file);
  return raw == null ? fallback : parse(raw);
}

export function readCourses(team: string): Promise<Course[]> {
  return read(team, 'courses/courses.json', (r) => CoursesFileSchema.parse(r), []);
}

export function readPhases(team: string, courseId: string): Promise<Phase[]> {
  return read(team, `courses/${courseId}/phases.json`, (r) => PhasesFileSchema.parse(r), []);
}

export function readLessons(team: string, courseId: string): Promise<Lesson[]> {
  return read(team, `courses/${courseId}/lessons.json`, (r) => LessonsFileSchema.parse(r), []);
}

export function readProgress(team: string): Promise<ProgressRow[]> {
  return read(team, 'courses/progress.json', (r) => ProgressFileSchema.parse(r), []);
}
