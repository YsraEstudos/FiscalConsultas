import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installServicesMock } from './fixtures/service-mocks';

const currentDir = dirname(fileURLToPath(import.meta.url));
const offlineMeta = JSON.parse(
  readFileSync(resolve(currentDir, '../../../database/fiscal_offline.meta'), 'utf-8'),
);
const offlineBundle = readFileSync(
  resolve(currentDir, '../../../database/fiscal_offline.enc'),
);

test('opens local and cross-chapter notes without /api after offline install', async ({ page }) => {
  await installServicesMock(page, {
    unmatchedApiStrategy: 'continue',
  });

  await page.route('**/api/database/version', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(offlineMeta),
    });
  });

  await page.route('**/api/database/token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'playwright-offline-token',
        encrypted_sha256: offlineMeta.encrypted_sha256,
        chunk_size: offlineMeta.chunk_size,
        pbkdf2_iterations: offlineMeta.pbkdf2_iterations,
      }),
    });
  });

  await page.route('**/api/database/download', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: offlineBundle,
      headers: {
        'content-length': String(offlineBundle.length),
      },
    });
  });

  await page.goto('/');

  const installButton = page.getByTitle('Baixar BD para habilitar as buscas');
  await expect(installButton).toBeVisible();
  await installButton.click();

  await expect(page.getByTitle('Buscas Offline configuradas!')).toBeVisible({
    timeout: 120_000,
  });

  const apiRequestsAfterOffline: string[] = [];
  await page.route('**/api/**', async (route) => {
    apiRequestsAfterOffline.push(route.request().url());
    await route.abort('failed');
  });

  await page.locator('#ncmInput').fill('29');
  await page.locator('#ncmInput').press('Enter');

  const localNoteRef = page.locator('.note-ref[data-note="1"]:not([data-chapter])').first();
  await expect(localNoteRef).toBeVisible({ timeout: 30_000 });
  await localNoteRef.click();

  const localPanel = page.locator('aside[aria-label="Nota 1 do Capítulo 29"]');
  await expect(localPanel).toBeVisible();
  await expect(localPanel).toContainText('Ésteres');
  await page.getByLabel('Fechar nota').click();

  const crossChapterNoteRef = page.locator('.note-ref[data-note="2"][data-chapter="28"]').first();
  await expect(crossChapterNoteRef).toBeVisible();
  await crossChapterNoteRef.click();

  const crossChapterPanel = page.locator('aside[aria-label="Nota 2 do Capítulo 28"]');
  await expect(crossChapterPanel).toBeVisible();
  await expect(crossChapterPanel).toContainText('Alguns sais inorgânicos do Capítulo 31');

  expect(apiRequestsAfterOffline).toEqual([]);
});
