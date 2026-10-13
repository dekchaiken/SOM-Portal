// som-portal-v2/playwright/theme-preview.spec.ts
import { test, expect } from "@playwright/test";

/**
 * Visits /v2/preview/theme and captures a screenshot per
 * theme × mode (× GenZ once). Console theme forces dark, so the light-mode
 * capture is skipped for Console.
 *
 * No visual-regression assertions — these are evidence artifacts for the
 * design review. Playwright config lives in the repo root (Agent A ships
 * `playwright.config.ts`); this file assumes the dev server runs at
 * `http://localhost:3000/v2`.
 */

const THEMES = ["glass", "enterprise", "console", "warm"] as const;
const MODES = ["light", "dark"] as const;

for (const theme of THEMES) {
  for (const mode of MODES) {
    if (theme === "console" && mode === "light") continue;
    test(`theme preview: ${theme} · ${mode}`, async ({ page }) => {
      await page.goto("/v2/preview/theme");
      await page.getByTestId(`theme-${theme}`).click();
      await page.getByTestId(`mode-${mode}`).click();
      await expect(page.getByTestId("preview-toolbar")).toBeVisible();
      await page.screenshot({
        path: `playwright/screenshots/theme-${theme}-${mode}.png`,
        fullPage: true,
      });
    });
  }
}

test("theme preview: GenZ overlay (enterprise · light)", async ({ page }) => {
  await page.goto("/v2/preview/theme");
  await page.getByTestId("theme-enterprise").click();
  await page.getByTestId("mode-light").click();
  await page.getByTestId("toggle-genz").check();
  await page.screenshot({
    path: "playwright/screenshots/theme-enterprise-light-genz.png",
    fullPage: true,
  });
});
