import { expect, type Page, test } from '@playwright/test';

import { installServicesMock, makeNbsSearch } from './fixtures/service-mocks';

async function openServicesModal(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await expect(page.getByRole('heading', { name: 'NBS 2.0' })).toBeVisible();
}

async function searchServices(page: Page, query: string, doc: 'nbs' | 'nebs' = 'nbs') {
  const label = doc === 'nbs'
    ? 'Buscar por codigo ou descricao'
    : 'Buscar por codigo ou termo da nota';
  const endpoint = doc === 'nbs'
    ? '/api/services/nbs/search'
    : '/api/services/nebs/search';

  const request = page.waitForRequest((candidate) =>
    candidate.url().includes(endpoint)
    && new URL(candidate.url()).searchParams.get('q') === query,
  );

  await page.getByLabel(label).fill(query);
  await request;
}

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
  await expect(page.getByText('Erro ao carregar o catálogo NEBS.')).toBeVisible();
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

  await expect(page.getByText('Erro ao carregar o catálogo NBS.')).toBeVisible();
  await expect(page.getByText('Nenhum servico encontrado')).toBeVisible();

  await page.getByLabel('Buscar por codigo ou descricao').fill('');
  await searchServices(page, '1.0101.12.00');

  await expect(page.getByRole('button', { name: /NEBS Serviços de construção de edificações residenciais de um e dois pavimentos Nivel 3/ })).toBeVisible();
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
