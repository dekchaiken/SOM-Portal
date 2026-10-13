// som-portal-v2/playwright/mail-password.spec.ts
// Team mailbox passwords are stored encrypted. Runs against a server started with
// MAIL_CREDS_KEY set (see the test run command in the PR).
import { test, expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../../data');
const PASSWORD = 'Test1234!';
const SECRET = 'qa-app-password-do-not-use-9f2c';

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

test.describe('mail password at rest (TC-MAIL-PW)', () => {
  test('saving a password stores it encrypted and removes the plain value', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.put('/v2/api/mail/config', {
      data: { smtp_password: SECRET },
    });
    expect((await res.json()).ok).toBe(true);

    const file = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sm', 'mail_config.json'), 'utf8'));
    expect(file.smtp_password_enc.startsWith('enc:v1:')).toBe(true);
    expect(file.smtp_password).toBe('');
    expect(JSON.stringify(file)).not.toContain(SECRET);
  });

  test('the config API reports the password as set and never returns it', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const body = (await (await request.get('/v2/api/mail/config')).json()).data;
    expect(body.smtp_password_set).toBe(true);
    expect(body.smtp_password).toBe('');
    expect(body.smtp_password_enc).toBe('');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test('sending still works after the password is encrypted', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.post('/v2/api/mail/send', {
      data: { to: ['a@test.local'], subject: 'qa enc send', body: 'x' },
    });
    expect((await res.json()).data.ok).toBe(true);
  });
});
