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
      if (text.includes("The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.")) {
        return;
      }
      consoleErrors.push(text);
    }
  });

  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`);
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
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Ajuda \/ Tutorial/ }).click();
  await expect(page.getByText(/Como usar/)).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-tutorial.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Comparar NCMs/ }).click();
  await expect(page.getByRole('heading', { name: /Comparar NCMs/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-comparator.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await expect(page.getByRole('heading', { name: 'NBS 2.0' })).toBeVisible();

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );
  await page.getByLabel('Buscar por codigo ou descricao').fill('1.0101.11.00');
  await nbsRequest;

  await expect(page.getByText('Serviços de construção de edificações residenciais de um e dois pavimentos')).toBeVisible();
  await expect(page.getByText('Descricao atual')).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-nbs.png', fullPage: true });

  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );
  await page.getByRole('button', { name: 'Abrir na aba NEBS' }).click();
  await nebsRequest;

  await expect(page.getByRole('heading', { name: 'NEBS' })).toBeVisible();
  await expect(page.getByText('SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO').first()).toBeVisible();
  await expect(page.locator('p').filter({ hasText: 'Conteudo da nota' })).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-nebs.png', fullPage: true });

  expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(failedRequests, `Failed requests found:\n${failedRequests.join('\n')}`).toEqual([]);
});
