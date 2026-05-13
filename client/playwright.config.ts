import { defineConfig, devices } from '@playwright/test';

const defaultBaseUrl = 'http://localhost:4173';

function resolveLiveBaseUrl(): string {
  const rawBaseUrl = process.env.PLAYWRIGHT_LIVE_BASE_URL || defaultBaseUrl;

  try {
    return new URL(rawBaseUrl).toString().replace(/\/$/, '');
  } catch {
    throw new Error(
      `Invalid PLAYWRIGHT_LIVE_BASE_URL: ${rawBaseUrl}. Expected a full URL such as ${defaultBaseUrl}.`,
    );
  }
}

const liveBaseUrl = resolveLiveBaseUrl();

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
    baseURL: defaultBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --host localhost --port 4173 --strictPort',
    url: defaultBaseUrl,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_E2E_MOCK_AUTH: 'true',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_e2e',
      VITE_AUTH_DEBUG: 'false',
      VITE_FISCAL_R2_BASE_URL: 'https://example.r2.dev/fiscal',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'e2e-public-seed',
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
