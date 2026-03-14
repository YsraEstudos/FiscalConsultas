import { expect, type Page } from '@playwright/test';

export async function openServicesModal(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await expect(page.getByRole('heading', { name: 'NBS 2.0' })).toBeVisible();
}

export async function searchServices(
  page: Page,
  query: string,
  doc: 'nbs' | 'nebs' = 'nbs',
) {
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
