import { describe, expect, it } from 'vitest';
import { buildChoiceOrders, buildPool, penaltyFor, remainingSeconds, resolveConfig, resultsVisible, scoreAttempt, windowState } from './exam-logic';
import type { ExamQuestion } from './exam-schema';

const seq = (n: number) => (_m: number) => 0;
const q = (id: string, over: Partial<ExamQuestion> = {}): ExamQuestion =>
  ({ id, type: 'single', prompt: id, choices: ['a', 'b', 'c'], answer: 0, explain: '', category: '', image: '', match_mode: 'exact', case_sensitive: false, ...over }) as ExamQuestion;
const cfg = (over: Record<string, unknown> = {}) => resolveConfig(over);

describe('config', () => {
  it('fills defaults from an empty object', () => {
    const c = cfg();
    expect(c.attempts.max).toBe(1);
    expect(c.time_limit.total_minutes).toBe(60);
    expect(c.show_results.mode).toBe('after_submit');
  });
  it('falls back to defaults on a broken config', () => {
    expect(resolveConfig('nonsense').attempts.max).toBe(1);
  });
});

describe('pool', () => {
  const qs = [q('a'), q('b'), q('c'), q('d')];
  it('takes total_show questions and keeps them when shuffle is off', () => {
    const c = cfg({ pool: { enabled: true, total_show: 2 }, shuffle_questions: { enabled: false } });
    expect(buildPool(qs, c, seq(4)).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('stratified takes up to count per category', () => {
    const cats = [q('x1', { category: 'net' }), q('x2', { category: 'net' }), q('y1', { category: 'db' })];
    const c = cfg({ pool: { enabled: true, total_show: 2, stratified: true, categories: [{ name: 'net', count: 1 }, { name: 'db', count: 1 }] }, shuffle_questions: { enabled: false } });
    expect(buildPool(cats, c, seq(3)).map((x) => x.id)).toEqual(['x1', 'y1']);
  });
});

describe('choice orders and scoring', () => {
  it('a shuffled single answer is mapped back to the original choice', () => {
    const question = q('s', { answer: 0 });
    const c = cfg({ shuffle_choices: { enabled: true } });
    // Shuffled position 2 holds original choice 0.
    const order = { s: [1, 2, 0] };
    const r = scoreAttempt([question], { question_ids: ['s'], choice_orders: order, answers: { s: 2 }, violations: { tab_switch: 0, blur: 0, fullscreen_exit: 0, paste: 0, copy: 0 } }, c, 70);
    expect(r.correct_count).toBe(1);
    expect(r.score).toBe(100);
  });

  it('unanswered and deleted questions count as wrong; the total stays', () => {
    const r = scoreAttempt([q('a')], { question_ids: ['a', 'gone'], choice_orders: {}, answers: {}, violations: { tab_switch: 0, blur: 0, fullscreen_exit: 0, paste: 0, copy: 0 } }, cfg(), 70);
    expect(r.total_count).toBe(2);
    expect(r.correct_count).toBe(0);
    expect(r.score).toBe(0);
  });

  it('tab penalty applies only after the limit and only in penalty mode', () => {
    const c = cfg({ tab_detection: { enabled: true, max_violations: 2, action: 'penalty', penalty_pct: 10 } });
    const v = (n: number) => ({ tab_switch: n, blur: 0, fullscreen_exit: 0, paste: 0, copy: 0 });
    expect(penaltyFor(c, v(2))).toBe(0);
    expect(penaltyFor(c, v(3))).toBe(10);
    const logOnly = cfg({ tab_detection: { enabled: true, max_violations: 2, action: 'log', penalty_pct: 10 } });
    expect(penaltyFor(logOnly, v(9))).toBe(0);
  });

  it('blur is recorded but never penalised (kept from v1; see handoff)', () => {
    const c = cfg({ tab_detection: { enabled: true, max_violations: 0, action: 'penalty', penalty_pct: 50 } });
    expect(penaltyFor(c, { tab_switch: 0, blur: 9, fullscreen_exit: 0, paste: 0, copy: 0 })).toBe(0);
  });

  it('score is clamped at zero after penalty', () => {
    const c = cfg({ tab_detection: { enabled: true, max_violations: 0, action: 'penalty', penalty_pct: 80 } });
    const r = scoreAttempt([q('a')], { question_ids: ['a'], choice_orders: {}, answers: { a: 0 }, violations: { tab_switch: 1, blur: 0, fullscreen_exit: 0, paste: 0, copy: 0 } }, c, 0);
    expect(r.score).toBe(20);
    expect(r.raw_score).toBe(100);
  });

  it('builds identity orders when choice shuffle is off', () => {
    const c = cfg({ shuffle_choices: { enabled: false } });
    expect(buildChoiceOrders([q('a')], c, seq(3))).toEqual({ a: [0, 1, 2] });
  });
});

describe('window and timing', () => {
  const c = cfg({ exam_window: { enabled: true, start: '2026-10-10T00:00:00Z', end: '2026-10-20T00:00:00Z' } });
  it('reports upcoming, open and closed', () => {
    expect(windowState(c, new Date('2026-10-09T00:00:00Z'))).toBe('upcoming');
    expect(windowState(c, new Date('2026-10-15T00:00:00Z'))).toBe('open');
    expect(windowState(c, new Date('2026-10-21T00:00:00Z'))).toBe('closed');
    expect(windowState(cfg(), new Date())).toBe('none');
  });
  it('after_window hides results until the window closes (v1 defect 4)', () => {
    const r = cfg({ exam_window: { enabled: true, start: null, end: '2026-10-20T00:00:00Z' }, show_results: { mode: 'after_window' } });
    expect(resultsVisible(r, new Date('2026-10-15T00:00:00Z'))).toBe(false);
    expect(resultsVisible(r, new Date('2026-10-21T00:00:00Z'))).toBe(true);
  });
  it('remaining time counts down from the start', () => {
    const c2 = cfg({ time_limit: { enabled: true, mode: 'total', total_minutes: 10 } });
    expect(remainingSeconds(c2, { started_at: '2026-10-13T00:00:00Z' }, new Date('2026-10-13T00:01:00Z'))).toBe(540);
    expect(remainingSeconds(c2, { started_at: '2026-10-13T00:00:00Z' }, new Date('2026-10-14T00:00:00Z'))).toBe(0);
  });
});
