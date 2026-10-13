// som-portal-v2/playwright/nav-feedback.spec.ts
// A click on an internal link shows feedback before the next page renders.
import { test, expect } from '@playwright/test';

test('clicking a sidebar link shows a loading pill at once', async ({ page }) => {
  const res = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.exam', password: 'Test1234!' } });
  expect(res.ok()).toBeTruthy();
  await page.goto('/v2/dashboard');
  // Hold the next page's data request so the wait is visible.
  await page.route('**/v2/learn**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole('link', { name: 'Learn' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible({ timeout: 500 });
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
});
