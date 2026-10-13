// som-portal-v2/playwright/inbox.spec.ts
// Team inbox. Reading a real mailbox needs a live IMAP account, so these tests cover
// access, the no-mailbox path (dashboard card, inbox page, API), and the sign-in gate.
import { test, expect, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'Test1234!';

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

test.describe('team inbox (TC-INBOX)', () => {
  test('the inbox API refuses an anonymous request', async ({ request }) => {
    const res = await request.get('/v2/api/inbox/list');
    expect([401, 403]).toContain(res.status());
  });

  test('a team without a mailbox gets a clear message from the API', async ({ request }) => {
    await login(request, 'qa.devadmin');
    const body = await (await request.get('/v2/api/inbox/list')).json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('no mailbox');
  });

  test('the dashboard shows the inbox card with the no-mailbox message', async ({ page }) => {
    const res = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.devadmin', password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    await page.goto('/v2/dashboard');
    await expect(page.getByText('Team Inbox', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('This team has no mailbox yet').first()).toBeVisible();
  });

  test('the inbox page opens and explains the missing mailbox', async ({ page }) => {
    const res = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.devadmin', password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    await page.goto('/v2/inbox');
    await expect(page.getByRole('main').getByText('Mail for your team, from the team mailbox')).toBeVisible();
    await expect(page.getByRole('main').getByText(/no mailbox set up/)).toBeVisible();
  });

  test('branding settings save and read back (header and footer)', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const put = await request.put('/v2/api/mail/config', {
      data: { header_text: 'QA header', footer_text: 'SMC: 091-696-9885 (24hrs)', brand_color: '#123456', brand_enabled: true },
    });
    expect((await put.json()).ok).toBe(true);
    const cfg = (await (await request.get('/v2/api/mail/config')).json()).data;
    expect(cfg.footer_text).toBe('SMC: 091-696-9885 (24hrs)');
    expect(cfg.brand_color).toBe('#123456');
    expect(cfg.header_text).toBe('QA header');
  });
});
