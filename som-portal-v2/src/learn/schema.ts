// som-portal-v2/src/learn/schema.ts
// Shapes of data/<team>/courses/*.json, matching v1 (spec section 1.4).
import { z } from 'zod';

export const CourseSchema = z
  .object({
    id: z.string(),
    order: z.coerce.number().default(0),
    title: z.string().default(''),
    subtitle: z.string().default(''),
    description: z.string().default(''),
    icon: z.string().default(''),
    cover_color: z.string().default('#f26419'),
    prerequisites: z.array(z.string()).default([]),
    published: z.boolean().default(true),
    is_popular: z.boolean().default(false),
    shared: z.boolean().default(false),
    owner_team: z.string().default(''),
    created_at: z.string().optional(),
  })
  .passthrough();
export type Course = z.infer<typeof CourseSchema>;
export const CoursesFileSchema = z.array(CourseSchema).catch([]);

export const PhaseSchema = z
  .object({
    id: z.string(),
    course_id: z.string(),
    order: z.coerce.number().default(0),
    title: z.string().default(''),
    subtitle: z.string().default(''),
    description: z.string().default(''),
    icon: z.string().default(''),
    pass_score: z.coerce.number().default(70),
    estimated_minutes: z.coerce.number().default(20),
  })
  .passthrough();
export type Phase = z.infer<typeof PhaseSchema>;
export const PhasesFileSchema = z.array(PhaseSchema).catch([]);

export const LessonSchema = z
  .object({
    id: z.string(),
    phase_id: z.string(),
    order: z.coerce.number().default(0),
    title: z.string().default(''),
    content_html: z.string().default(''),
  })
  .passthrough();
export type Lesson = z.infer<typeof LessonSchema>;
export const LessonsFileSchema = z.array(LessonSchema).catch([]);

export const ProgressRowSchema = z
  .object({
    id: z.string().default(''),
    user_id: z.string(),
    phase_id: z.string(),
    status: z.enum(['in_progress', 'passed']).catch('in_progress'),
    score: z.coerce.number().default(0),
    last_score: z.coerce.number().default(0),
    attempts: z.coerce.number().default(0),
    completed_at: z.string().nullable().default(null),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type ProgressRow = z.infer<typeof ProgressRowSchema>;
export const ProgressFileSchema = z.array(ProgressRowSchema).catch([]);
