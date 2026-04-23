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
          nebs: { status: 'unknown' },
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

test('shows the NEBS empty/error state after a linked NEBS search fails', async ({ page }) => {
  await installServicesMock(page, {
    nebsSearchResponses: [{ abort: true }],
  });

  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  const openNebsButton = page.getByRole('button', { name: /Ver NBS/ });
  await expect(openNebsButton).toBeVisible();

  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await openNebsButton.click();
  await nebsRequest;

  await expect(page.locator('text=Catálogo de serviços indisponível no momento. Tente novamente em instantes.').first()).toBeVisible();
});

test('shows an error after a failed NBS search and recovers on retry', async ({ page }) => {
  await installServicesMock(page, {
    nbsSearchResponses: [
      { abort: true },
      { body: makeNbsSearch('1.0101.12.00') },
    ],
  });

  await openServicesModal(page);
  await searchServices(page, '1.0101.12.00');

  await expect(page.locator('text=Catálogo de serviços indisponível no momento. Tente novamente em instantes.').first()).toBeVisible();

  await page.locator('#ncmInput').fill('');
  await searchServices(page, '1.0101.12.00');

  await expect(page.getByRole('button', { name: /Serviços de construção de edificações residenciais/ })).toBeVisible();
});

test('covers empty states for NBS and NEBS searches', async ({ page }) => {
  await installServicesMock(page, {
    nbsSearchResponses: [{ body: { success: true, query: 'sem resultado', normalized: 'sem resultado', results: [], total: 0 } }],
    nebsSearchResponses: [{ body: { success: true, query: 'sem nota', normalized: 'sem nota', results: [], total: 0 } }],
  });

  await openServicesModal(page);
  await searchServices(page, 'sem resultado');
  await expect(page.getByText('Nenhum servico encontrado')).toBeVisible();

  await page.getByRole('button', { name: 'NEBS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pronto para buscar' })).toBeVisible();

  await searchServices(page, 'sem nota', 'nebs');
  await expect(page.getByText('Nenhuma nota encontrada')).toBeVisible();
});
