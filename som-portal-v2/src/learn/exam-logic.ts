// som-portal-v2/src/learn/exam-logic.ts
// Exam pool, shuffle, scoring and timing. Pure functions with an injectable rng.
import { isCorrect } from './quiz';
import { ExamConfigSchema, type Attempt, type ExamConfig, type ExamQuestion, type ViolationKey } from './exam-schema';
import type { Question } from './schema';

export type Rng = (n: number) => number;

export function defaultConfig(): ExamConfig {
  return ExamConfigSchema.parse({});
}

/** Stored config merged over defaults. Unknown or bad values fall back to defaults. */
export function resolveConfig(raw: unknown): ExamConfig {
  const parsed = ExamConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultConfig();
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Draw k distinct items with a partial Fisher-Yates from the front. */
function sample<T>(items: T[], k: number, rng: Rng): T[] {
  const out = [...items];
  const n = Math.min(k, out.length);
  for (let i = 0; i < n; i++) {
    const j = i + rng(out.length - i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, n);
}

/**
 * Question pool for one attempt (v1 examsBuildAttemptPool). The subset is drawn at random.
 * With shuffle_questions off, the drawn subset keeps the authoring order.
 */
export function buildPool(questions: ExamQuestion[], config: ExamConfig, rng: Rng): ExamQuestion[] {
  const total = questions.length;
  const { pool } = config;
  let picked: ExamQuestion[];
  if (pool.enabled && pool.total_show > 0 && pool.total_show < total) {
    if (pool.stratified && pool.categories.length > 0) {
      picked = pool.categories.flatMap((cat) => sample(questions.filter((q) => q.category === cat.name), cat.count, rng));
    } else {
      picked = sample(questions, pool.total_show, rng);
    }
    if (!config.shuffle_questions.enabled) {
      const rank = new Map(questions.map((q, i) => [q.id, i]));
      picked.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
  } else {
    picked = [...questions];
  }
  return config.shuffle_questions.enabled ? shuffle(picked, rng) : picked;
}

/** Shuffled choice order per single or multi question with more than one choice. */
export function buildChoiceOrders(pool: ExamQuestion[], config: ExamConfig, rng: Rng): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const q of pool) {
    if ((q.type !== 'single' && q.type !== 'multi') || q.choices.length <= 1) continue;
    const identity = q.choices.map((_, i) => i);
    out[q.id] = config.shuffle_choices.enabled ? shuffle(identity, rng) : identity;
  }
  return out;
}

/** Stored answers are in shuffled index space. Map one back to original indices. */
function toOriginal(q: ExamQuestion, value: unknown, order: number[] | undefined): unknown {
  if (!order) return value;
  if (q.type === 'single') return typeof value === 'number' && order[value] !== undefined ? order[value] : value;
  if (q.type === 'multi' && Array.isArray(value)) return value.map((v) => (typeof v === 'number' && order[v] !== undefined ? order[v] : v));
  return value;
}

export function penaltyFor(config: ExamConfig, violations: Attempt['violations']): number {
  let penalty = 0;
  const tab = config.tab_detection;
  if (tab.enabled && tab.action === 'penalty' && violations.tab_switch > tab.max_violations) {
    penalty += tab.penalty_pct;
  }
  const fs = config.fullscreen_lock;
  if (fs.enabled && fs.action === 'penalty' && violations.fullscreen_exit > fs.max_violations) {
    penalty += fs.penalty_pct;
  }
  return penalty;
}

export interface ScoreResult {
  raw_score: number;
  penalty: number;
  score: number;
  passed: boolean;
  correct_count: number;
  total_count: number;
  summary: { q_id: string; correct: boolean }[];
}

/** Score an attempt against the questions it was given (v1 examsScoreAttempt). */
export function scoreAttempt(
  questions: ExamQuestion[],
  attempt: Pick<Attempt, 'question_ids' | 'choice_orders' | 'answers' | 'violations'>,
  config: ExamConfig,
  passScore: number,
): ScoreResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const summary = attempt.question_ids.map((qid) => {
    const q = byId.get(qid);
    if (!q) return { q_id: qid, correct: false }; // deleted from the pool: counts wrong
    const asQuestion = {
      id: q.id,
      type: q.type,
      question: q.prompt,
      choices: q.choices,
      answer: q.answer,
      match_mode: q.match_mode,
      case_sensitive: q.case_sensitive,
      explain: q.explain,
    } as Question;
    const given = toOriginal(q, attempt.answers[qid], attempt.choice_orders[qid]);
    return { q_id: qid, correct: isCorrect(asQuestion, given) };
  });
  const total = attempt.question_ids.length;
  const correct = summary.filter((s) => s.correct).length;
  const raw = total === 0 ? 0 : Math.round((correct / total) * 100);
  const penalty = penaltyFor(config, attempt.violations);
  const score = Math.max(0, raw - penalty);
  return { raw_score: raw, penalty, score, passed: score >= passScore, correct_count: correct, total_count: total, summary };
}

export type WindowState = 'none' | 'upcoming' | 'open' | 'closed';

export function windowState(config: ExamConfig, now: Date): WindowState {
  const w = config.exam_window;
  if (!w.enabled) return 'none';
  const start = w.start ? new Date(w.start).getTime() : null;
  const end = w.end ? new Date(w.end).getTime() : null;
  const t = now.getTime();
  if (start !== null && t < start) return 'upcoming';
  if (end !== null && t > end) return 'closed';
  return 'open';
}

/** Seconds left for total-time mode. Null when there is no total limit. */
export function remainingSeconds(config: ExamConfig, attempt: Pick<Attempt, 'started_at'>, now: Date): number | null {
  if (!config.time_limit.enabled || config.time_limit.mode === 'per_question') return null;
  const end = new Date(attempt.started_at).getTime() + config.time_limit.total_minutes * 60_000;
  return Math.max(0, Math.round((end - now.getTime()) / 1000));
}

export function resultsVisible(config: ExamConfig, now: Date): boolean {
  const mode = config.show_results.mode;
  if (mode === 'never') return false;
  if (mode === 'after_window') {
    const w = windowState(config, now);
    return w === 'none' || w === 'closed';
  }
  return true;
}

export const COUNTED: readonly ViolationKey[] = ['tab_switch', 'blur', 'fullscreen_exit', 'paste', 'copy'];
