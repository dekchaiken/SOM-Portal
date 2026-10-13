// som-portal-v2/playwright/ma-overview.spec.ts
// MA Overview and MA Usecases against the real data copy (ma-services.json is 15 MB).
import { test, expect, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'Test1234!';

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

test.describe('MA overview and usecases (TC-MA)', () => {
  test('the overview numbers come from the real registry', async ({ request }) => {
    await login(request, 'qa.user');
    const res = await request.get('/v2/api/v1/ma/overview?year=2026');
    const body = (await res.json()).data;
    expect(body.usecases.total).toBe(193);
    expect(body.usecases.byDomain.TMN).toBe(163);
    expect(body.usecases.byDomain.NANO).toBe(27);
    expect(body.jira.tmn.count).toBeGreaterThan(0);
    expect(body.cutoffs.total).toBe(85);
  });

  test('the overview page shows the module cards and links', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: PASSWORD } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-services');
    await expect(page.getByRole('main').getByRole('heading', { name: 'MA Usecases' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('main').getByRole('heading', { name: 'Cut-off Services' })).toBeVisible();
    await page.getByRole('link', { name: /Open MA Usecases/ }).click();
    await expect(page).toHaveURL(/\/ma-services\/usecases/);
  });

  test('the usecase table shows the TMN domain with its real count', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: PASSWORD } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-services/usecases?domain=TMN');
    await expect(page.getByText('Login TrueMoney Wallet').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('main').getByText('Showing').locator('..').getByText('163')).toBeVisible();
  });

  test('search narrows the usecase table', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: PASSWORD } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-services/usecases?domain=ALL');
    await expect(page.getByText('Login TrueMoney Wallet').first()).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Search usecases').first().fill('Voucher');
    await expect(page.getByText('Voucher Service App', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Login TrueMoney Wallet')).toHaveCount(0);
  });
});

test.describe('MA overview pipeline (TC-MA-PIPE)', () => {
  test('the active pipeline lists its tickets', async ({ page }) => {
    const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.user', password: 'Test1234!' } });
    expect(r.ok()).toBeTruthy();
    await page.goto('/v2/ma-services');
    await expect(page.getByRole('main').getByText('SMC-10574').first()).toBeVisible({ timeout: 15000 });
  });
});
