// som-portal-v2/src/learn/exam-service.ts
// Exam taking: list, start (with prerequisite, window, attempt and cooldown locks),
// autosave, violation events, submit and result visibility. Attempts are written
// under one locked read-modify-write so a double click cannot start two attempts.
import { randomBytes, randomInt } from 'node:crypto';
import type { Session } from '@/auth/session';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { getDataAdapter } from '@/data/json-adapter';
import { splitRows } from './rows';
import { isLearnAdmin, requireLearnAccess } from './service';
import { readCourses, readPhases, readProgress } from './store';
import { isCourseCompleted } from './rules';
import {
  buildChoiceOrders,
  buildPool,
  remainingSeconds,
  resolveConfig,
  resultsVisible,
  scoreAttempt,
  windowState,
  type Rng,
} from './exam-logic';
import {
  AttemptSchema,
  ExamQuestionsFileSchema,
  ExamsFileSchema,
  VIOLATION_KEYS,
  type Attempt,
  type Exam,
  type ExamConfig,
  type ExamQuestion,
  type ViolationKey,
} from './exam-schema';

const EXAMS_FILE = 'exams/exams.json';
const ATTEMPTS_FILE = 'exams/attempts.json';
const MAX_EVENTS = 300;
const HEARTBEAT = 'heartbeat';

/** Crypto-backed rng for shuffles. randomInt needs n >= 1, which every caller guarantees. */
const secureRng: Rng = (n) => randomInt(n);

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

async function readExams(team: string): Promise<Exam[]> {
  const raw = await getDataAdapter().read<unknown>({ team }, EXAMS_FILE);
  return ExamsFileSchema.parse(raw ?? []);
}

async function readExamQuestions(team: string, examId: string): Promise<ExamQuestion[]> {
  const raw = await getDataAdapter().read<unknown>({ team }, `exams/${examId}/questions.json`);
  return ExamQuestionsFileSchema.parse(raw ?? []);
}

async function readAttempts(team: string): Promise<Attempt[]> {
  const raw = await getDataAdapter().read<unknown>({ team }, ATTEMPTS_FILE);
  return splitRows(raw, AttemptSchema).valid;
}

interface ExamContext {
  exam: Exam;
  config: ExamConfig;
  questions: ExamQuestion[];
}

async function loadContext(team: string, examId: string): Promise<ExamContext> {
  const exam = (await readExams(team)).find((e) => e.id === examId);
  if (!exam) throw new NotFoundError('Exam not found');
  return { exam, config: resolveConfig(exam.config), questions: await readExamQuestions(team, examId) };
}

/** Learners see published exams only. Admins see every exam. */
async function visibleExam(session: Session, examId: string): Promise<Exam> {
  await requireLearnAccess(session);
  const exam = (await readExams(session.team)).find((e) => e.id === examId);
  if (!exam || (!isLearnAdmin(session) && exam.status !== 'published')) throw new NotFoundError('Exam not found');
  return exam;
}

function isExpired(a: Attempt, config: ExamConfig, now: Date): boolean {
  const rem = remainingSeconds(config, a, now);
  return rem !== null && rem <= 0;
}

/** Score and close an attempt. Used for submit, time-out and forced submit. */
function finalize(a: Attempt, ctx: ExamContext, now: Date, auto: boolean): Attempt {
  const r = scoreAttempt(ctx.questions, a, ctx.config, ctx.exam.pass_score);
  return {
    ...a,
    status: 'submitted',
    submitted_at: now.toISOString(),
    raw_score: r.raw_score,
    penalty: r.penalty,
    score: r.score,
    passed: r.passed,
    auto_submitted: a.auto_submitted || auto,
  };
}

/** Unmet course prerequisites. Applies to every role, admins included (v1 rule). */
async function unmetPrereqs(session: Session, exam: Exam): Promise<string[]> {
  if (exam.course_prerequisites.length === 0) return [];
  const courses = await readCourses(session.team);
  const rows = (await readProgress(session.team)).filter((r) => r.user_id === session.sub);
  const titles: string[] = [];
  for (const id of exam.course_prerequisites) {
    const course = courses.find((c) => c.id === id);
    if (!course) continue;
    if (!isCourseCompleted(await readPhases(session.team, id), rows)) titles.push(course.title);
  }
  return titles;
}

