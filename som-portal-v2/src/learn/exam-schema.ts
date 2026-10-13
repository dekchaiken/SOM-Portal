// som-portal-v2/src/learn/exam-schema.ts
// Shapes of data/<team>/exams/*.json (spec section 1.4 and 6.4).
import { z } from 'zod';

const Bool = (d: boolean) => z.boolean().default(d);

export const ExamConfigSchema = z
  .object({
    pool: z
      .object({
        enabled: Bool(true),
        total_show: z.coerce.number().int().min(0).default(20),
        stratified: Bool(false),
        categories: z.array(z.object({ name: z.string(), count: z.coerce.number().int().min(0) })).default([]),
      })
      .default({}),
    shuffle_questions: z.object({ enabled: Bool(true) }).default({}),
    shuffle_choices: z.object({ enabled: Bool(true) }).default({}),
    attempts: z
      .object({
        enabled: Bool(true),
        max: z.coerce.number().int().min(0).default(1),
        cooldown_minutes: z.coerce.number().min(0).default(0),
      })
      .default({}),
    time_limit: z
      .object({
        enabled: Bool(true),
        mode: z.enum(['total', 'per_question', 'both']).catch('total').default('total'),
        total_minutes: z.coerce.number().min(0).default(60),
        per_question_seconds: z.coerce.number().min(0).default(0),
      })
      .default({}),
    tab_detection: z
      .object({
        enabled: Bool(false),
        max_violations: z.coerce.number().int().min(0).default(3),
        action: z.enum(['log', 'warn', 'penalty', 'force_submit']).catch('log').default('log'),
        penalty_pct: z.coerce.number().min(0).max(100).default(10),
      })
      .default({}),
    fullscreen_lock: z
      .object({
        enabled: Bool(false),
        max_violations: z.coerce.number().int().min(0).default(2),
        action: z.enum(['log', 'penalty', 'force_submit']).catch('log').default('log'),
        penalty_pct: z.coerce.number().min(0).max(100).default(10),
      })
      .default({}),
    exam_window: z
      .object({
        enabled: Bool(false),
        start: z.string().nullable().default(null),
        end: z.string().nullable().default(null),
      })
      .default({}),
    disable_copy_paste: z.object({ enabled: Bool(false) }).default({}),
    show_results: z
      .object({
        mode: z.enum(['after_submit', 'after_window', 'never']).catch('after_submit').default('after_submit'),
        show_answers: Bool(false),
        show_explains: Bool(false),
      })
      .default({}),
  })
  .passthrough();
export type ExamConfig = z.infer<typeof ExamConfigSchema>;

export const ExamSchema = z
  .object({
    id: z.string(),
    title: z.string().default(''),
    subtitle: z.string().default(''),
    description: z.string().default(''),
    icon: z.string().default(''),
    cover_color: z.string().default('#4f46e5'),
    status: z.enum(['draft', 'published', 'archived']).catch('draft').default('draft'),
    preset: z.string().default('basic'),
    pass_score: z.coerce.number().min(0).max(100).default(70),
    course_prerequisites: z.array(z.string()).default([]),
    is_popular: z.boolean().default(false),
    shared: z.boolean().default(false),
    owner_team: z.string().default(''),
    config: z.unknown().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type Exam = z.infer<typeof ExamSchema>;
export const ExamsFileSchema = z.array(ExamSchema).catch([]);

export const ExamQuestionSchema = z
  .object({
    id: z.string(),
    type: z.enum(['single', 'multi', 'truefalse', 'short']).catch('single'),
    prompt: z.string().default(''),
    choices: z.array(z.string()).default([]),
    answer: z.unknown().optional(),
    explain: z.string().default(''),
    category: z.string().default(''),
    image: z.string().default(''),
    match_mode: z.enum(['exact', 'contains', 'regex']).catch('exact').default('exact'),
    case_sensitive: z.boolean().default(false),
  })
  .passthrough();
export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;
export const ExamQuestionsFileSchema = z.array(ExamQuestionSchema).catch([]);

export const VIOLATION_KEYS = ['tab_switch', 'blur', 'fullscreen_exit', 'paste', 'copy'] as const;
export type ViolationKey = (typeof VIOLATION_KEYS)[number];

export const AttemptSchema = z
  .object({
    id: z.string(),
    exam_id: z.string(),
    user_id: z.string(),
    user_name: z.string().default(''),
    question_ids: z.array(z.string()).default([]),
    choice_orders: z.record(z.string(), z.array(z.number())).default({}),
    answers: z.record(z.string(), z.unknown()).default({}),
    status: z.enum(['in_progress', 'submitted']).catch('in_progress').default('in_progress'),
    started_at: z.string(),
    submitted_at: z.string().nullable().default(null),
    score: z.coerce.number().nullable().default(null),
    raw_score: z.coerce.number().nullable().default(null),
    penalty: z.coerce.number().default(0),
    passed: z.boolean().default(false),
    auto_submitted: z.boolean().default(false),
    violations: z
      .object({ tab_switch: z.number().default(0), blur: z.number().default(0), fullscreen_exit: z.number().default(0), paste: z.number().default(0), copy: z.number().default(0) })
      .default({}),
    events: z.array(z.object({ ts: z.string(), type: z.string(), meta: z.unknown().optional() })).default([]),
  })
  .passthrough();
export type Attempt = z.infer<typeof AttemptSchema>;
export const AttemptsFileSchema = z.array(AttemptSchema).catch([]);
