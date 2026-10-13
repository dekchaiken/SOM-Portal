// som-portal-v2/src/learn/quiz.ts
// Quiz scoring and learner-safe views. Pure functions, unit tested.
import type { Question, Quiz } from './schema';

export type Answers = Record<string, unknown>;

const MAX_REGEX_LENGTH = 200;

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function sortedIndices(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || !v.every(isIndex)) return null;
  return [...new Set(v as number[])].sort((a, b) => a - b);
}

function shortMatches(q: Question, given: string): boolean {
  const accepted = Array.isArray(q.answer) ? q.answer : typeof q.answer === 'string' ? [q.answer] : [];
  const fold = (s: string) => (q.case_sensitive ? s : s.toLowerCase());
  const input = fold(given);
  for (const raw of accepted) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const target = fold(raw.trim());
    if (q.match_mode === 'contains') {
      if (input.includes(target)) return true;
    } else if (q.match_mode === 'regex') {
      if (raw.length > MAX_REGEX_LENGTH) continue;
      try {
        if (new RegExp(raw, q.case_sensitive ? '' : 'i').test(given)) return true;
      } catch {
        // An invalid pattern matches nothing, as in v1.
      }
    } else if (input === target) {
      return true;
    }
  }
  return false;
}

/** True when the learner's answer to one question is correct. Unanswered is always wrong. */
export function isCorrect(q: Question, given: unknown): boolean {
  switch (q.type) {
    case 'single':
      return isIndex(given) && isIndex(q.answer) && given === q.answer;
    case 'multi': {
      const user = sortedIndices(given);
      const correct = sortedIndices(q.answer);
      if (!user || !correct) return false;
      return user.length === correct.length && user.every((v, i) => v === correct[i]);
    }
    case 'truefalse':
      return typeof given === 'boolean' && typeof q.answer === 'boolean' && given === q.answer;
    case 'short':
      return typeof given === 'string' && given.trim() !== '' && shortMatches(q, given.trim());
    default:
      return false;
  }
}

export interface QuizScore {
  percent: number;
  correct: number;
  total: number;
  summary: { q_id: string; correct: boolean }[];
}

export function scoreQuiz(quiz: Quiz, answers: Answers): QuizScore {
  const total = quiz.questions.length;
  const summary = quiz.questions.map((q) => ({ q_id: q.id, correct: isCorrect(q, answers[q.id]) }));
  const correct = summary.filter((s) => s.correct).length;
  return { percent: total === 0 ? 0 : Math.round((correct / total) * 100), correct, total, summary };
}

/** What a learner may see before submitting: no answers, no explanations. */
export function learnerQuestion(q: Question) {
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    choices: q.type === 'short' ? [] : q.choices,
  };
}
