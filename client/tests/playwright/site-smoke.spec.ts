import { expect, test } from '@playwright/test';

import { installServicesMock } from './fixtures/service-mocks';

const suspiciousMarkers = [
  'hacked by',
  'owned by',
  'pwned',
  't.me/',
  'telegram.me/',
  'defaced',
  'click here for bitcoin',
  'crypto drainer',
  'casino bonus',
];

test('main surfaces render without obvious visual breakage or defacement', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('Content Security Policy directive')) return;
      if (text.includes('worker-src')) return;
      if (text.includes("The Content Security Policy directive")) return;
      const location = msg.location();
      const source = location.url ? ` (${location.url}:${location.lineNumber})` : '';
      consoleErrors.push(`${text}${source}`);
    }
  });

  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`);
  });

  await page.context().route('**/api/auth/me*', async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: 'e2e-user', email: 'e2e@example.com', name: 'E2E User' },
        capabilities: {
          can_use_restricted_ui: true,
          can_use_ai_chat: true,
        },
      },
    });
  });
  await page.context().route('**/api/profile/me*', async (route) => {
    await route.fulfill({
      json: {
        id: 'e2e-user',
        email: 'e2e@example.com',
        name: 'E2E User',
      },
    });
  });
  await page.context().route('**/api/database/version*', async (route) => {
    await route.fulfill({
      json: {
        version: 'playwright-smoke',
      },
    });
  });

  await installServicesMock(page, {
    unmatchedApiStrategy: 'continue',
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'NESH' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TIPI' })).toBeVisible();

  const homeText = (await page.locator('body').innerText()).toLowerCase();
  for (const marker of suspiciousMarkers) {
    expect(homeText).not.toContain(marker);
  }

  await page.screenshot({ path: 'test-results/site-smoke-home.png', fullPage: true });

  await page.getByRole('button', { name: /TIPI/ }).click();
  await expect(page.getByRole('button', { name: 'TIPI' })).toHaveClass(/docButtonActive/);

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.getByRole('heading', { name: /Configurações/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-settings.png', fullPage: true });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Comparar NCMs/ }).click();
  await expect(page.getByRole('heading', { name: /Comparar NCMs/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-comparator.png', fullPage: true });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Pronto para buscar' })).toBeVisible();

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );
  await page.locator('#ncmInput').fill('1.0101.11.00');
  await page.locator('#ncmInput').press('Enter');
  await nbsRequest;

  await expect(page.getByText('Serviços de construção de edificações residenciais de um e dois pavimentos')).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-nbs.png', fullPage: true });

  await expect(page.getByText('NOTAS EXPLICATIVAS')).toBeVisible();
  await expect(page.locator('div').filter({ hasText: 'Conteudo da nota' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-nebs.png', fullPage: true });

  expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(failedRequests, `Failed requests found:\n${failedRequests.join('\n')}`).toEqual([]);
});
