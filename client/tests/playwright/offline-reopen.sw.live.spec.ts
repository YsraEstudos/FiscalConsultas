import { expect, test } from '@playwright/test';

import {
  expectOfflineMetadataPersisted,
  installOfflineApiMock,
  installOfflineFromSettings,
  installOfflineWorkerMock,
  type OfflineApiCounters,
} from './helpers/offlineInstallFlow';

function isNonLocalHostBaseUrlConfigured(): boolean {
  const rawBaseUrl = process.env.PLAYWRIGHT_LIVE_BASE_URL || '';
  if (!rawBaseUrl) return false;

  try {
    const hostname = new URL(rawBaseUrl).hostname;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

test.describe('live offline reopen with active service worker', () => {
  test.skip(!isNonLocalHostBaseUrlConfigured(), 'Set PLAYWRIGHT_LIVE_BASE_URL to a non-localhost host (e.g. http://offline-e2e.local:4173).');

  test('reopens fully offline with cached app shell and local DB ready state', async ({ page, context }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

    const hostname = await page.evaluate(() => globalThis.location.hostname);
    expect(hostname).not.toBe('localhost');
    expect(hostname).not.toBe('127.0.0.1');

    const isSecureContext = await page.evaluate(() => globalThis.isSecureContext);
    expect(isSecureContext).toBe(true);

    await page.waitForFunction(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length > 0;
    });

    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await installOfflineFromSettings(page);
    expect(counters.token).toBe(1);
    expect(counters.download).toBe(1);

    await page.keyboard.press('Escape');
    await expectOfflineMetadataPersisted(page);

    await page.unroute('**/api/**');
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
      await expectOfflineMetadataPersisted(page);
    } finally {
      await context.setOffline(false);
    }
  });
});