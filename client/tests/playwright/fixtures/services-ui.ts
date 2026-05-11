import { expect, type Page } from '@playwright/test';

export async function openServicesModal(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Pronto para buscar' })).toBeVisible();
}

export async function searchServices(
  page: Page,
  query: string,
  doc: 'nbs' | 'nebs' = 'nbs',
) {
  void doc;
  await page.locator('#ncmInput').fill(query);
  await page.locator('#ncmInput').press('Enter');
}
