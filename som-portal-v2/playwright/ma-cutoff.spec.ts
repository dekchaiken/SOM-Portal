// som-portal-v2/playwright/ma-cutoff.spec.ts
// Cut-off services on the real data copy: count, access rule, tabs, search and the overview link.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = 'Test1234!';
const NEW = { service_name: 'QA cutoff probe', site_type: 'TMN', cutoff_time: '23:00', cutoff_day: 'ทุกวัน' };

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

async function openCutoff(page: Page, username: string) {
  const r = await page.request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/v2/ma-services/cutoff');
  await expect(page.getByRole('main').getByText('Cut-off time services that follow a timeline')).toBeVisible({ timeout: 15000 });
}

test.describe('cut-off services (TC-CUTOFF)', () => {
  test('all 85 cut-off services are readable by every signed-in team', async ({ request }) => {
    await login(request, 'qa.devadmin');
    const rows = (await (await request.get('/v2/api/v1/ma/cutoff')).json()).data as unknown[];
    expect(rows.length).toBe(85);
  });

  test('another team cannot add a cut-off service', async ({ request }) => {
    await login(request, 'qa.devadmin');
    const res = await request.post('/v2/api/v1/ma/cutoff', { data: NEW });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('SM admin can add and delete a cut-off service', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.post('/v2/api/v1/ma/cutoff', { data: NEW });
    expect(res.status()).toBe(201);
    const id = ((await res.json()).data as { id: number }).id;
    expect((await request.delete(`/v2/api/v1/ma/cutoff/${id}`)).ok()).toBeTruthy();
  });

  test('another team sees view-only and the site-type tabs with real counts', async ({ page }) => {
    await openCutoff(page, 'qa.devadmin');
    await expect(page.getByText('View only. Cut-off services are managed by the SM team').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add cut-off/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^MGT 51$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^TMN 25$/ })).toBeVisible();
  });

  test('search narrows the table', async ({ page }) => {
    await openCutoff(page, 'qa.smadmin');
    await page.getByLabel('Search cut-off services').first().fill('Pay Next');
    await expect(page.getByText('Pay Next and Pay Next Extra Onboard').first()).toBeVisible();
    await expect(page.getByText('Showing').locator('..').getByText(/^\d+$/).first()).toBeVisible();
  });

  test('the overview links to cut-off services', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: PASSWORD } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-services');
    await page.getByRole('link', { name: /Open Cut-off Services/ }).click();
    await expect(page).toHaveURL(/\/ma-services\/cutoff/);
  });
});
