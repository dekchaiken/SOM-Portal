// som-portal-v2/playwright/ma-access.spec.ts
// MA usecases are SM team data. SM team writes; every other team is view-only; super_admin writes anywhere.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = 'Test1234!';

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

async function openUsecases(page: Page, username: string) {
  const r = await page.request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/v2/ma-services/usecases?domain=TMN');
  await expect(page.getByText('Login TrueMoney Wallet').first()).toBeVisible({ timeout: 15000 });
}

const NEW = { service_name: 'QA access probe', service_type: 'TMN', tool_type: 'Jenkins', can_change_text: 'NO', remark: '' };

test.describe('MA usecase access (TC-MA-ACL)', () => {
  test('another team can see the usecases but cannot add one', async ({ request }) => {
    await login(request, 'qa.devadmin');
    expect((await request.get('/v2/api/v1/ma-services')).ok()).toBeTruthy();
    const res = await request.post('/v2/api/v1/ma-services', { data: NEW });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('another team sees the view-only notice and no add or edit controls', async ({ page }) => {
    await openUsecases(page, 'qa.devadmin');
    await expect(page.getByText('View only. MA usecases are managed by the SM team').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add usecase' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  });

  test('an SM team user (not an admin role) is view-only', async ({ page, request }) => {
    await login(request, 'qa.user');
    const res = await request.post('/v2/api/v1/ma-services', { data: NEW });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await openUsecases(page, 'qa.user');
    await expect(page.getByRole('button', { name: 'Add usecase' })).toHaveCount(0);
  });

  test('SM team admin sees the add button', async ({ page }) => {
    await openUsecases(page, 'qa.smadmin');
    await expect(page.getByRole('button', { name: 'Add usecase' })).toBeVisible();
    await expect(page.getByText('View only. MA usecases are managed by the SM team')).toHaveCount(0);
  });

  test('super_admin can add a usecase from any team', async ({ request }) => {
    await login(request, 'qa.super');
    const res = await request.post('/v2/api/v1/ma-services', { data: NEW });
    expect(res.ok()).toBeTruthy();
    const created = (await res.json()).data as { id: number };
    const del = await request.delete(`/v2/api/v1/ma-services/${created.id}`);
    expect(del.ok()).toBeTruthy();
  });
});
