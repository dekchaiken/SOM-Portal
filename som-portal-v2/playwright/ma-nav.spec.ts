// som-portal-v2/playwright/ma-nav.spec.ts
// MA entries in the sidebar: super_admin sees them, and access follows the team's menu permissions.
import { test, expect } from '@playwright/test';

test('super_admin sees MA Overview and MA Usecases in the sidebar', async ({ page }) => {
  const r = await page.request.post('/v2/api/auth/login', { data: { username: 'qa.super', password: 'Test1234!' } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/v2/dashboard');
  await expect(page.getByRole('link', { name: 'MA Overview' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'MA Usecases' }).first()).toBeVisible();
});