function submittedCount(attempts: Attempt[], examId: string, userId: string): number {
  return attempts.filter((a) => a.exam_id === examId && a.user_id === userId && a.status === 'submitted').length;
}

/** Why the learner cannot start now, or null when they can. Window is learner-only. */
function startBlock(
  session: Session,
  ctx: ExamContext,
  attempts: Attempt[],
  unmet: string[],
  now: Date,
): string | null {
  if (unmet.length > 0) return `Complete these courses first: ${unmet.join(', ')}`;
  if (!isLearnAdmin(session)) {
    const w = windowState(ctx.config, now);
    if (w === 'upcoming') return 'The exam window has not opened yet';
    if (w === 'closed') return 'The exam window has closed';
  }
  const { attempts: rule } = ctx.config;
  const mine = attempts.filter((a) => a.exam_id === ctx.exam.id && a.user_id === session.sub && a.status === 'submitted');
  if (rule.enabled && rule.max > 0 && mine.length >= rule.max) return 'No attempts left';
  if (rule.enabled && rule.cooldown_minutes > 0 && mine.length > 0) {
    const last = Math.max(...mine.map((a) => new Date(a.submitted_at ?? 0).getTime()));
    const readyAt = last + rule.cooldown_minutes * 60_000;
    if (readyAt > now.getTime()) {
      return `Wait ${Math.ceil((readyAt - now.getTime()) / 60_000)} more minute(s) before the next attempt`;
    }
  }
  return null;
}

export interface ExamListItem {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  cover_color: string;
  status: Exam['status'];
  pass_score: number;
  question_count: number;
  time_limit_minutes: number | null;
  attempts_max: number | null;
  my_submitted: number;
  my_best: number | null;
  my_passed: boolean;
  my_in_progress: string | null;
  blocked: string | null;
}

export async function listExams(session: Session): Promise<ExamListItem[]> {
  await requireLearnAccess(session);
  const admin = isLearnAdmin(session);
  const now = new Date();
  const [exams, attempts] = await Promise.all([readExams(session.team), readAttempts(session.team)]);
  const items: ExamListItem[] = [];
  for (const exam of exams) {
    if (!admin && exam.status !== 'published') continue;
    const ctx = { exam, config: resolveConfig(exam.config), questions: await readExamQuestions(session.team, exam.id) };
    const mine = attempts.filter((a) => a.exam_id === exam.id && a.user_id === session.sub);
    const done = mine.filter((a) => a.status === 'submitted');
    const open = mine.find((a) => a.status === 'in_progress');
    const best = done.reduce<number | null>((m, a) => (a.score === null ? m : m === null ? a.score : Math.max(m, a.score)), null);
    const unmet = await unmetPrereqs(session, exam);
    items.push({
      id: exam.id,
      title: exam.title,
      subtitle: exam.subtitle,
      icon: exam.icon,
      cover_color: exam.cover_color,
      status: exam.status,
      pass_score: exam.pass_score,
      question_count: ctx.questions.length,
      time_limit_minutes: ctx.config.time_limit.enabled ? ctx.config.time_limit.total_minutes : null,
      attempts_max: ctx.config.attempts.enabled && ctx.config.attempts.max > 0 ? ctx.config.attempts.max : null,
      my_submitted: done.length,
      my_best: best,
      my_passed: done.some((a) => a.passed),
      my_in_progress: open?.id ?? null,
      blocked: open ? null : startBlock(session, ctx, attempts, unmet, now),
    });
  }
  return items;
}

