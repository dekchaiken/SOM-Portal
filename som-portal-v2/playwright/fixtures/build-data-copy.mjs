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

const MAX = 2 * 1024 * 1024;
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

console.log(`copy ready at ${dst}`);
