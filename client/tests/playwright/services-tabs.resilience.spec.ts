import { expect, test } from '@playwright/test';

import { installServicesMock, makeNbsSearch } from './fixtures/service-mocks';
import { openServicesModal, searchServices } from './fixtures/services-ui';

test('allows signed-out users to open the services catalog without Clerk', async ({ page }) => {
  let servicesRequestCount = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/services/')) {
      servicesRequestCount += 1;
    }
  });

  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { __clerkMockInitialSignedIn?: boolean }).__clerkMockInitialSignedIn = false;
  });

  await installServicesMock(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Menu/, exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();

  await expect(page.getByRole('heading', { name: 'Pronto para buscar' })).toBeVisible();

  const clerkState = await page.evaluate(() => (
    (globalThis as typeof globalThis & {
      __getMockClerkState?: () => { isSignedIn: boolean; openSignInCalls: number };
    }).__getMockClerkState?.()
  ));

  expect(clerkState?.isSignedIn).toBe(false);
  expect(clerkState?.openSignInCalls).toBe(0);
  expect(servicesRequestCount).toBe(0);
});

test('keeps the services entry point available while status is unknown', async ({ page }) => {
  await installServicesMock(page, {
    statusResponses: [{
      body: {
        status: 'online',
        database: { status: 'online', latency_ms: 1 },
        tipi: { status: 'online' },
        catalogs: {
          nesh: { status: 'online', latency_ms: 1 },
          tipi: { status: 'online' },
          nbs: { status: 'unknown' },
        },
      },
    }],
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Menu/, exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Menu/, exact: true }).click();

  const servicesButton = page.getByRole('button', { name: /Serviços \(NBS\)$/i });
  await expect(servicesButton).toBeEnabled();
  await servicesButton.click();
  await expect(page.getByRole('heading', { name: 'Pronto para buscar' })).toBeVisible();
});

test('shows an error after a failed NBS search and recovers on retry', async ({ page }) => {
  test.skip(true, 'Legacy /api/services/nbs search resilience retired; replace with local R2 NBS worker error coverage.');

  await installServicesMock(page, {
    nbsSearchResponses: [
      { body: null },
      { body: makeNbsSearch('1.0101.12.00') },
    ],
  });

  await openServicesModal(page);
  await searchServices(page, '1.0101.12.00');

  await expect(page.getByRole('paragraph').filter({ hasText: 'Nenhum resultado encontrado na base local.' })).toBeVisible();

  await page.locator('#ncmInput').fill('');
  await searchServices(page, '1.0101.12.00');

  await expect(page.getByRole('button', { name: /Serviços de construção de edificações residenciais/ })).toBeVisible();
});

test('covers empty states for NBS searches', async ({ page }) => {
  test.skip(true, 'Legacy /api/services/nbs empty-state coverage retired; replace with local R2 NBS worker empty-state coverage.');

  await installServicesMock(page, {
    nbsSearchResponses: [{ body: { success: true, query: 'sem resultado', normalized: 'sem resultado', results: [], total: 0 } }],
  });

  await openServicesModal(page);
  await searchServices(page, 'sem resultado');
  await expect(page.getByText('Nenhum servico encontrado')).toBeVisible();
});