export async function getExamDetail(session: Session, examId: string) {
  const exam = await visibleExam(session, examId);
  const now = new Date();
  const config = resolveConfig(exam.config);
  const attempts = await readAttempts(session.team);
  const questions = await readExamQuestions(session.team, examId);
  const unmet = await unmetPrereqs(session, exam);
  const mine = attempts
    .filter((a) => a.exam_id === examId && a.user_id === session.sub)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((a) => ({
      id: a.id,
      status: a.status,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      score: a.status === 'submitted' && resultsVisible(config, now) ? a.score : null,
      passed: a.status === 'submitted' && resultsVisible(config, now) ? a.passed : null,
    }));
  const open = mine.find((a) => a.status === 'in_progress') ?? null;
  return {
    exam: {
      id: exam.id,
      title: exam.title,
      subtitle: exam.subtitle,
      description: exam.description,
      icon: exam.icon,
      cover_color: exam.cover_color,
      status: exam.status,
      pass_score: exam.pass_score,
      question_count: config.pool.enabled && config.pool.total_show > 0 ? Math.min(config.pool.total_show, questions.length) : questions.length,
      rules: {
        time_limit_minutes: config.time_limit.enabled ? config.time_limit.total_minutes : null,
        attempts_max: config.attempts.enabled && config.attempts.max > 0 ? config.attempts.max : null,
        cooldown_minutes: config.attempts.enabled ? config.attempts.cooldown_minutes : 0,
        tab_detection: config.tab_detection.enabled,
        fullscreen_lock: config.fullscreen_lock.enabled,
        disable_copy_paste: config.disable_copy_paste.enabled,
        window: config.exam_window.enabled ? { start: config.exam_window.start, end: config.exam_window.end } : null,
        show_results: config.show_results.mode,
      },
    },
    unmet_prereqs: unmet,
    blocked: open ? null : startBlock(session, { exam, config, questions }, attempts, unmet, now),
    attempts: mine,
    in_progress_id: open?.id ?? null,
  };
}

export interface LearnerQuestion {
  id: string;
  type: ExamQuestion['type'];
  prompt: string;
  image: string;
  category: string;
  choices: string[];
}

export interface AttemptView {
  id: string;
  exam_id: string;
  exam_title: string;
  status: 'in_progress';
  started_at: string;
  remaining_seconds: number | null;
  time_mode: 'total' | 'per_question' | 'both';
  per_question_seconds: number;
  questions: LearnerQuestion[];
  answers: Record<string, unknown>;
  violations: Attempt['violations'];
  config: {
    tab_detection: boolean;
    fullscreen_lock: boolean;
    disable_copy_paste: boolean;
    shuffle_choices: boolean;
  };
}

function toLearnerQuestion(q: ExamQuestion, order: number[] | undefined): LearnerQuestion {
  const choices = order ? order.map((i) => q.choices[i] ?? '') : q.choices;
  return { id: q.id, type: q.type, prompt: q.prompt, image: q.image, category: q.category, choices };
}

function attemptView(a: Attempt, ctx: ExamContext, now: Date): AttemptView {
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  const questions = a.question_ids
    .map((id) => byId.get(id))
    .filter((q): q is ExamQuestion => !!q)
    .map((q) => toLearnerQuestion(q, a.choice_orders[q.id]));
  return {
    id: a.id,
    exam_id: a.exam_id,
    exam_title: ctx.exam.title,
    status: 'in_progress',
    started_at: a.started_at,
    remaining_seconds: remainingSeconds(ctx.config, a, now),
    time_mode: ctx.config.time_limit.mode,
    per_question_seconds: ctx.config.time_limit.per_question_seconds,
    questions,
    answers: a.answers,
    violations: a.violations,
    config: {
      tab_detection: ctx.config.tab_detection.enabled,
      fullscreen_lock: ctx.config.fullscreen_lock.enabled,
      disable_copy_paste: ctx.config.disable_copy_paste.enabled,
      shuffle_choices: ctx.config.shuffle_choices.enabled,
    },
  };
}

/** Text of the correct answer, for the result view. */
function answerText(q: ExamQuestion): string {
  const ans = q.answer;
  if (Array.isArray(ans)) return ans.map((i) => (typeof i === 'number' ? (q.choices[i] ?? String(i)) : String(i))).join(', ');
  if (typeof ans === 'number' && q.choices.length > 0) return q.choices[ans] ?? String(ans);
  return ans == null ? '' : String(ans);
}

