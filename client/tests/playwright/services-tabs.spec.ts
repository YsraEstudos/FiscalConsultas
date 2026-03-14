import { expect, test } from '@playwright/test';

import { installServicesMock } from './fixtures/service-mocks';
import { openServicesModal, searchServices } from './fixtures/services-ui';

test.beforeEach(async ({ page }) => {
  await installServicesMock(page);
});

test('loads NBS search results and the linked detail panel', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  await expect(page.getByRole('button', { name: /Serviços de construção de edificações residenciais/ })).toBeVisible();
  await expect(page.getByText('Descricao atual')).toBeVisible();
  await expect(page.getByText('Ja existe uma nota explicativa publicada para este codigo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir na aba NEBS' })).toBeVisible();
});

test('switches from an NBS detail to the linked NEBS detail', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await page.getByRole('button', { name: 'Abrir na aba NEBS' }).click();
  await nebsRequest;

  await expect(page.getByRole('heading', { name: 'NEBS' })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: 'Conteudo da nota' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir item NBS relacionado' })).toBeVisible();
});

test('returns from a NEBS detail to the linked NBS detail', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  await page.getByRole('button', { name: 'Abrir na aba NEBS' }).click();
  await expect(page.locator('p').filter({ hasText: 'Conteudo da nota' })).toBeVisible();

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await page.getByRole('button', { name: 'Abrir item NBS relacionado' }).click();
  await nbsRequest;

  await expect(page.getByRole('heading', { name: 'NBS 2.0' })).toBeVisible();
  await expect(page.getByText('Descricao atual')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir na aba NEBS' })).toBeVisible();
});
