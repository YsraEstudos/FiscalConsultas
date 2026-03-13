import { defineConfig, devices } from '@playwright/test';

const liveBaseUrl = process.env.PLAYWRIGHT_LIVE_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_E2E_MOCK_AUTH: 'true',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_e2e',
      VITE_AUTH_DEBUG: 'false',
    },
  },
  projects: [
    {
      name: 'mocked-chromium',
      testIgnore: '**/*.live.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live-chromium',
      testMatch: '**/*.live.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: liveBaseUrl,
      },
    },
  ],
});
