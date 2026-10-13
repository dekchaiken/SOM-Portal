// som-portal-v2/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000/v2',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
