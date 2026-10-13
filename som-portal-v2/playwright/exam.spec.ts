// som-portal-v2/playwright/exam.spec.ts
//
// Exam taking against a COPY of the v1 data (see fixtures/build-data-copy.mjs, which
// adds exam_qa_smoke and exam_qa_draft). One-attempt rules mean qa.user's submit
// test can only pass on a freshly built copy. Never point this at the live data/ folder.
import { test, expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../../data');
const PASSWORD = 'Test1234!';
const EXAM = 'exam_qa_smoke';

interface Q {
  id: string;
  type: 'single' | 'multi' | 'truefalse' | 'short';
  choices: string[];
}

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

async function data<T>(res: { json(): Promise<unknown> }): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

async function start(request: APIRequestContext, examId = EXAM) {
  return request.post(`/v2/api/v1/learn/exams/${examId}/attempts`);
}

test.describe.configure({ mode: 'serial' });

test.describe('exams (TC-EXAM)', () => {
  test('a learner sees published exams only', async ({ request }) => {
    await login(request, 'qa.user');
    const list = await data<Array<{ id: string }>>(await request.get('/v2/api/v1/learn/exams'));
    const ids = list.map((e) => e.id);
    expect(ids).toContain(EXAM);
    expect(ids).not.toContain('exam_qa_draft');
  });

  test('a draft exam is not readable by a learner', async ({ request }) => {
    await login(request, 'qa.user');
    const res = await request.get('/v2/api/v1/learn/exams/exam_qa_draft');
    expect(res.status()).toBe(404);
  });

  test('a team without the learning feature cannot list exams', async ({ request }) => {
    await login(request, 'qa.dev');
    const res = await request.get('/v2/api/v1/learn/exams');
    expect(res.status()).toBe(403);
  });

  test('questions reach the learner without answers or explanations', async ({ request }) => {
    await login(request, 'qa.quiz');
    const res = await start(request);
    expect(res.status()).toBe(201);
    const view = await data<{ questions: Array<Record<string, unknown>> }>(res);
    expect(view.questions).toHaveLength(4);
    for (const q of view.questions) {
      expect(q).not.toHaveProperty('answer');
      expect(q).not.toHaveProperty('explain');
      expect(q).not.toHaveProperty('match_mode');
    }
    const qs1 = view.questions.find((q) => q.id === 'qs1') as { choices: string[] };
    expect([...qs1.choices].sort()).toEqual(['A', 'B', 'C']);
  });

  test('starting again resumes the open attempt', async ({ request }) => {
    await login(request, 'qa.quiz');
    const first = await data<{ id: string }>(await start(request));
    const again = await data<{ id: string }>(await start(request));
    expect(again.id).toBe(first.id);
  });

  test('a violation is counted and the attempt stays open under the log action', async ({ request }) => {
    await login(request, 'qa.quiz');
    const attempt = await data<{ id: string }>(await start(request));
    const res = await request.post(`/v2/api/v1/learn/exams/attempt/${attempt.id}/events`, { data: { type: 'tab_switch' } });
    const ev = await data<{ violations: { tab_switch: number }; closed: boolean }>(res);
    expect(ev.violations.tab_switch).toBe(1);
    expect(ev.closed).toBe(false);
  });

  test('answers map back through the shuffled order and score on submit', async ({ request }) => {
    const before = readAttemptIds();
    await login(request, 'qa.user');
    const attempt = await data<{ id: string; questions: Q[] }>(await start(request));
    const at = (qid: string, text: string) => {
      const q = attempt.questions.find((x) => x.id === qid)!;
      return q.choices.indexOf(text);
    };
    const put = await request.put(`/v2/api/v1/learn/exams/attempt/${attempt.id}/answers`, {
      data: {
        answers: {
          qs1: at('qs1', 'B'),
          qs2: true,
          qs3: [at('qs3', '1'), at('qs3', '3')].sort((a, b) => a - b),
          qs4: 'Hello there',
        },
      },
    });
    expect(put.ok()).toBeTruthy();
    const res = await request.post(`/v2/api/v1/learn/exams/attempt/${attempt.id}/submit`);
    const result = await data<{ score: number; passed: boolean; correct_count: number; visible: boolean; summary: Array<{ answer?: string; explain?: string }> }>(res);
    expect(result.visible).toBe(true);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.correct_count).toBe(4);
    expect(result.summary[0]?.explain).toBe('Fixture explanation');

    // The v1 rows that this schema cannot read must survive the write.
    const after = readAttemptIds();
    for (const id of before) expect(after.has(id), `kept ${id}`).toBeTruthy();
    expect(after.has(attempt.id)).toBeTruthy();
  });

  test('a second attempt is refused once the limit is used', async ({ request }) => {
    await login(request, 'qa.user');
    const res = await start(request);
    expect(res.status()).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('No attempts left');
  });

  test('a draft exam cannot be started', async ({ request }) => {
    await login(request, 'qa.user');
    const res = await start(request, 'exam_qa_draft');
    expect(res.status()).toBe(404);
  });
});

test.describe('exam pages (TC-EXAM-UI)', () => {
  test('a learner can open the exam list, start, answer and submit', async ({ page }) => {
    const shots = process.env.SHOT_DIR;
    const res = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.exam', password: PASSWORD } });
    expect(res.ok(), 'login qa.exam').toBeTruthy();
    await page.goto('/v2/learn/exams');
    await expect(page.getByRole('main').getByText('Assessments for your team')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'QA smoke exam' })).toBeVisible();
    if (shots) await page.screenshot({ path: path.join(shots, 'exam-list.png'), fullPage: true });

    await page.goto('/v2/learn/exams/exam_qa_smoke');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page).toHaveURL(/\/learn\/exams\/exam_qa_smoke\/attempt\//);
    await expect(page.getByRole('button', { name: 'Submit exam' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Pick B')).toBeVisible();
    if (shots) await page.screenshot({ path: path.join(shots, 'exam-take.png'), fullPage: true });

    await page.getByRole('radio').nth(1).check();
    await expect(page.getByText('1 / 4')).toBeVisible({ timeout: 5000 });
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Submit exam' }).click();
    await expect(page.getByText(/Not passed · pass at|Passed · pass at/).first()).toBeVisible({ timeout: 10000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'exam-result.png'), fullPage: true });
  });
});

function readAttemptIds(): Set<string> {
  const file = path.join(DATA_DIR, 'sm', 'exams', 'attempts.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}
