import { expect, test } from '@playwright/test';

import {
  expectOfflineMetadataPersisted,
  installOfflineApiMock,
  installOfflineFromSettings,
  installOfflineWorkerMock,
  type OfflineApiCounters,
} from './helpers/offlineInstallFlow';

test.describe('offline install and reopen flow', () => {
  test('installs offline database using version/token/download endpoints', async ({ page }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

    await installOfflineFromSettings(page);

    expect(counters.version).toBeGreaterThanOrEqual(2);
    expect(counters.token).toBe(1);
    expect(counters.download).toBe(1);

    await page.keyboard.press('Escape');
    await expectOfflineMetadataPersisted(page);
  });

  test('reopens with offline DB ready when backend API is unavailable', async ({ page }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await installOfflineFromSettings(page);
    await expectOfflineMetadataPersisted(page);

    await page.unroute('**/api/**');
    await page.route('**/api/**', async (route) => {
      await route.abort('failed');
    });

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
    await expectOfflineMetadataPersisted(page);
  });
});