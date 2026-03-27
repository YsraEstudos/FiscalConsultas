import { expect, test } from '@playwright/test';

import { installServicesMock, makeNbsSearch } from './fixtures/service-mocks';
import { openServicesModal, searchServices } from './fixtures/services-ui';

test('redirects signed-out users to Clerk before opening the services catalog', async ({ page }) => {
  let servicesRequestCount = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/services/')) {
      servicesRequestCount += 1;
    }
  });

  await page.addInitScript(() => {
    (window as typeof window & { __clerkMockInitialSignedIn?: boolean }).__clerkMockInitialSignedIn = false;
  });

  await installServicesMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();

  await expect(page.getByText('Faça login para acessar o catálogo de serviços.')).toBeVisible();
  await page.waitForTimeout(250);

  const clerkState = await page.evaluate(() => (
    (window as typeof window & {
      __getMockClerkState?: () => { isSignedIn: boolean; openSignInCalls: number };
    }).__getMockClerkState?.()
  ));

  expect(clerkState?.isSignedIn).toBe(false);
  expect(clerkState?.openSignInCalls).toBe(1);
  expect(servicesRequestCount).toBe(0);
  await expect(page.getByRole('heading', { name: 'NBS 2.0' })).not.toBeVisible();
});

test('disables the services entry point when /api/status reports the catalog offline', async ({ page }) => {
  await installServicesMock(page, {
    statusResponses: [{
      body: {
        status: 'error',
        database: { status: 'online', latency_ms: 1 },
        tipi: { status: 'online' },
        nbs: { status: 'error' },
        nebs: { status: 'online' },
        catalogs: {
          nesh: { status: 'online', latency_ms: 1 },
          tipi: { status: 'online' },
          nbs: { status: 'error' },
          nebs: { status: 'online' },
        },
      },
    }],
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Menu/ }).click();

  const disabledServicesButton = page.getByRole('button', { name: 'Serviços (NBS) indisponível' });
  await expect(disabledServicesButton).toBeDisabled();
  await expect(disabledServicesButton).toHaveAttribute('title', 'Catálogo NBS indisponível no momento.');
  await expect(page.getByRole('heading', { name: 'NBS 2.0' })).not.toBeVisible();
});

test('shows the NEBS empty/error state after a linked NEBS search fails', async ({ page }) => {
  await installServicesMock(page, {
    nebsSearchResponses: [{ abort: true }],
  });

  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await page.getByRole('button', { name: 'Abrir na aba NEBS' }).click();
  await nebsRequest;

  await expect(page.getByRole('heading', { name: 'NEBS' })).toBeVisible();
  await expect(page.getByText('Nenhuma nota encontrada')).toBeVisible();
  await expect(page.getByText('Catálogo de serviços indisponível no momento. Tente novamente em instantes.')).toBeVisible();
  await expect(page.getByText('Selecione uma nota')).toBeVisible();
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

  await expect(page.getByText('Catálogo de serviços indisponível no momento. Tente novamente em instantes.')).toBeVisible();
  await expect(page.getByText('Nenhum servico encontrado')).toBeVisible();

  await page.getByLabel('Buscar por codigo ou descricao').fill('');
  await searchServices(page, '1.0101.12.00');

  await expect(page.getByRole('button', { name: /Serviços de construção de edificações residenciais/ })).toBeVisible();
  await expect(page.getByText('Descricao atual')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'NEBS' })).toBeVisible();
  await expect(page.getByText('Busque uma nota explicativa')).toBeVisible();

  await searchServices(page, 'sem nota', 'nebs');
  await expect(page.getByText('Nenhuma nota encontrada')).toBeVisible();
  await expect(page.getByText('Selecione uma nota')).toBeVisible();
});
