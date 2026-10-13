// som-portal-v2/playwright/ma-status.spec.ts
// MA Status Board on the real cache (ma-status-cache.json written by v1).
import { test, expect, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'Test1234!';
async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

test.describe('MA status board (TC-MSTAT)', () => {
  test('the API returns the summary, services and unmatched items from the cache', async ({ request }) => {
    await login(request, 'qa.user');
    const d = (await (await request.get('/v2/api/v1/ma-status')).json()).data;
    expect(d.summary.total).toBe(193);
    expect(d.summary.open).toBe(61);
    expect(d.summary.closed).toBe(4);
    expect(d.summary.unknown).toBe(128);
    expect(d.services.length).toBe(193);
    expect(d.unmapped_backoffice.length).toBe(435);
  });

  test('the board shows the hero, the KPIs and the sections in v1 order', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: PASSWORD } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-status');
    const main = page.getByRole('main');
    await expect(main.getByText('61 services in maintenance')).toBeVisible({ timeout: 15000 });
    await expect(main.getByRole('heading', { name: 'MA Status Board' })).toBeVisible();
    await expect(main.getByText('Operational', { exact: true }).first()).toBeVisible();
    await expect(main.getByRole('heading', { name: /Admin Portal \(matched\)/ })).toBeVisible();
    await expect(main.getByText(/Discovered in Admin Portal \(435\)/)).toBeVisible();
  });

  test('the source tabs narrow the board', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: PASSWORD } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-status');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Admin Portal (matched)' })).toBeVisible({ timeout: 15000 });
    await main.getByRole('button', { name: /NANO Products/ }).click();
    await expect(main.getByRole('heading', { name: 'Admin Portal (matched)' })).toHaveCount(0);
    await expect(main.getByRole('heading', { name: /^NANO Products/ })).toBeVisible();
  });
});
