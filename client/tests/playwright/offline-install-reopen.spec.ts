import { expect, test } from '@playwright/test';

import {
  OFFLINE_METADATA,
  expectOfflineAutoInstalled,
  expectOfflineMetadataPersisted,
  expectOfflineReadyInSettings,
  installOfflineApiMock,
  installOfflineFromSettings,
  installOfflineWorkerMock,
  openSettings,
  seedFreshOfflineInstallLease,
  type OfflineApiCounters,
} from './helpers/offlineHarness';

test.describe('offline install and reopen flow', () => {
  test('serves the preview app with cross-origin isolation for local search', async ({ page }) => {
    await installOfflineWorkerMock(page);

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'FiscalConsultas' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    await openSettings(page);
    await expect(page.getByText(/Indisponível/)).not.toBeVisible();
  });

  test('auto-installs offline database on first supported visit', async ({ page }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'FiscalConsultas' })).toBeVisible();

    await expectOfflineAutoInstalled(page);

    expect(counters.metadata || 0).toBeGreaterThanOrEqual(1);
    expect(counters.bundle).toBe(1);
    expect(counters.version).toBe(0);
    expect(counters.token).toBe(0);
    expect(counters.download).toBe(0);

    await page.keyboard.press('Escape');
    await expectOfflineMetadataPersisted(page);
  });

  test('shows an actionable error when static offline install fails', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('offline-db:auto-install-opt-out', 'true');

      type WorkerMessage = {
        type: string;
        id: string | null;
        payload: Record<string, unknown>;
      };

      function emitToWorker(
        worker: {
          onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
          listeners: Set<(event: MessageEvent<WorkerMessage>) => void>;
        },
        message: WorkerMessage,
      ) {
        const event = { data: message } as MessageEvent<WorkerMessage>;
        worker.onmessage?.(event);
        worker.listeners.forEach((listener) => listener(event));
      }

      class FailingOfflineWorker {
        public onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;

        public listeners = new Set<(event: MessageEvent<WorkerMessage>) => void>();

        constructor() {
          queueMicrotask(() => {
            emitToWorker(this, { type: 'READY', id: null, payload: {} });
          });
        }

        addEventListener(type: string, listener: (event: MessageEvent<WorkerMessage>) => void) {
          if (type === 'message') this.listeners.add(listener);
        }

        removeEventListener(type: string, listener: (event: MessageEvent<WorkerMessage>) => void) {
          if (type === 'message') this.listeners.delete(listener);
        }

        terminate() {
          this.listeners.clear();
        }

        postMessage(message: WorkerMessage) {
          if (message.type === 'INIT') {
            emitToWorker(this, {
              type: 'STATUS',
              id: message.id,
              payload: { status: 'not_installed' },
            });
            return;
        }

        if (message.type === 'INSTALL') {
            const error = 'Não foi possível instalar o bundle fiscal R2. Verifique se os arquivos estáticos estão disponíveis. Reinstale o banco offline para continuar.';
            emitToWorker(this, {
              type: 'STATUS',
              id: message.id,
              payload: { status: 'error', error },
            });
            emitToWorker(this, {
              type: 'ERROR',
              id: message.id,
              payload: { error },
            });
          }
        }
      }

      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        writable: true,
        value: FailingOfflineWorker,
      });
    });

    await page.context().route('**/fiscal_offline.meta.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(OFFLINE_METADATA),
      });
    });

    await page.goto('/');
    await openSettings(page);
    await page.locator('#db-installer-install').click();

    await expect(page.getByText(/Verifique se os arquivos estáticos estão disponíveis/i)).toBeVisible();
    await expect(page.getByText(/Solicitando token/i)).not.toBeVisible();
  });

  test('keeps manual install path available after user opt-out', async ({ page }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);
    await page.addInitScript(() => {
      localStorage.setItem('offline-db:auto-install-opt-out', 'true');
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'FiscalConsultas' })).toBeVisible();
    await installOfflineFromSettings(page);

    expect(counters.bundle).toBe(1);
  });

  test('reopens with offline DB ready when backend API is unavailable', async ({ page, context }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await installOfflineFromSettings(page);
    await page.keyboard.press('Escape');
    await expectOfflineMetadataPersisted(page);

    await context.unroute('**/api/**');
    await context.unroute('**/api/auth/me*');
    await context.route('**/api/**', async (route) => {
      await route.abort('failed');
    });

    await page.reload();

    await expect(page.getByRole('heading', { name: 'FiscalConsultas' })).toBeVisible();
    await expectOfflineMetadataPersisted(page);
    await expectOfflineReadyInSettings(page);
  });

  test('recovers when a previous installing tab is closed before broadcasting completion', async ({ page, context }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineWorkerMock(page);
    await installOfflineApiMock(page, counters);
    await seedFreshOfflineInstallLease(page);

    await page.goto('/');
    await openSettings(page);
    await expect(page.getByText(/Outra aba está instalando os dados/i)).toBeVisible();

    const closingOwnerPage = await context.newPage();
    await closingOwnerPage.goto('/');
    await closingOwnerPage.evaluate(() => {
      const raw = localStorage.getItem('offline-db:install-lock');
      const lock = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      localStorage.setItem(
        'offline-db:install-lock',
        JSON.stringify({
          ...lock,
          expiresAt: Date.now() - 1,
        }),
      );
    });
    await closingOwnerPage.close();

    await expectOfflineReadyInSettings(page);
    expect(counters.bundle || 0).toBeGreaterThanOrEqual(1);
  });
});
