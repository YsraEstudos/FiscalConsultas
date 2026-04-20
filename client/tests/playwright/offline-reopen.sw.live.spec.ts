import { expect, test, type Page } from '@playwright/test';
import {
  installAuthSessionMock,
  installOfflineApiMock,
  installOfflineFromSettings,
  installOfflineWorkerMock,
  type OfflineApiCounters,
} from './helpers/offlineHarness';

const APP_SHELL_CACHE = 'app-shell-v3';
const RUNTIME_CACHE = 'runtime-assets-v3';

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

async function installOfflineSupportMock(page: Page) {
  await page.addInitScript(() => {
    try {
      if (globalThis.SharedArrayBuffer === undefined) {
        Object.defineProperty(globalThis, 'SharedArrayBuffer', {
          configurable: true,
          value: class SharedArrayBufferShim {},
        });
      }
    } catch {
      // Some browsers expose this as a non-configurable global; ignore that.
    }

    try {
      const cryptoObject = globalThis.crypto as Crypto & { subtle?: unknown } | undefined;
      if (cryptoObject && cryptoObject.subtle === undefined) {
        const subtleShim = {};
        try {
          Object.defineProperty(cryptoObject, 'subtle', {
            configurable: true,
            value: subtleShim,
          });
        } catch {
          const cryptoPrototype = Object.getPrototypeOf(cryptoObject);
          if (cryptoPrototype) {
            Object.defineProperty(cryptoPrototype, 'subtle', {
              configurable: true,
              value: subtleShim,
            });
          }
        }
      }
    } catch {
      // If crypto is read-only, the live spec will still surface the unsupported state.
    }

    try {
      const navigatorWithStorage = navigator as Navigator & {
        storage?: { getDirectory?: unknown };
      };
      const storage = navigatorWithStorage.storage;
      if (!storage || typeof storage.getDirectory !== 'function') {
        const storageShim = {
          ...(storage && typeof storage === 'object' ? storage : {}),
          getDirectory: async () => ({}),
        };
        try {
          Object.defineProperty(navigatorWithStorage, 'storage', {
            configurable: true,
            value: storageShim,
          });
        } catch {
          const navigatorPrototype = Object.getPrototypeOf(navigatorWithStorage);
          if (navigatorPrototype) {
            Object.defineProperty(navigatorPrototype, 'storage', {
              configurable: true,
              value: storageShim,
            });
          }
        }
      }
    } catch {
      // If storage is read-only, the live spec will still surface the unsupported state.
    }
  });
}

async function waitForOfflineShellCache(page: Page) {
  await page.waitForFunction(
    async ({ appShellCacheName, runtimeCacheName }) => {
      if (!navigator.serviceWorker?.controller) return false;
      if (!('caches' in globalThis)) return false;

      const [appShellCache, runtimeCache] = await Promise.all([
        caches.open(appShellCacheName),
        caches.open(runtimeCacheName),
      ]);
      const assetUrls = Array.from(
        document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
          'script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]',
        ),
      ).map((element) => new URL(element.src || element.href, globalThis.location.href).toString());
      const urls = [
        globalThis.location.href,
        new URL('./', globalThis.location.href).toString(),
        new URL('./index.html', globalThis.location.href).toString(),
        ...assetUrls,
      ];

      for (const url of urls) {
        if ((await appShellCache.match(url)) || (await runtimeCache.match(url))) {
          continue;
        }
        return false;
      }

      return true;
    },
    {
      appShellCacheName: APP_SHELL_CACHE,
      runtimeCacheName: RUNTIME_CACHE,
    },
  );
}

function isOfflineNavigationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ERR_INTERNET_DISCONNECTED');
}

test.describe('live offline reopen with active service worker', () => {
  test.skip(!isNonLocalHostBaseUrlConfigured(), 'Set PLAYWRIGHT_LIVE_BASE_URL to a non-localhost host (e.g. http://offline-e2e.local:4173).');

  test('reopens fully offline with cached app shell and local DB ready state', async ({ page, context }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineSupportMock(page);
    await installOfflineWorkerMock(page);
    await installAuthSessionMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

    const hostname = await page.evaluate(() => globalThis.location.hostname);
    expect(hostname).not.toBe('localhost');
    expect(hostname).not.toBe('127.0.0.1');

    await page.reload();
    await page.waitForFunction(() => window.crossOriginIsolated === true);

    await installOfflineFromSettings(page, 15_000);
    expect(counters.token).toBe(1);
    expect(counters.download).toBe(1);

    await page.keyboard.press('Escape');
    await expect(page.getByTitle('Buscas Offline configuradas!')).toBeVisible();
    await waitForOfflineShellCache(page);

    await page.unroute('**/api/**');
    await context.setOffline(true);
    try {
      await page.evaluate(() => {
        (globalThis as typeof globalThis & { __offlineReloadSentinel?: string }).__offlineReloadSentinel = 'before-reload';
      });

      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
      } catch (error) {
        if (!isOfflineNavigationError(error)) {
          throw error;
        }
      }

      await expect.poll(async () => {
        try {
          return await page.evaluate(
            () => (globalThis as typeof globalThis & { __offlineReloadSentinel?: string }).__offlineReloadSentinel ?? null,
          );
        } catch {
          return 'navigating';
        }
      }).toBe(null);

      await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
      await expect(page.getByTitle('Buscas Offline configuradas!')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
