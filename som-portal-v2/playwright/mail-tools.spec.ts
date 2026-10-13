// som-portal-v2/playwright/mail-tools.spec.ts
// Mail tools (Phase 2 section 8): send with CC, logs filter, templates CRUD, send page.
// Runs in dry-run (NODE_ENV is not production), so nothing leaves the machine.
import { test, expect, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'Test1234!';

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

test.describe('mail tools (TC-MAIL)', () => {
  test('a send with CC is logged with its CC list', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const sub = `qa-cc-${Date.now()}`;
    const res = await request.post('/v2/api/mail/send', {
      data: { to: ['a@test.local'], cc: ['b@test.local'], subject: sub, body: 'hello', html: false },
    });
    expect(res.ok()).toBeTruthy();
    const logs = (await (await request.get(`/v2/api/mail/logs?search=${encodeURIComponent(sub)}`)).json()).data;
    expect(logs.logs[0].cc).toEqual(['b@test.local']);
  });

  test('a send with an invalid CC address is refused', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.post('/v2/api/mail/send', {
      data: { to: ['a@test.local'], cc: ['not-an-email'], subject: 's', body: 'b' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('the logs filter returns only the requested status', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const data = (await (await request.get('/v2/api/mail/logs?status=failed')).json()).data;
    for (const l of data.logs) expect(l.status).toBe('failed');
  });

  test('a template can be created, listed and deleted', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const created = await request.post('/v2/api/mail/templates', {
      data: { name: 'QA template', subject: 'Hi {{name}}', html: '<p>Hi {{name}}</p>', variables: ['name'] },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).data.id as string;
    const list = (await (await request.get('/v2/api/mail/templates')).json()).data as Array<{ id: string }>;
    expect(list.some((t) => t.id === id)).toBeTruthy();
    const del = await request.delete(`/v2/api/mail/templates?id=${id}`);
    expect(del.ok()).toBeTruthy();
  });

  test('the send page sends a mail from the form', async ({ page }) => {
    await login(page.request, 'qa.smadmin');
    await page.goto('/v2/admin/mail-send');
    await page.getByLabel('To').fill('c@test.local');
    await page.getByLabel('Subject').fill('QA ui send');
    await page.getByLabel('Body', { exact: true }).fill('hello from ui');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sent to 1 recipient' })).toBeVisible();
  });

  test('the logs page shows the search box and the totals', async ({ page }) => {
    await login(page.request, 'qa.smadmin');
    await page.goto('/v2/admin/mail-logs');
    await expect(page.getByLabel('Search logs')).toBeVisible();
    await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();
  });

  test('the mail config page has Global CC and signature fields', async ({ page }) => {
    await login(page.request, 'qa.smadmin');
    await page.goto('/v2/admin/mail-config');
    await expect(page.getByLabel('Global CC')).toBeVisible();
    await expect(page.getByLabel('Email signature')).toBeVisible();
  });
});