export interface ResultView {
  attempt_id: string;
  exam_title: string;
  status: 'submitted';
  visible: boolean;
  submitted_at: string | null;
  auto_submitted: boolean;
  pass_score: number;
  score: number | null;
  raw_score: number | null;
  penalty: number;
  passed: boolean | null;
  correct_count: number | null;
  total_count: number;
  summary: { q_id: string; prompt: string; correct: boolean; given: unknown; answer?: string; explain?: string }[] | null;
}

function resultView(a: Attempt, ctx: ExamContext, now: Date): ResultView {
  const visible = resultsVisible(ctx.config, now);
  const base = {
    attempt_id: a.id,
    exam_title: ctx.exam.title,
    status: 'submitted' as const,
    submitted_at: a.submitted_at,
    auto_submitted: a.auto_submitted,
    pass_score: ctx.exam.pass_score,
    total_count: a.question_ids.length,
  };
  if (!visible) {
    return { ...base, visible: false, score: null, raw_score: null, penalty: 0, passed: null, correct_count: null, summary: null };
  }
  const r = scoreAttempt(ctx.questions, a, ctx.config, ctx.exam.pass_score);
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  const summary = r.summary.map((s) => {
    const q = byId.get(s.q_id);
    return {
      q_id: s.q_id,
      prompt: q?.prompt ?? '',
      correct: s.correct,
      given: a.answers[s.q_id] ?? null,
      answer: ctx.config.show_results.show_answers && q ? answerText(q) : undefined,
      explain: ctx.config.show_results.show_explains && q ? q.explain : undefined,
    };
  });
  return {
    ...base,
    visible: true,
    score: a.score ?? r.score,
    raw_score: a.raw_score ?? r.raw_score,
    penalty: a.penalty,
    passed: a.passed,
    correct_count: r.correct_count,
    summary,
  };
}

/** Start a new attempt, or resume the open one. Locks are checked under the file lock. */
export async function startAttempt(session: Session, examId: string): Promise<AttemptView> {
  const exam = await visibleExam(session, examId);
  const team = session.team;
  const ctx: ExamContext = { exam, config: resolveConfig(exam.config), questions: await readExamQuestions(team, examId) };
  if (ctx.questions.length === 0) throw new ValidationError('This exam has no questions yet');
  const unmet = await unmetPrereqs(session, exam);

  let out!: Attempt;
  await getDataAdapter().update<unknown[]>({ team }, ATTEMPTS_FILE, (raw) => {
    const { valid, invalid } = splitRows(raw, AttemptSchema);
    const now = new Date();
    const open = valid.find((a) => a.exam_id === examId && a.user_id === session.sub && a.status === 'in_progress');
    if (open && !isExpired(open, ctx.config, now)) {
      out = open;
      return [...invalid, ...valid];
    }
    let next = valid;
    if (open) {
      const closed = finalize(open, ctx, now, true);
      next = valid.map((a) => (a.id === open.id ? closed : a));
    }
    const block = startBlock(session, ctx, next, unmet, now);
    if (block) throw new ForbiddenError(block);

    const pool = buildPool(ctx.questions, ctx.config, secureRng);
    const choice_orders = buildChoiceOrders(pool, ctx.config, secureRng);
    const fresh = AttemptSchema.parse({
      id: newId('att'),
      exam_id: examId,
      user_id: session.sub,
      user_name: session.username,
      question_ids: pool.map((q) => q.id),
      choice_orders,
      started_at: now.toISOString(),
    });
    out = fresh;
    return [...invalid, ...next, fresh];
  });
  return attemptView(out, ctx, new Date());
}

/**
 * Locked change to one of the caller's attempts. A timed-out attempt is closed first.
 * `fn` must not throw for a closed attempt: it returns the closed state as its value.
 */
