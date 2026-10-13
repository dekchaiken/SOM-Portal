// som-portal-v2/playwright/phase1-parity.spec.ts
//
// Phase 1 parity checks against real v1 data. Run with DATA_DIR pointing at a
// COPY of the v1 data directory that contains the QA users below (the
// password is Test1234!). Never point this at the live data/ folder.
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../../data');
const PASSWORD = 'Test1234!';

function readBoard(): Array<{ id: string; title: string; status: string; deleted_at?: string | null }> {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sm', 'board.json'), 'utf8'));
}

async function login(request: APIRequestContext, username: string, password = PASSWORD) {
  return request.post('/v2/api/auth/login', {
    data: { username, password },
  });
}

async function loginAs(page: Page, username: string) {
  const res = await login(page.request, username);
  expect(res.ok(), `login ${username}`).toBeTruthy();
  return res.json();
}

test.describe('login (TC-LOGIN)', () => {
  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/v2/login');
    await page.getByPlaceholder('your.name').fill('qa.user');
    await page.locator('input[type="password"]').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: /incorrect/i })).toBeVisible();
    await expect(page).toHaveURL(/\/v2\/login/);
  });

  test('valid user lands on dashboard', async ({ page }) => {
    await page.goto('/v2/login');
    await page.getByPlaceholder('your.name').fill('qa.user');
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/v2\/dashboard/, { timeout: 15_000 });
  });

  test('first-login user is forced to the password page and blocked elsewhere', async ({ page }) => {
    await page.goto('/v2/login');
    await page.getByPlaceholder('your.name').fill('qa.first');
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/v2\/settings/, { timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: /set a new password/i })).toBeVisible();

    const blocked = await page.goto('/v2/board');
    expect(page.url()).toMatch(/\/v2\/settings/);
    expect(blocked?.status()).toBeLessThan(400);
  });

  test('API returns password_change_required without blocking the login', async ({ request }) => {
    const res = await login(request, 'qa.first');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.pw_change_required).toBe(true);
  });
});

test.describe('dashboard (TC-DASH)', () => {
  test('KPI and recent activity come from board.json, not placeholders', async ({ page }) => {
    await loginAs(page, 'qa.user');
    await page.goto('/v2/dashboard');

    const expectedOpen = readBoard().filter((p) => p.status === 'open' && !p.deleted_at).length;
    await expect(page.getByText('Open Posts', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(String(expectedOpen), { exact: true }).first()).toBeVisible();

    await expect(page.getByText('Deploy failing on wallet-api')).toHaveCount(0);
  });

  test('quick-access links do not 404', async ({ page }) => {
    await loginAs(page, 'qa.user');
    await page.goto('/v2/dashboard');
    for (const href of ['/v2/board', '/v2/jira-templates', '/v2/jenkins-build', '/v2/settings']) {
      const res = await page.request.get(href);
      expect(res.status(), href).toBeLessThan(400);
    }
  });
});

test.describe('board detail (TC-BOARD-06)', () => {
  test('an existing post renders with its title', async ({ page }) => {
    const post = readBoard().find((p) => !p.deleted_at);
    expect(post, 'fixture has a live post').toBeTruthy();
    await loginAs(page, 'qa.user');
    await page.goto(`/v2/board/${post!.id}`);
    await expect(page.getByText(post!.title).first()).toBeVisible();
  });

  test('an unknown post id shows the not-found page', async ({ page }) => {
    await loginAs(page, 'qa.user');
    await page.goto('/v2/board/post_does_not_exist');
    await expect(page.getByText("The page you were looking for isn't here.").first()).toBeVisible();
  });
});

function readSmTemplates(): number {
  const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sm', 'templates.json'), 'utf8'));
  return Array.isArray(d) ? d.length : (d.templates ?? []).length;
}

test.describe('team isolation and view-only share (TC-TEAM)', () => {
  test('user takes the team from their record, not from the folder they were found in', async ({ request }) => {
    const res = await login(request, 'qa.ss');
    const body = await res.json();
    expect(body.data.user.team).toBe('ss');
  });

  test('other team can read SM-shared MA services but cannot write them', async ({ request }) => {
    await login(request, 'qa.ss');
    const read = await request.get('/v2/api/v1/ma-services');
    expect(read.status()).toBe(200);
    const write = await request.post('/v2/api/v1/ma-services', {
      data: { service_name: 'x', service_type: 'a', tool_type: 'b' },
    });
    expect(write.status()).toBe(403);
  });

  test('view-share shows SM templates to another team, read-only', async ({ request }) => {
    await login(request, 'qa.ss');
    const read = await request.get('/v2/api/v1/templates');
    expect(read.status()).toBe(200);
    const body = await read.json();
    expect(body.data.templates.length).toBe(readSmTemplates());

    const write = await request.post('/v2/api/v1/templates', { data: { name: 'x' } });
    expect(write.status()).toBe(403);
    expect((await write.json()).error).toMatch(/view-only/);
  });
});

test.describe('tool visibility per team (TC-TEAM-UI)', () => {
  test('team ss sees only its own tools in the sidebar and dashboard', async ({ page }) => {
    await loginAs(page, 'qa.ss');
    await page.goto('/v2/dashboard');
    await expect(page.getByRole('link', { name: 'Service Board' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Restart Monitor' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Jenkins Build' })).toHaveCount(0);
  });

  test('team sm sees Jira Templates on the dashboard, but not Jenkins Build (no jenkins-build feature)', async ({ page }) => {
    await loginAs(page, 'qa.user');
    await page.goto('/v2/dashboard');
    await expect(page.getByRole('link', { name: 'Jira Templates' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Jenkins Build' })).toHaveCount(0);
  });
});

test.describe('security (TC-SESS)', () => {
  test('forgot-password does not log the reset URL', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/api/auth/forgot-password/route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/console\.(info|log)\([^)]*url/);
  });
});
