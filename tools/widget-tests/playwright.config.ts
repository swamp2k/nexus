import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5178',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.WIDGET_TEST_BROWSER },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'node serve.mjs', url: 'http://127.0.0.1:5178', reuseExistingServer: false },
});
