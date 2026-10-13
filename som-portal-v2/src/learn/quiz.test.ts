import { describe, expect, it } from 'vitest';
import { isCorrect, learnerQuestion, scoreQuiz } from './quiz';
import type { Question, Quiz } from './schema';

const q = (over: Partial<Question>): Question =>
  ({ id: 'q', type: 'single', question: '', choices: ['a', 'b'], answer: 0, match_mode: 'exact', case_sensitive: false, explain: '', ...over }) as Question;

describe('isCorrect', () => {
  it('single: must pick the answer index, unanswered is wrong', () => {
    expect(isCorrect(q({ answer: 1 }), 1)).toBe(true);
    expect(isCorrect(q({ answer: 1 }), 0)).toBe(false);
    expect(isCorrect(q({ answer: 0 }), undefined)).toBe(false);
  });

  it('multi: exact set match, no partial credit', () => {
    const m = q({ type: 'multi', answer: [0, 2] });
    expect(isCorrect(m, [2, 0])).toBe(true);
    expect(isCorrect(m, [0])).toBe(false);
    expect(isCorrect(m, [0, 1, 2])).toBe(false);
    expect(isCorrect(m, [])).toBe(false);
  });

  it('truefalse: unanswered is wrong even when the answer is false (v1 defect 3)', () => {
    expect(isCorrect(q({ type: 'truefalse', answer: false }), undefined)).toBe(false);
    expect(isCorrect(q({ type: 'truefalse', answer: false }), false)).toBe(true);
    expect(isCorrect(q({ type: 'truefalse', answer: true }), false)).toBe(false);
  });

  it('short: exact, contains and regex, with case rules', () => {
    expect(isCorrect(q({ type: 'short', answer: ['Grafana'] }), ' grafana ')).toBe(true);
    expect(isCorrect(q({ type: 'short', answer: ['Grafana'], case_sensitive: true }), 'grafana')).toBe(false);
    expect(isCorrect(q({ type: 'short', answer: ['graf'], match_mode: 'contains' }), 'use grafana')).toBe(true);
    expect(isCorrect(q({ type: 'short', answer: ['^INC\\d+$'], match_mode: 'regex' }), 'INC123')).toBe(true);
    expect(isCorrect(q({ type: 'short', answer: ['(['], match_mode: 'regex' }), 'anything')).toBe(false);
    expect(isCorrect(q({ type: 'short', answer: ['x'] }), '   ')).toBe(false);
  });

  it('short: an over-long regex is ignored, not run', () => {
    expect(isCorrect(q({ type: 'short', answer: ['a'.repeat(300)], match_mode: 'regex' }), 'aaaa')).toBe(false);
  });
});

describe('scoreQuiz', () => {
  const quiz: Quiz = {
    id: 'quiz_1',
    phase_id: 'p1',
    title: 'Quiz',
    description: '',
    questions: [q({ id: 'a', answer: 0 }), q({ id: 'b', type: 'truefalse', answer: true }), q({ id: 'c', answer: 1 }), q({ id: 'd', answer: 0 })],
  };

  it('percent is over all questions, unanswered counts against', () => {
    const r = scoreQuiz(quiz, { a: 0, b: true });
    expect(r.correct).toBe(2);
    expect(r.total).toBe(4);
    expect(r.percent).toBe(50);
  });

  it('empty quiz scores zero', () => {
    expect(scoreQuiz({ ...quiz, questions: [] }, {}).percent).toBe(0);
  });

  it('learner view strips answers, explanations and matching rules', () => {
    const view = learnerQuestion(q({ type: 'short', answer: ['secret'], explain: 'why', choices: ['x'] }));
    expect(JSON.stringify(view)).not.toMatch(/secret|why/);
    expect(view.choices).toEqual([]);
  });
});
