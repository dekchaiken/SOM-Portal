// som-portal-v2/playwright/fixtures/build-data-copy.mjs
//
// Builds a SAFE copy of the v1 data folder for parity tests.
//   node playwright/fixtures/build-data-copy.mjs <source data dir> <target dir>
// Copies small top-level and sm/ JSON files, then adds QA users and grants a
// view-only jira-templates share to team `ss`. The source folder is never written.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: build-data-copy.mjs <source data dir> <target dir>');
  process.exit(1);
}
if (path.resolve(src) === path.resolve(dst)) {
  console.error('target must differ from source');
  process.exit(1);
}

// Real data includes files over 15 MB (ma-services.json). The copy takes every JSON file up to 64 MB.
const MAX = 64 * 1024 * 1024;
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.join(dst, 'sm'), { recursive: true });

for (const dir of ['', 'sm']) {
  const from = path.join(src, dir);
  for (const f of fs.readdirSync(from)) {
    const p = path.join(from, f);
    if (!f.endsWith('.json') || !fs.statSync(p).isFile() || fs.statSync(p).size > MAX) continue;
    fs.copyFileSync(p, path.join(dst, dir, f));
  }
}

// Learning content lives in per-course folders under sm/courses.
const coursesSrc = path.join(src, 'sm', 'courses');
const copyTree = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const p = path.join(from, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) copyTree(p, path.join(to, f));
    else if (f.endsWith('.json') && st.size <= MAX) fs.copyFileSync(p, path.join(to, f));
  }
};
if (fs.existsSync(coursesSrc)) copyTree(coursesSrc, path.join(dst, 'sm', 'courses'));

const hash = bcrypt.hashSync('Test1234!', 10);
const now = new Date().toISOString();
const qa = (id, username, team, flags = {}) => ({
  id,
  username,
  name: `QA ${team}`,
  email: `${username}@test.local`,
  role: 'sm_user',
  team,
  password: hash,
  password_history: [hash],
  password_changed_at: now,
  created_at: now,
  first_login: false,
  must_reset_password: false,
  password_expired: false,
  ...flags,
});

const usersPath = path.join(dst, 'users.json');
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
users.push(
  qa('usr_qa_user', 'qa.user', 'sm'),
  qa('usr_qa_first', 'qa.first', 'sm', { first_login: true }),
  qa('usr_qa_expired', 'qa.expired', 'sm', { password_changed_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z' }),
  qa('usr_qa_reset', 'qa.reset', 'sm', { must_reset_password: true }),
  qa('usr_qa_ss', 'qa.ss', 'ss'),
  { ...qa('usr_qa_ssadmin', 'qa.ssadmin', 'ss'), role: 'sm_admin' },
  { ...qa('usr_qa_smadmin', 'qa.smadmin', 'sm'), role: 'sm_admin' },
  qa('usr_qa_dev', 'qa.dev', 'dev'),
  qa('usr_qa_quiz', 'qa.quiz', 'sm'),
  { ...qa('usr_qa_super', 'qa.super', 'sm'), role: 'super_admin' },
  { ...qa('usr_qa_devadmin', 'qa.devadmin', 'dev'), role: 'sm_admin' },
  qa('usr_qa_exam', 'qa.exam', 'sm'),
);
fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

const teamsPath = path.join(dst, 'teams.json');
const teams = JSON.parse(fs.readFileSync(teamsPath, 'utf8'));
for (const t of teams) {
  if (t.slug === 'ss' && !t.features.includes('jira-templates-shared')) {
    t.features.push('jira-templates-shared');
  }
}
fs.writeFileSync(teamsPath, JSON.stringify(teams, null, 2));

// A deterministic exam for the exam tests: published, one attempt, every question type.
// The v1 exam list and attempts are copied so write-path tests see the real rows.
const examsSrc = path.join(src, 'sm', 'exams');
const examsCopy = path.join(dst, 'sm', 'exams', 'exams.json');
fs.mkdirSync(path.join(dst, 'sm', 'exams'), { recursive: true });
for (const f of ['exams.json', 'attempts.json']) {
  if (fs.existsSync(path.join(examsSrc, f))) fs.copyFileSync(path.join(examsSrc, f), path.join(dst, 'sm', 'exams', f));
}
if (fs.existsSync(examsCopy)) {
  const exams = JSON.parse(fs.readFileSync(examsCopy, 'utf8'));
  const base = {
    subtitle: 'QA smoke exam',
    description: 'Fixture exam for the exam tests',
    icon: 'flag',
    cover_color: '#4f46e5',
    preset: 'basic',
    course_prerequisites: [],
    is_popular: false,
    shared: false,
    owner_team: 'sm',
    created_at: now,
    updated_at: now,
    config: {
      pool: { enabled: false, total_show: 0, stratified: false, categories: [] },
      shuffle_questions: { enabled: false },
      shuffle_choices: { enabled: true },
      attempts: { enabled: true, max: 1, cooldown_minutes: 0 },
      time_limit: { enabled: true, mode: 'total', total_minutes: 30, per_question_seconds: 0 },
      tab_detection: { enabled: true, max_violations: 3, action: 'log', penalty_pct: 10 },
      exam_window: { enabled: false, start: null, end: null },
      disable_copy_paste: { enabled: false },
      show_results: { mode: 'after_submit', show_answers: true, show_explains: true },
    },
  };
  exams.push({ ...base, id: 'exam_qa_smoke', title: 'QA smoke exam', status: 'published', pass_score: 70 });
  exams.push({ ...base, id: 'exam_qa_draft', title: 'QA draft exam', status: 'draft', pass_score: 70 });
  fs.writeFileSync(examsCopy, JSON.stringify(exams, null, 2));
  const qDir = path.join(dst, 'sm', 'exams', 'exam_qa_smoke');
  fs.mkdirSync(qDir, { recursive: true });
  const qbase = { category: '', image: '', match_mode: 'exact', case_sensitive: false, explain: 'Fixture explanation' };
  fs.writeFileSync(
    path.join(qDir, 'questions.json'),
    JSON.stringify(
      [
        { ...qbase, id: 'qs1', type: 'single', prompt: 'Pick B', choices: ['A', 'B', 'C'], answer: 1 },
        { ...qbase, id: 'qs2', type: 'truefalse', prompt: 'Sky is blue', choices: [], answer: true },
        { ...qbase, id: 'qs3', type: 'multi', prompt: 'Pick 1 and 3', choices: ['1', '2', '3', '4'], answer: [0, 2] },
        { ...qbase, id: 'qs4', type: 'short', prompt: 'Say hello', choices: [], answer: 'hello', match_mode: 'contains' },
      ],
      null,
      2,
    ),
  );
}

console.log(`copy ready at ${dst}`);