async function mutateAttempt<T>(
  session: Session,
  attemptId: string,
  fn: (a: Attempt, ctx: ExamContext, now: Date) => { next: Attempt; value: T },
): Promise<T> {
  const team = session.team;
  const pre = (await readAttempts(team)).find((a) => a.id === attemptId && a.user_id === session.sub);
  if (!pre) throw new NotFoundError('Attempt not found');
  const ctx = await loadContext(team, pre.exam_id);
  let out!: T;
  await getDataAdapter().update<unknown[]>({ team }, ATTEMPTS_FILE, (raw) => {
    const { valid, invalid } = splitRows(raw, AttemptSchema);
    const idx = valid.findIndex((a) => a.id === attemptId && a.user_id === session.sub);
    if (idx === -1) throw new NotFoundError('Attempt not found');
    const now = new Date();
    let cur = valid[idx]!;
    if (cur.status === 'in_progress' && isExpired(cur, ctx.config, now)) cur = finalize(cur, ctx, now, true);
    const { next, value } = fn(cur, ctx, now);
    out = value;
    return [...invalid, ...valid.map((a, i) => (i === idx ? next : a))];
  });
  return out;
}

export async function getAttempt(session: Session, attemptId: string): Promise<AttemptView | ResultView> {
  return mutateAttempt<AttemptView | ResultView>(session, attemptId, (a, ctx, now) => {
    const value = a.status === 'submitted' ? resultView(a, ctx, now) : attemptView(a, ctx, now);
    return { next: a, value };
  });
}

export interface SaveResult {
  remaining_seconds: number | null;
  closed: boolean;
}

/** Autosave. Answers are stored as the learner sent them (display index space). */
export async function saveAnswers(session: Session, attemptId: string, answers: Record<string, unknown>): Promise<SaveResult> {
  return mutateAttempt<SaveResult>(session, attemptId, (a, ctx, now) => {
    if (a.status === 'submitted') return { next: a, value: { remaining_seconds: 0, closed: true } };
    const allowed = new Set(a.question_ids);
    const merged = { ...a.answers };
    for (const [qid, value] of Object.entries(answers)) {
      if (allowed.has(qid)) merged[qid] = value;
    }
    const next = { ...a, answers: merged };
    return { next, value: { remaining_seconds: remainingSeconds(ctx.config, next, now), closed: false } };
  });
}

export interface EventResult extends SaveResult {
  violations: Attempt['violations'];
}

function isViolation(type: string): type is ViolationKey {
  return (VIOLATION_KEYS as readonly string[]).includes(type);
}

/**
 * Record a client event. Violation types count up. A force_submit action closes the
 * attempt once the count passes the limit. The heartbeat only checks the clock.
 */
export async function recordEvent(
  session: Session,
  attemptId: string,
  type: string,
  meta?: unknown,
): Promise<EventResult> {
  if (type !== HEARTBEAT && !isViolation(type)) throw new ValidationError(`Unknown event type: ${type}`);
  return mutateAttempt<EventResult>(session, attemptId, (a, ctx, now) => {
    if (a.status === 'submitted') {
      return { next: a, value: { remaining_seconds: 0, closed: true, violations: a.violations } };
    }
    if (type === HEARTBEAT) {
      const rem = remainingSeconds(ctx.config, a, now);
      return { next: a, value: { remaining_seconds: rem, closed: false, violations: a.violations } };
    }
    const key = type as ViolationKey;
    const violations = { ...a.violations, [key]: a.violations[key] + 1 };
    const events = [...a.events, { ts: now.toISOString(), type, meta }].slice(-MAX_EVENTS);
    let next: Attempt = { ...a, violations, events };
    const tab = ctx.config.tab_detection;
    const fs = ctx.config.fullscreen_lock;
    const forced =
      (key === 'tab_switch' && tab.enabled && tab.action === 'force_submit' && violations.tab_switch > tab.max_violations) ||
      (key === 'fullscreen_exit' && fs.enabled && fs.action === 'force_submit' && violations.fullscreen_exit > fs.max_violations);
    if (forced) next = finalize(next, ctx, now, true);
    return {
      next,
      value: {
        remaining_seconds: next.status === 'in_progress' ? remainingSeconds(ctx.config, next, now) : 0,
        closed: next.status === 'submitted',
        violations,
      },
    };
  });
}

/** Explicit submit. Submitting twice returns the same result. */
export async function submitAttempt(session: Session, attemptId: string): Promise<ResultView> {
  return mutateAttempt<ResultView>(session, attemptId, (a, ctx, now) => {
    const next = a.status === 'submitted' ? a : finalize(a, ctx, now, false);
    return { next, value: resultView(next, ctx, now) };
  });
}
